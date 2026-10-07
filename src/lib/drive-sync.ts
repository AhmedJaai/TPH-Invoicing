/**
 * المشي على أرشيف الدرايف.
 *
 * منطق واحد يخدم الترحيل الأوّل والمزامنة التدريجية معاً، فلا يفترق سلوك
 * السكربت عن سلوك التطبيق. قراءة فقط — لا حذف ولا نقل ولا تعديل.
 */
import type { drive_v3 } from "googleapis";
import { DriveAuthExpiredError, isDriveAuthError, isDriveNotFound, isFolder, listChildren, type DriveFile } from "./drive";
import { driveConfig, SUPPLIER_INFO_CARD } from "@/config/drive";
import { currentMonthRiyadh } from "./riyadh-time";

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
   * اسمُ كلِّ ملفٍّ معروفٍ كما هو في الدرايف الآن — لا يُقرأ ثانيةً، لكنّ اسمه
   * قد تغيّر بيدٍ هناك («0044.pdf» واسمُه عندنا قياسيّ)، والتسميةُ تحكم على ما عندنا.
   */
  /** `month` مجلدُ الشهر الذي وُجد فيه — ليُقابَل بشهر قيده (`misplacedFiles`) */
  onKnown?: (fileId: string, name: string, month: string, file: DriveFile) => void;
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
  /** ما لم يُقرأ وسببُه — مجلّدٌ تعذّر سردُه، أو مجلّدٌ فرعيّ لا ينزل إليه المشي. */
  notes: string[];
  /**
   * المجلّداتُ التي سُردت كاملةً، وكلُّ ملفٍّ رُئي فيها — بهما يُعرف ما قُيِّد في
   * مجلّدٍ ولم يعد فيه (`missingFromDrive`). والمجلّدُ الذي تعذّر سردُه ليس منها:
   * ما لم يُقرأ لا يُحكَم بغيابه.
   */
  walkedFolderIds: Set<string>;
  seenFileIds: Set<string>;
}

/**
 * حسابُ جوجل لا يرى مجلّدات الأرشيف.
 *
 * كانت السنةُ المردودة بـ٤٠٤ تُتخطّى («سنةٌ لم تُهيَّأ بعد»). فإن رُدّت **كلُّها**
 * — حسابٌ بلا صلاحيةٍ على الأرشيف — خرج المشي فارغاً وقيل «لا جديد» وعُلِّم الدرايف
 * سليماً ولم يُقرأ منه حرف: صنفُ العطب نفسُه الذي وقع بالتفويض المنتهي.
 */
export class DriveArchiveInvisibleError extends Error {
  constructor() {
    super(
      "حسابُ جوجل هذا لا يرى مجلّدات الأرشيف فلم يُقرأ منها شيء — اطلب من مالك الأرشيف مشاركةَ مجلّد الحسابات مع حسابك، ثمّ أعد الفحص.",
    );
    this.name = "DriveArchiveInvisibleError";
  }
}

const isServiceFile = (f: DriveFile): boolean =>
  f.name === SUPPLIER_INFO_CARD || /\.(txt|md)$/i.test(f.name);

/**
 * أين يقع ملفٌّ من الأرشيف — من سلسلة آبائه كما هي في الدرايف.
 *
 * مسارُ القراءة بالمعرّف كان يشترط أن يكون **جدُّ** الملفّ مجلّدَ شهر، فالملفُّ الموضوع في
 * مجلّد الشهر نفسه (يقبله المشي) يُتخطّى بصمت. وكان يكفيه اسمُ الجدّ: ملفٌّ خاصّ في
 * درايف المستخدم داخل مجلّدين بهذا الشكل يُنزَّل ويُرسَل إلى مزوّد الذكاء ويُقيَّد.
 * فمجلّدُ الشهر لا يُقبل إلّا إن كان أبوه إحدى السنوات المهيّأة.
 */
