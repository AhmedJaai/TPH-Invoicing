/**
 * متى يُؤرشَف ما قرأه النموذج بلا مراجعة؟
 *
 * كان كلُّ ما قرأه النموذج من ملفٍّ لا يُفهم اسمُه «ينتظر المراجعة» — لأنّ
 * القراءة قد تُخطئ في رقمٍ وتبقى متّسقةً حسابياً. فسأل أحمد (٢٤ سبتمبر
 * ٢٠٢٦): «ليش ما دخلها أوتوماتيك؟». ثمّ سحب شرطَ الرقم الضريبيّ، وطلب ألّا
 * يبقى للمراجعة إلّا «حالةٌ مستعصية» بسببٍ مقنعٍ فعليّ. فالشروط:
 *
 *   ١. **مورّدٌ معروفٌ عندنا.**
 *   ٢. **فاتورةٌ مقيَّدة**: رقمٌ وتاريخٌ وإجماليّ — وإلّا فلا شيء يُعتمَد.
 *   ٣. **حسابٌ مستقيم**: قبل الضريبة + الضريبة = الإجمالي (بتسامح ريال
 *      كما في القاعدة). والمجهولُ هنا ليس استقامة.
 *   ٤. **قراءةٌ موثوقة**: نصٌّ مكتوبٌ في الملفّ (منقولٌ لا مقروءٌ ظنّاً)،
 *      أو — إن قُرئ من صورة — **شاهدٌ مستقلّ** يصدّقها: ضريبتُه ١٥٪ من
 *      صافيه (رقمان قُرئا منفصلَين يتّفقان بالنسبة لا بالجمع وحده)، أو
 *      رقمُ فاتورته مكتوبٌ في اسم الملفّ (كتبه غيرُ النموذج)، أو — وهو
 *      أقواها — **رمزُ الفاتورة الضريبيّ (QR)** يطابق إجماليَّه بالهللة.
 *   ٥. **ولا يخالفه رمزُه**: إن قُرئ الرمز وخالف المقيَّد لم يدخل آلياً ولو
 *      كان نصّاً. ولا مبلغَ بدّله النموذج تحت إعادة السؤال بلا رمزٍ يصدّقه.
 *
 * وما لم يجتمع فيه ذلك يبقى للإنسان، **ويُقال له ما نقص بعينه**.
 *
 * دالّةٌ خالصة: تُستدعى في المزامنة لتقرّر، وفي لوح المراجعة لتشرح —
 * فلا يفترق القرارُ عن تفسيره.
 */

import { TOTAL_ROUNDING_TOLERANCE_MINOR, checkInvoiceTotals } from "@/lib/money";

export interface AutoArchiveFacts {
  /** نوعُ المستند كما قرأه النموذج — والآليّ للفواتير وحدها. */
  kind: string | null;
  /** أقُيّدت له فاتورة؟ — ما لم يُقيَّد لا يُؤرشَف آلياً. */
  invoiceRecorded: boolean;
  textSource: string | null;
  supplierKnown: boolean;
  subtotalMinor: number | null;
  vatMinor: number | null;
  totalMinor: number | null;
  /** خصمٌ بعد الضريبة — المقيَّدُ في الفاتورة، أو المقروءُ قبل القيد */
  discountMinor?: number | null;
  /** رسومٌ بعد الضريبة — كالخصم */
  chargesMinor?: number | null;
  invoiceNumber?: string | null;
  fileName?: string | null;
  /**
   * مجموعُ أسطر البنود كما قُرئت — شاهدٌ ثانٍ على الإجماليّ.
   * فاتورةُ مورّدٍ لا يفرض ضريبةً فيها بنودٌ وإجماليّ لا «قبل الضريبة»:
   * ١٤٠ + ١٢٠ = ٢٦٠ استقامةٌ كاملة وإن غاب سطرُ الضريبة.
   */
  linesTotalMinor?: number | null;
  /** للكشف: أقُيِّد له صفٌّ في `statements`؟ */
  statementRecorded?: boolean;
  /**
   * إجماليّ رمز الفاتورة الضريبيّ (QR) وضريبتُه — كتبهما نظامُ المورّد لا النموذج.
   * `null`/غائب: لا رمزَ قُرئ (وليس «لا رمز على الورقة»).
   */
  qrTotalMinor?: number | null;
  qrVatMinor?: number | null;
  /** خلافٌ مانع بين الرمز والقراءة في غير المبلغ: رقمُ البائع، أو تاريخٌ في شهرٍ آخر */
  qrOtherConflict?: boolean;
  /** مبلغٌ تبدّل بين جواب النموذج الأوّل وجوابه بعد إعادة السؤال */
  reaskChangedMoney?: boolean;
}

