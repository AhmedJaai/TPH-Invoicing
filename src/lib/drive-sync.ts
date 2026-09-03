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
): Promise<ArchiveEntry[]> {
  const wanted = options.months?.length ? new Set(options.months) : null;
  const known = options.knownFileIds;
  const out: ArchiveEntry[] = [];

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

      for (const folder of (await listChildren(drive, month.id)).filter(isFolder)) {
        for (const file of await listChildren(drive, folder.id)) {
          if (isFolder(file)) continue;
          if (file.name === SUPPLIER_INFO_CARD) continue;
          if (/\.(txt|md)$/i.test(file.name)) continue;
          if (known?.has(file.id)) continue;
          out.push({ month: month.name, folderName: folder.name, file });
        }
      }
    }
  }

  return out;
}

/** الأشهر الأخيرة بصيغة YYYY-MM، من الأحدث إلى الأقدم. */
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