export type ArchivePlace =
  | { ok: true; month: string; folderName: string }
  /** `needsGrandparent`: الأبُ ليس مجلّدَ شهر — اسأل عن الجدّ ثمّ أعد السؤال. */
  | { ok: false; needsGrandparent: boolean; reason: string };

export function archivePlace(
  parent: Pick<DriveFile, "name" | "parents"> | null,
  grandparent: Pick<DriveFile, "name" | "parents"> | null,
  yearFolderIds: readonly string[],
): ArchivePlace {
  const isArchiveMonth = (f: Pick<DriveFile, "name" | "parents">): boolean =>
    MONTH_RE.test(f.name) && (f.parents ?? []).some((p) => yearFolderIds.includes(p));

  if (!parent) return { ok: false, needsGrandparent: false, reason: "لا مجلّدَ له يُرى بتفويضك" };
  if (isArchiveMonth(parent)) return { ok: true, month: parent.name, folderName: "" };
  if (!grandparent) return { ok: false, needsGrandparent: true, reason: "ليس داخل مجلّد شهرٍ من الأرشيف" };
  if (isArchiveMonth(grandparent)) return { ok: true, month: grandparent.name, folderName: parent.name };
  return { ok: false, needsGrandparent: false, reason: "ليس داخل مجلّد شهرٍ من الأرشيف" };
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
  const notes: string[] = [];
  const walkedFolderIds = new Set<string>();
  const seenFileIds = new Set<string>();
  let truncated = false;
  let yearsRead = 0;

  /** ملفّاتُ مجلّدٍ سُرد كاملاً: المعروفُ يُبلَّغ اسمُه، والجديدُ يُرجَع. */
  const take = (files: readonly DriveFile[], month: string, folderName: string, folderId: string): ArchiveEntry[] => {
    walkedFolderIds.add(folderId);
    const fresh: ArchiveEntry[] = [];
    for (const file of files) {
      if (isFolder(file) || isServiceFile(file)) continue;
      seenFileIds.add(file.id);
      if (known?.has(file.id)) options.onKnown?.(file.id, file.name, month, file);
      else fresh.push({ month, folderName, file });
    }
    return fresh;
  };

  for (const yearFolderId of Object.values(driveConfig.yearFolderIds)) {
    let months: DriveFile[];
    try {
      months = await listChildren(drive, yearFolderId);
      yearsRead++;
    } catch (e) {
      /*
        السنة غير المهيّأة وحدها تُتخطّى. وكان كلُّ خطأٍ يُتخطّى هنا —
        فرمزٌ منتهٍ صار «لا ملفّات جديدة» ولم يُقرأ من الدرايف شيء.
      */
      if (isDriveAuthError(e)) throw new DriveAuthExpiredError();
      if (isDriveNotFound(e)) continue;
      throw e;
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

      /*
        عطبٌ عابر في مجلّدٍ واحد (٥٠٠ أو ٤٢٩ بعد محاولات العميل) كان يُسقط المزامنةَ
        كلَّها بـ٥٠٢. فيُعزل: يُذكَر المجلّدُ الذي لم يُقرأ ويُكمَل الباقي — والتفويضُ
        المنتهي وحده يوقف، لأنّ ما بعده سيُردّ بالسبب نفسه.
      */
      let children: DriveFile[];
      try {
        children = await listChildren(drive, month.id);
      } catch (e) {
        if (isDriveAuthError(e)) throw new DriveAuthExpiredError();
        notes.push(`مجلّد ${month.name} — تعذّر سردُه فلم يُقرأ: ${(e as Error).message}`);
        continue;
      }
      const folders = children.filter(isFolder);
      /*
        ملفٌّ وُضع في مجلد الشهر نفسه لا في مجلد مورّده — كان لا يُرى أبداً:
        ثلاثُ فواتير وكشفٌ في سبتمبر ٢٠٢٦ («فاتورة ذابوبليك هاوس 27-09.pdf»).
        فيُقرأ كغيره بلا مورّدٍ من المجلد، ويُعرف مورّدُه من محتواه.
      */
      out.push(...take(children, month.name, "", month.id));
      const perFolder = await inBatches(folders, FOLDER_CONCURRENCY, async (folder) => {
        let files: DriveFile[];
        try {
          files = await listChildren(drive, folder.id);
        } catch (e) {
          if (isDriveAuthError(e)) throw new DriveAuthExpiredError();
          notes.push(`${month.name}/${folder.name} — تعذّر سردُه فلم يُقرأ: ${(e as Error).message}`);
          return [];
        }
        /* المشي ينزل ثلاثةَ مستويات؛ فما في مجلّدٍ فرعيّ لا يُرى — ويُقال، لا يُسكَت عنه */
        for (const sub of files.filter(isFolder)) {
          notes.push(`${month.name}/${folder.name}/${sub.name} — مجلّدٌ فرعيّ لا يُقرأ ما فيه؛ انقل ملفّاته إلى مجلّد المورّد`);
        }
        return take(files, month.name, folder.name, folder.id);
      });
      for (const group of perFolder) out.push(...group);
    }
  }

  if (yearsRead === 0) throw new DriveArchiveInvisibleError();

  return { entries: out, pendingMonths: [...new Set(pending)], truncated, notes, walkedFolderIds, seenFileIds };
}

