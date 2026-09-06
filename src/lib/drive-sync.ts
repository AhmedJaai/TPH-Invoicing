/**
 * المشي على أرشيف الدرايف.
 *
 * منطق واحد يخدم الترحيل الأوّل والمزامنة التدريجية معاً، فلا يفترق سلوك
 * السكربت عن سلوك التطبيق. قراءة فقط — لا حذف ولا نقل ولا تعديل.
 */
import type { drive_v3 } from "googleapis";
import { isFolder, listChildren, type DriveFile } from "./drive";
import { driveConfig, SUPPLIER_INFO_CARD } from "@/config/drive";

const MONTH_RE = /^\d{4}-\d{2}$/;

export interface ArchiveEntry {
  /** مجلد الشهر: YYYY-MM */
  month: string;
  /** اسم مجلد المورد أو المجلد الخدمي كما هو في الدرايف */
  folderName: string;
  file: DriveFile;
}

export interface WalkOptions {
  /** أشهر بعينها؛ الفراغ يعني كل ما في الدرايف */
  months?: readonly string[];
  /** ملفات معروفة سلفاً — تُتخطّى بلا قراءة */
  knownFileIds?: ReadonlySet<string>;
  /**
   * مهلةٌ يقف عندها المشي (وقتٌ مطلق بالمللي ثانية).
   *
   * لأنّ الدالّة تعمل داخل طلبٍ له سقفٌ زمنيّ عند المزوّد. وبلا مهلة
   * كان الطلب يُقتَل عند الستّين ثانية فيردّ المزوّد نصّاً لا JSON،
   * وتنفجر الشاشة برسالةٍ لا يفهمها أحد: «Unexpected token 'A'».
   *
   * والوقوف بمهلةٍ ليس فشلاً: ما مُشي عليه يُرجَع، وما بقي يُقال إنّه
   * بقي — والطلب التالي يكمله.
   */
  deadline?: number;
}

export interface WalkResult {
  entries: ArchiveEntry[];
  /** أشهرٌ لم يُمشَ عليها بعد — يكملها الطلب التالي. */
  pendingMonths: string[];
  /** أوقفته المهلة قبل أن يُتمّ. */
  truncated: boolean;
}

/** كم مجلّد مورّدٍ يُقرأ معاً — الشبكة تنتظر أكثر ممّا تحسب. */
const FOLDER_CONCURRENCY = 6;

async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/**
 * يمشي على ACCOUNTS / سنة / شهر / مجلد / ملف.
 *
 * حصر الأشهر مقصود في المزامنة الدورية: قراءة الأرشيف كله في كل مرة تكلّف
 * مئة نداء لجوجل بلا فائدة، والملفات الجديدة تصل إلى الأشهر القريبة وحدها.
 */
export async function walkArchive(
  drive: drive_v3.Drive,
  options: WalkOptions = {},
): Promise<WalkResult> {
  const wanted = options.months?.length ? new Set(options.months) : null;
  const known = options.knownFileIds;
  const deadline = options.deadline ?? Infinity;
  const out: ArchiveEntry[] = [];
  const pending: string[] = [];
  let truncated = false;

  for (const yearFolderId of Object.values(driveConfig.yearFolderIds)) {
    let months: DriveFile[];
    try {
      months = await listChildren(drive, yearFolderId);
    } catch {
      // سنة غير مهيّأة في الدرايف بعد — ليست خطأً يوقف المزامنة
      continue;
    }

    for (const month of months.filter(isFolder)) {
      if (!MONTH_RE.test(month.name)) continue;
      if (wanted && !wanted.has(month.name)) continue;

      /*
        المهلة تُفحَص عند رأس كل شهر لا داخله: الشهر وحدةٌ تُتمّ أو
        تُؤجَّل كاملة، فلا يبقى نصفُ شهرٍ لا يعرف أحدٌ أين وقف.
      */
      if (Date.now() >= deadline) {
        truncated = true;
        pending.push(month.name);
        continue;
      }

      const folders = (await listChildren(drive, month.id)).filter(isFolder);
      const perFolder = await inBatches(folders, FOLDER_CONCURRENCY, async (folder) => {
        const files = await listChildren(drive, folder.id);
        return files
          .filter((f) => !isFolder(f))
          .filter((f) => f.name !== SUPPLIER_INFO_CARD)
          .filter((f) => !/\.(txt|md)$/i.test(f.name))
          .filter((f) => !known?.has(f.id))
          .map((file) => ({ month: month.name, folderName: folder.name, file }));
      });
      for (const group of perFolder) out.push(...group);
    }
  }

  return { entries: out, pendingMonths: [...new Set(pending)], truncated };
}

export function recentMonths(count: number, from = new Date()): string[] {
  const out: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}
