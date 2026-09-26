/**
 * أهذا المستندُ فاتورةٌ مقيَّدةٌ من قبل؟ — السؤالُ قبل كلّ قيدٍ آليّ.
 *
 * القاعدةُ تمنع (المورّد، الرقم) مكرَّراً حرفاً بحرف (`invoice_supplier_number_uniq`)،
 * لكنّ الرقم نفسه يُقرأ بصيغٍ: «INV-2026-05297» و«INV/2026/05297» و«inv 2026 05297».
 * فيُقارَن بمفتاحٍ لا يعرف الفواصل ولا حالة الحروف. ونسخةٌ رقمُها لم يُقرأ
 * كما قُرئ في أختها تُعرف بيومها ومبلغها معاً — فتُترك للإنسان ولا تُقيَّد.
 */

export interface RecordedInvoice {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  /** YYYY-MM-DD */
  invoiceDate: string | null;
  totalMinor: number | null;
}

export type InvoiceTwin =
  | { kind: "same-number"; invoice: RecordedInvoice }
  | { kind: "same-day-and-total"; invoice: RecordedInvoice };

/** الرقمُ بلا فواصل ولا حالة حروف — «INV/2026/05297» و«inv-2026-05297» واحد. */
export function invoiceNumberKey(n: string): string {
  return n.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

export function findInvoiceTwin(
  recorded: readonly RecordedInvoice[],
  candidate: { supplierId: string; invoiceNumber: string | null; invoiceDate: string | null; totalMinor: number | null },
): InvoiceTwin | null {
  const mine = recorded.filter((r) => r.supplierId === candidate.supplierId);
  const key = candidate.invoiceNumber ? invoiceNumberKey(candidate.invoiceNumber) : "";
  if (key) {
    const hit = mine.find((r) => invoiceNumberKey(r.invoiceNumber) === key);
    if (hit) return { kind: "same-number", invoice: hit };
  }
  if (candidate.invoiceDate && candidate.totalMinor !== null) {
    const hit = mine.find((r) => r.invoiceDate === candidate.invoiceDate && r.totalMinor === candidate.totalMinor);
    if (hit) return { kind: "same-day-and-total", invoice: hit };
  }
  return null;
}

/** الجملةُ التي تُقال تحت المستند حين يُترك لأنّه يشبه مقيَّداً. */
export function twinReason(t: InvoiceTwin): string {
  return t.kind === "same-number"
    ? `نسخةٌ من فاتورة ${t.invoice.invoiceNumber} المقيَّدة — تُرفض لا تُقيَّد`
    : `يشبه فاتورة ${t.invoice.invoiceNumber} المقيَّدة (اليومُ والمبلغ نفسهما) — افتحه وقرّر`;
}
