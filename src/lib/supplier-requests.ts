import { formatRiyalsDisplay } from "./money";

/**
 * ما يُطلَب من المورّد — فاتورةٌ لمالٍ خرج بلا مستند، وكشفٌ غاب.
 *
 * كان التنبيه يقول «13 دفعة بلا فاتورة ← افتح المورّدين» فتُفتح قائمةٌ
 * عامّة لا تذكر دفعةً واحدة، ويعود صاحب العمل إلى التنبيه ليحفظ الأسماء
 * بعينه. فالقائمة هنا مورّداً مورّداً، ومع كلٍّ رسالتُه جاهزةً.
 */

export interface UnbackedPayment {
  paymentId: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierSlug: string | null;
  /** YYYY-MM-DD */
  paidOn: string;
  amountMinor: number;
  /** ما بقي منها بلا فاتورة — لا الدفعة كلّها. */
  unbackedMinor: number;
  /** حركة البنك التي قُيّدت منها — إن وُجدت. */
  bankTransactionId: string | null;
}

export interface UnbackedSupplier {
  supplierId: string | null;
  supplierName: string;
  supplierSlug: string | null;
  totalMinor: number;
  payments: UnbackedPayment[];
}

/**
 * يجمع الدفعات بمورّدها، الأثقل أوّلاً — وما لا مورّد له آخراً: لا يُطلَب
 * منه شيء قبل أن تُعرَف جهته.
 */
export function groupUnbackedBySupplier(rows: readonly UnbackedPayment[]): UnbackedSupplier[] {
  const groups = new Map<string, UnbackedSupplier>();
  for (const r of rows) {
    const key = r.supplierId ?? "~";
    const g = groups.get(key) ?? {
      supplierId: r.supplierId,
      supplierName: r.supplierName ?? "بلا مورّد",
      supplierSlug: r.supplierSlug,
      totalMinor: 0,
      payments: [],
    };
    g.totalMinor += r.unbackedMinor;
    g.payments.push(r);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.payments.sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  return [...groups.values()].sort(
    (a, b) => Number(a.supplierId === null) - Number(b.supplierId === null) || b.totalMinor - a.totalMinor,
  );
}

/** رسالة «اطلب الفاتورة» — بتاريخ كلّ حوالةٍ ومبلغها، ليبحث بها المورّد في سجلّه. */
export function buildInvoiceRequest(group: UnbackedSupplier): string {
  const lines = group.payments.map((p) =>
    `• ${p.paidOn}: حوالة ${formatRiyalsDisplay(p.amountMinor)} ريال`
    + (p.unbackedMinor < p.amountMinor ? ` — بقي منها بلا فاتورة ${formatRiyalsDisplay(p.unbackedMinor)}` : ""),
  );
  return [
    `السلام عليكم ${group.supplierName}،`,
    ``,
    `حوّلت لكم مؤسسة ذا بوبليك هاوس المبالغ التالية ولم تصلنا فواتيرها:`,
    ...lines,
    ``,
    `نرجو إرسال الفواتير الضريبية باسم المؤسسة ورقمها الضريبي 310007971600003.`,
    `شاكرين لكم.`,
  ].join("\n");
}

/** رسالة «اطلب الكشف» — عن شهرٍ بعينه. */
export function buildStatementRequest(supplierName: string, month: string): string {
  return [
    `السلام عليكم ${supplierName}،`,
    ``,
    `نرجو إرسال كشف حساب مؤسسة ذا بوبليك هاوس (الرقم الضريبي 310007971600003) عن شهر ${month}،`
      + ` بفواتيره وسداداته ورصيده الختاميّ.`,
    `شاكرين لكم.`,
  ].join("\n");
}
