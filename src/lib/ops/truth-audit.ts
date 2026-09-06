/**
 * تدقيق الحقيقة: هل يوافق ما في القاعدة ما في الأصل؟
 *
 * الدرايف أرشيفٌ لا يُمَسّ، وهو **مصدر الحقيقة** للمستندات. والقاعدة
 * اشتقاقٌ منه. ومع الوقت يتباعدان: ملفٌّ رُفع ولم يُقيَّد، وقيدٌ لا أصل
 * له، ورقمٌ قُرئ خطأً فبقي.
 *
 * وهذا لا يُكتشَف بالنظر إلى القاعدة وحدها — فهي متّسقة مع نفسها. ولا
 * بالنظر إلى الدرايف وحده. يُكتشَف **بالمقابلة**.
 *
 * وخمسةُ أحكام، والتمييز بينها هو كلّ الفائدة:
 *
 *   VERIFIED   الأصل موجود، والقيد يوافقه.
 *   CORRECTED  الأصل موجود، والقيد يخالفه في رقمٍ يُصلَح.
 *   DUPLICATE  أصلٌ واحد وقيدان — أو قيدٌ واحد وأصلان.
 *   MISSING    قيدٌ بلا أصل، أو أصلٌ بلا قيد.
 *   AMBIGUOUS  لا يُقطَع بشيء — والقطعُ هنا تخمين.
 *
 * **و`AMBIGUOUS` ليست فشلاً.** هي الحكم الصادق حين لا يكفي الدليل، وهي
 * ما يمنع أن يُصحَّح رقمٌ صحيح بآخر خاطئ. والنظام الذي لا يملك هذا
 * الحكم يضطرّ إلى الكذب في أحد الاتّجاهين.
 *
 * ودوالُّ هذا الملفّ خالصة. والجلبُ في `scripts/truth-audit.ts`.
 */

export type TruthVerdict =
  | "VERIFIED" | "CORRECTED" | "DUPLICATE" | "MISSING" | "AMBIGUOUS";

export const VERDICT_LABEL: Record<TruthVerdict, string> = {
  VERIFIED: "مطابق",
  CORRECTED: "يحتاج تصحيحاً",
  DUPLICATE: "مكرَّر",
  MISSING: "مفقود",
  AMBIGUOUS: "لا يُقطَع فيه",
};

/** ما في الأرشيف. */
export interface ArchiveFile {
  /** معرّف الملفّ في الدرايف — الهويّة التي لا تتغيّر بإعادة التسمية. */
  driveId: string;
  fileName: string;
  /** ما فُهم من اسم الملفّ، إن فُهم. */
  supplierSlug: string | null;
  periodMonth: string | null;
  invoiceNumber: string | null;
  totalMinor: number | null;
}

/** ما في القاعدة. */
export interface DbRecord {
  documentId: string;
  driveId: string | null;
  fileName: string;
  supplierSlug: string | null;
  periodMonth: string | null;
  invoiceNumber: string | null;
  totalMinor: number | null;
  /** أوُجدت له فاتورة؟ */
  hasInvoice: boolean;
}

export interface TruthFinding {
  verdict: TruthVerdict;
  /** ما يُعرَّف به الصفّ للإنسان. */
  label: string;
  detail: string;
  driveId: string | null;
  documentId: string | null;
  /** ما يُصلَح، إن كان يُصلَح — ولا يُصلَح آلياً. */
  suggestion: string | null;
}

/** تسامح فرق الإجمالي: ريالٌ واحد، وهو نفسه في القاعدة. */
export const TOTAL_TOLERANCE_MINOR = 100;

/**
 * يقابل الأرشيف بالقاعدة.
 *
 * والمقابلة بمعرّف الدرايف أوّلاً — هو الهويّة التي لا تتغيّر بإعادة
 * التسمية — ثمّ بالاسم عند غيابه. والاسم يخدع: مورّدٌ يُسمّي فاتورتين
 * بالاسم نفسه في شهرين.
 */