export type AutoArchiveGap =
  | "NOT_INVOICE"
  | "NOT_RECORDED"
  | "SUPPLIER_UNKNOWN"
  | "ARITHMETIC"
  | "UNVERIFIED_IMAGE"
  | "QR_MISMATCH"
  | "REASK_CHANGED";

export interface AutoArchiveVerdict {
  auto: boolean;
  gaps: AutoArchiveGap[];
}

/** ما يُقال لصاحب المقهى عن كلّ شرطٍ لم يتحقّق. */
export const GAP_TEXT: Record<AutoArchiveGap, string> = {
  NOT_INVOICE: "ليس فاتورة — الإيصالاتُ والكشوفُ تُعتمَد بيد",
  NOT_RECORDED: "لم يُقيَّد بعد — ينقصه ما يُقيَّد به (مذكورٌ تحته)",
  SUPPLIER_UNKNOWN: "المورّدُ لم يُعرَف — ليس في قائمة المورّدين ولا في مجلّده",
  ARITHMETIC: "الحسابُ لا يستقيم — لا (قبل الضريبة + الضريبة) ولا مجموعُ البنود يساوي الإجمالي",
  UNVERIFIED_IMAGE: "قُرئ من صورةٍ ممسوحة ولا شاهدَ يصدّقه — لا رمزُ الفاتورة يطابقه ولا ضريبةَ ١٥٪ ولا بنودَ تساوي الإجمالي ولا رقمَ في اسم الملفّ",
  QR_MISMATCH: "رمزُ الفاتورة الضريبيّ (QR) يخالف ما قُيِّد — طابِق الإجماليّ والضريبة ورقمَ البائع والتاريخ بالورقة",
  REASK_CHANGED: "تبدّل مبلغٌ حين أُعيد سؤال النموذج عن حسابٍ لا يستقيم — ولا رمزَ فاتورةٍ يصدّق ما استقرّ عليه",
};

/** الضريبيّةُ والمبسّطة — والمبسّطةُ مستحقّةٌ الدفعَ وإن لم يُخصم مدخلُها. */
const INVOICE_KINDS = new Set(["TAX_INVOICE", "SIMPLIFIED_INVOICE"]);

/** ضريبةُ القيمة المضافة ١٥٪ من الصافي — بتسامح ريالٍ كتقريب المورّد. */
function vatIsStandardRate(subtotal: number, vat: number): boolean {
  return subtotal > 0 && Math.abs(vat * 100 - subtotal * 15) <= TOTAL_ROUNDING_TOLERANCE_MINOR * 100;
}

/** أرقامُ الفاتورة (ثلاثةٌ فأكثر) مكتوبةٌ في اسم الملفّ كتلةً واحدة، أو ضمن كتلةٍ لستّةٍ فأكثر؟ */
function numberInFileName(invoiceNumber: string | null | undefined, fileName: string | null | undefined): boolean {
  const digits = (invoiceNumber ?? "").replace(/\D/g, "");
  if (digits.length < 3 || !fileName) return false;
  const blocks = fileName.replace(/\D+/g, " ").trim().split(" ");
  if (blocks.includes(digits)) return true;
  return digits.length >= 6 && blocks.some((b) => b.includes(digits));
}

