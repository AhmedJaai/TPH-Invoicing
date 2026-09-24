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
 *      رقمُ فاتورته مكتوبٌ في اسم الملفّ (كتبه غيرُ النموذج).
 *
 * وما لم يجتمع فيه ذلك يبقى للإنسان، **ويُقال له ما نقص بعينه**.
 *
 * دالّةٌ خالصة: تُستدعى في المزامنة لتقرّر، وفي لوح المراجعة لتشرح —
 * فلا يفترق القرارُ عن تفسيره.
 */

import { TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";

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
  invoiceNumber?: string | null;
  fileName?: string | null;
}

export type AutoArchiveGap =
  | "NOT_INVOICE"
  | "NOT_RECORDED"
  | "SUPPLIER_UNKNOWN"
  | "ARITHMETIC"
  | "UNVERIFIED_IMAGE";

export interface AutoArchiveVerdict {
  auto: boolean;
  gaps: AutoArchiveGap[];
}

/** ما يُقال لصاحب المقهى عن كلّ شرطٍ لم يتحقّق. */
export const GAP_TEXT: Record<AutoArchiveGap, string> = {
  NOT_INVOICE: "ليس فاتورة — الإيصالاتُ والكشوفُ تُعتمَد بيد",
  NOT_RECORDED: "لم تُقيَّد له فاتورة — ينقصه مورّدٌ أو رقمٌ أو تاريخٌ أو إجماليّ مقروء",
  SUPPLIER_UNKNOWN: "المورّدُ لم يُعرَف — ليس في قائمة المورّدين ولا في مجلّده",
  ARITHMETIC: "الحسابُ لا يستقيم أو ينقصه رقم — قبل الضريبة + الضريبة لا يساوي الإجمالي",
  UNVERIFIED_IMAGE: "قُرئ من صورةٍ ممسوحة ولا شاهدَ يصدّقه — ضريبتُه ليست ١٥٪ من صافيه، ورقمُه ليس في اسم الملفّ",
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

  if (!INVOICE_KINDS.has(f.kind ?? "")) gaps.push("NOT_INVOICE");
  else if (!f.invoiceRecorded) gaps.push("NOT_RECORDED");

  if (!f.supplierKnown) gaps.push("SUPPLIER_UNKNOWN");

  const arithmeticOk =
    f.subtotalMinor !== null && f.vatMinor !== null && f.totalMinor !== null
    && Math.abs(f.subtotalMinor + f.vatMinor - f.totalMinor) <= TOTAL_ROUNDING_TOLERANCE_MINOR;
  if (!arithmeticOk) gaps.push("ARITHMETIC");

  if (f.textSource !== "TEXT") {
    const corroborated =
      (arithmeticOk && vatIsStandardRate(f.subtotalMinor!, f.vatMinor!))
      || numberInFileName(f.invoiceNumber, f.fileName);
    if (!corroborated) gaps.push("UNVERIFIED_IMAGE");
  }

  return { auto: gaps.length === 0, gaps };
}