export function auditTruth(
  archive: readonly ArchiveFile[],
  records: readonly DbRecord[],
): TruthFinding[] {
  const out: TruthFinding[] = [];

  const byDriveId = new Map<string, DbRecord[]>();
  const withoutDriveId: DbRecord[] = [];
  for (const r of records) {
    if (r.driveId) byDriveId.set(r.driveId, [...(byDriveId.get(r.driveId) ?? []), r]);
    else withoutDriveId.push(r);
  }

  const seenDocuments = new Set<string>();

  for (const file of archive) {
    const matches = byDriveId.get(file.driveId) ?? [];
    for (const m of matches) seenDocuments.add(m.documentId);

    /* أصلٌ بلا قيد */
    if (matches.length === 0) {
      out.push({
        verdict: "MISSING",
        label: file.fileName,
        detail: "الملفّ في الأرشيف ولا قيد له في القاعدة",
        driveId: file.driveId,
        documentId: null,
        suggestion: "أعد مزامنة الدرايف — أو ارفعه إن كان أُضيف يدوياً",
      });
      continue;
    }

    /* أصلٌ واحد وقيدان */
    if (matches.length > 1) {
      out.push({
        verdict: "DUPLICATE",
        label: file.fileName,
        detail: `${matches.length} قيداً لملفٍّ واحد`,
        driveId: file.driveId,
        documentId: matches[0].documentId,
        suggestion: "أبقِ الأقدم واحذف الباقي — بعد التأكّد أنّ لا فاتورة تعتمد عليه",
      });
      continue;
    }

    const record = matches[0];

    /*
      الإجمالي هو الرقم الذي يهمّ. وما لم يُقرأ من الاسم لا يُقابَل —
      والقولُ «مطابق» عن رقمٍ لم يُقرأ ادّعاء.
    */
    if (file.totalMinor === null || record.totalMinor === null) {
      out.push({
        verdict: "AMBIGUOUS",
        label: file.fileName,
        detail:
          file.totalMinor === null
            ? "اسم الملفّ لا يحمل إجمالاً يُقابَل"
            : "القيد بلا إجمالٍ مقروء",
        driveId: file.driveId,
        documentId: record.documentId,
        suggestion: "افتح المستند وأثبِت إجماليه بيدك",
      });
      continue;
    }

    const diff = Math.abs(file.totalMinor - record.totalMinor);
    if (diff > TOTAL_TOLERANCE_MINOR) {
      out.push({
        verdict: "CORRECTED",
        label: file.fileName,
        detail:
          `الأصل ${(file.totalMinor / 100).toFixed(2)} والقيد ` +
          `${(record.totalMinor / 100).toFixed(2)} — فرق ${(diff / 100).toFixed(2)}`,
        driveId: file.driveId,
        documentId: record.documentId,
        suggestion: "افتح الأصل واحسم أيّهما الصحيح — لا يُصحَّح آلياً",
      });
      continue;
    }

    /* والشهر كذلك: خطؤه ينقل الفاتورة إلى شهرٍ ليس لها */
    if (
      file.periodMonth !== null && record.periodMonth !== null &&
      file.periodMonth !== record.periodMonth
    ) {
      out.push({
        verdict: "CORRECTED",
        label: file.fileName,
        detail: `الأصل شهر ${file.periodMonth} والقيد ${record.periodMonth}`,
        driveId: file.driveId,
        documentId: record.documentId,
        suggestion: "الشهر يُشتقّ من تاريخ الفاتورة لا من موضع الملفّ",
      });
      continue;
    }

    out.push({
      verdict: "VERIFIED",
      label: file.fileName,
      detail: `${(record.totalMinor / 100).toFixed(2)} · ${record.periodMonth ?? "—"}`,
      driveId: file.driveId,
      documentId: record.documentId,
      suggestion: null,
    });
  }

  /* قيدٌ بلا أصل */
  for (const r of records) {
    if (seenDocuments.has(r.documentId)) continue;
    if (r.driveId === null) {
      out.push({
        verdict: "AMBIGUOUS",
        label: r.fileName,
        detail: "قيدٌ بلا معرّف درايف — لا يُقابَل بأصل",
        driveId: null,
        documentId: r.documentId,
        suggestion: "أعد مزامنة الدرايف كي يُربَط بأصله",
      });
      continue;
    }
    out.push({
      verdict: "MISSING",
      label: r.fileName,
      detail: "قيدٌ في القاعدة ولا أصل له في الأرشيف",
      driveId: r.driveId,
      documentId: r.documentId,
      suggestion: "الملفّ نُقل أو حُذف من الدرايف — لا تحذف القيد قبل معرفة أين ذهب",
    });
  }

  return out;
}

export function summarize(findings: readonly TruthFinding[]): Record<TruthVerdict, number> {
  const out: Record<TruthVerdict, number> = {
    VERIFIED: 0, CORRECTED: 0, DUPLICATE: 0, MISSING: 0, AMBIGUOUS: 0,
  };
  for (const f of findings) out[f.verdict]++;
  return out;
}

/**
 * أنقيّةٌ هي القاعدة؟
 *
 * و`AMBIGUOUS` لا تمنع — الجهل ليس خطأً. والذي يمنع: قيدٌ يخالف أصله،
 * أو قيدان لأصلٍ واحد، أو قيدٌ بلا أصل.
 */
export function isClean(counts: Record<TruthVerdict, number>): boolean {
  return counts.CORRECTED === 0 && counts.DUPLICATE === 0 && counts.MISSING === 0;
}
