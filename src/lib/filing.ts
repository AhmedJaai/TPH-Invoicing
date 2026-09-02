/**
 * قواعد الترتيب — أي شهر يذهب إليه كل مستند.
 *
 * القواعد كما في دليل الأرشيف:
 *  ١. الشهر = تاريخ الفاتورة، لا تاريخ السداد.
 *  ٢. إيصال السداد يُحفظ مع الشهر الذي يخصّه، لا شهر التحويل.
 *  ٣. فاتورة غير مسددة وصلت بعد كشف حساب موردها تُرحَّل لمجلد الشهر التالي.
 */

/** يحوّل تاريخاً إلى شهر محاسبي بصيغة YYYY-MM. */
export function monthOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export interface InvoiceFilingInput {
  invoiceDate: Date;
  /** تاريخ آخر كشف حساب من هذا المورد، إن وُجد */
  supplierStatementDate?: Date | null;
  /** هل سُدّدت الفاتورة؟ المسددة لا تُرحَّل مهما تأخرت */
  isPaid: boolean;
}

export interface InvoiceFiling {
  periodMonth: string;
  carriedForwardFrom?: string;
}

/**
 * يحدّد مجلد الشهر للفاتورة.
 * الأصل شهر تاريخ الفاتورة. ولا تُرحَّل إلا إذا اجتمع شرطان:
 * أنها غير مسددة، وأنها صدرت بعد تاريخ كشف حساب موردها — لأنها حينئذ
 * فاتتها دورة السداد الحالية وستدخل القادمة.
 */
export function resolveInvoiceFiling(input: InvoiceFilingInput): InvoiceFiling {
  const base = monthOf(input.invoiceDate);

  if (input.isPaid || !input.supplierStatementDate) return { periodMonth: base };

  const statementMonth = monthOf(input.supplierStatementDate);
  const arrivedAfterStatement = input.invoiceDate > input.supplierStatementDate;

  // الترحيل لا يعني إلا الفواتير التي تخصّ شهر الكشف نفسه وتأخرت عنه.
  if (arrivedAfterStatement && base === statementMonth) {
    return { periodMonth: nextMonth(base), carriedForwardFrom: base };
  }

  return { periodMonth: base };
}

export interface ReceiptFilingInput {
  /** تاريخ التحويل البنكي */
  paidAt: Date;
  /** أشهر الفواتير التي يسددها هذا الإيصال، مستخرجة من تخصيصات الدفعة */
  settledInvoiceMonths?: string[];
}

/**
 * يحدّد مجلد الشهر لإيصال السداد.
 *
 * الإيصال يتبع الفواتير التي يسددها لا تاريخ تحويله: إيصال حُوّل في ٢ سبتمبر
 * عن فواتير أغسطس يذهب إلى 2026-08.
 *
 * وإن لم تُعرف الفواتير بعد، نستند إلى منطق السداد المعتاد — نسدد مطلع كل شهر
 * عن الشهر السابق — فنرجع الشهر السابق لتاريخ التحويل.
 */
export function resolveReceiptFiling(input: ReceiptFilingInput): string {
  const months = input.settledInvoiceMonths?.filter(Boolean) ?? [];

  if (months.length > 0) {
    // عند تعدّد الأشهر نأخذ الأقدم — الإيصال يُحفظ حيث بدأ الدين.
    return [...months].sort()[0];
  }

  return previousMonth(monthOf(input.paidAt));
}

/** مسار المجلد المتوقّع داخل الدرايف، لعرضه في شاشة المعاينة قبل الحفظ. */
export function drivePathFor(
  periodMonth: string,
  folderName: string,
): string {
  const year = periodMonth.slice(0, 4);
  return `ACCOUNTS / ${year} / ${periodMonth} / ${folderName}`;
}