/**
 * ما قُيِّد في مجلّدٍ سُرد كاملاً ولم يُرَ ملفُّه فيه — حُذف من الدرايف أو أُلقي في
 * سلّته أو نُقل إلى مجلّدٍ لم يُمشَ عليه.
 *
 * لا شيء كان يقابل المقيَّد بالموجود: يُحذف ملفُّ فاتورةٍ فيبقى صفُّها سليماً وزرُّ
 * «افتح الورقة» يفتح خطأ جوجل — والفاتورةُ بلا ورقتها لا تسند خصمَ ضريبتها. ولا
 * يُحكَم إلّا على مجلّدٍ قُرئ كلُّه: ما لم يُسرَد لا يُقال إنّه غاب.
 */
export function missingFromDrive<T extends { driveFileId: string; driveFolderId: string | null }>(
  recorded: readonly T[],
  walk: Pick<WalkResult, "walkedFolderIds" | "seenFileIds">,
): T[] {
  return recorded.filter((r) =>
    r.driveFolderId !== null && walk.walkedFolderIds.has(r.driveFolderId) && !walk.seenFileIds.has(r.driveFileId));
}

/** «الأشهر الأخيرة» بتوقيت الرياض — بـUTC يفوت مجلّدُ الشهر الجديد في ساعاته الثلاث الأولى. */
export function recentMonths(count: number, from = new Date()): string[] {
  const out: string[] = [];
  const [year, month] = currentMonthRiyadh(from).split("-").map(Number);
  let y = year;
  let m = month;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}


/**
 * ملفٌّ في مجلد شهرٍ غير شهر قيده — يُنبَّه ولا يُنقل (الأرشيفُ لا يُنقل فيه شيء).
 *
 * فاتورتا زاكوباك لأغسطس (2823 · 2894) كانتا في «2026-09/Zacopack» ولم يقل شيء — والقيدُ
 * نفسُه صحيحٌ في أغسطس (الشهرُ من تاريخ الفاتورة)، فلا خطأ في المال؛ لكنّ من يفتّش
 * الدرايف بالشهر لا يجدهما. فيُقال اسمُه وشهرُه ومجلدُه، والنقلُ بيد صاحبه.
 */
export function misplacedFiles(
  seen: ReadonlyMap<string, string>,
  recorded: readonly { driveFileId: string; month: string | null; fileName: string; documentId: string }[],
): { documentId: string; fileName: string; folderMonth: string; month: string }[] {
  return recorded.flatMap((r) => {
    const folderMonth = seen.get(r.driveFileId);
    return folderMonth && r.month && folderMonth !== r.month
      ? [{ documentId: r.documentId, fileName: r.fileName, folderMonth, month: r.month }]
      : [];
  });
}