export function autoArchive(f: AutoArchiveFacts): AutoArchiveVerdict {
  const gaps: AutoArchiveGap[] = [];

  /*
    الكشفُ ليس فاتورة: لا رقمَ له ولا يُدفَع عليه. هويّتُه مورّدُه وفترتُه
    (كما في `confirm.ts`)، فيدخل متى عُرف مورّدُه وقُيِّد — ولا يُسأل عن
    رقم فاتورة ولا حساب ضريبة (أحمد: «كشف حساب، ايش ينتظر مني؟»).
  */
  if (f.kind === "STATEMENT") {
    if (!f.supplierKnown) gaps.push("SUPPLIER_UNKNOWN");
    else if (!f.statementRecorded) gaps.push("NOT_RECORDED");
    return { auto: gaps.length === 0, gaps };
  }

  if (!INVOICE_KINDS.has(f.kind ?? "")) gaps.push("NOT_INVOICE");
  else if (!f.invoiceRecorded) gaps.push("NOT_RECORDED");

  if (!f.supplierKnown) gaps.push("SUPPLIER_UNKNOWN");

  const near = (a: number, b: number) => Math.abs(a - b) <= TOTAL_ROUNDING_TOLERANCE_MINOR;
  const byTax =
    f.subtotalMinor !== null && f.vatMinor !== null && f.totalMinor !== null
    && checkInvoiceTotals(f.subtotalMinor, f.vatMinor, f.totalMinor, { discountMinor: f.discountMinor, chargesMinor: f.chargesMinor }).verdict !== "MISMATCH";
  /* البنودُ تساوي الإجماليّ — أو تساويه مع الضريبة */
  const byLines =
    f.linesTotalMinor != null && f.linesTotalMinor > 0 && f.totalMinor !== null
    && (near(f.linesTotalMinor, f.totalMinor) || (f.vatMinor !== null && near(f.linesTotalMinor + f.vatMinor, f.totalMinor)));
  const arithmeticOk = byTax || byLines;
  if (!arithmeticOk) gaps.push("ARITHMETIC");

  /*
    ── رمز الفاتورة الضريبيّ: أقوى الشهود ──

    الشهودُ الثلاثة أدناه كلُّها من قراءة النموذج نفسه إلّا اسمَ الملفّ. والرمز
    كتبه نظامُ المورّد: إن طابق إجماليُّه (وضريبتُه إن عُرفت) ما قُيِّد **بالهللة**
    فالقراءة مصدَّقة. وإن خالفه بأكثر من ريال فأحدُهما خطأ — رقمٌ مقلوبٌ يستقيم
    جمعُه، أو فاتورةٌ عُدِّلت — ولا يدخل آلياً نصّاً كان أو صورة.
  */
  const qrKnown = f.qrTotalMinor != null && f.totalMinor !== null;
  const vatComparable = f.qrVatMinor != null && f.vatMinor !== null;
  const qrAgrees =
    qrKnown && f.qrTotalMinor === f.totalMinor && (!vatComparable || f.qrVatMinor === f.vatMinor);
  const qrConflicts =
    (qrKnown && !near(f.qrTotalMinor!, f.totalMinor!))
    || (vatComparable && !near(f.qrVatMinor!, f.vatMinor!))
    || f.qrOtherConflict === true;
  if (qrConflicts) gaps.push("QR_MISMATCH");

  if (f.textSource !== "TEXT") {
    const corroborated =
      qrAgrees
      || (byTax && vatIsStandardRate(f.subtotalMinor!, f.vatMinor!))
      || byLines
      || numberInFileName(f.invoiceNumber, f.fileName);
    if (!corroborated) gaps.push("UNVERIFIED_IMAGE");
  }

  /* مبلغٌ بدّله النموذج تحت إعادة السؤال لا يُصدَّق إلّا بشاهدٍ من خارجه */
  if (f.reaskChangedMoney && !qrAgrees) gaps.push("REASK_CHANGED");

  return { auto: gaps.length === 0, gaps };
}

/** مجموعُ «إجماليّ السطر» في البنود المقروءة — `null` إن غاب أحدُها أو لم تكن بنود. */
export function sumLineTotals(
  lines: readonly { lineTotal?: string | null }[] | null | undefined,
  parse: (s: string) => number | null,
): number | null {
  if (!lines || lines.length === 0) return null;
  let sum = 0;
  for (const l of lines) {
    const v = parse(l.lineTotal ?? "");
    if (v === null) return null;
    sum += v;
  }
  return sum;
}
