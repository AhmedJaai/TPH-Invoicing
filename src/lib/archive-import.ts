/**
 * إدخال ملف من الأرشيف إلى قاعدة البيانات انطلاقاً من اسمه.
 *
 * منطق مشترك بين الترحيل الأوّل والمزامنة التدريجية، حتى لا يختلف ما يسجّله
 * السكربت عمّا يسجّله التطبيق. الاسم يعطي النوع والتاريخ والمورد والإجمالي؛
 * والتفصيل الضريبي والبنود يأتيان من قراءة المحتوى لاحقاً.
 */
import type { ParsedFileName } from "./naming";

/** نوع المستند في القاعدة، مشتقّاً من نوعه في اسم الملف. */
export const KIND_FROM_NAME: Record<string, string> = {
  INVOICE: "TAX_INVOICE",
  STATEMENT: "STATEMENT",
  RECEIPT: "RECEIPT",
  CASH: "CASH_RECEIPT",
  PROFORMA: "PROFORMA",
  QUOTATION: "QUOTATION",
  LEDGER: "STATEMENT",
  // فاتورة صادرة منّا لا واردة إلينا — تُحفظ ولا تدخل المشتريات
  SALES_INVOICE: "UNKNOWN",
};

export interface ImportPlan {
  documentKind: string;
  /** هل يُنشأ صفّ فاتورة؟ */
  createsInvoice: boolean;
  createsStatement: boolean;
  createsPayment: boolean;
  paymentMethod: "CASH" | "BANK_TRANSFER";
  /** ما يستحق نظر الإنسان — لا يمنع التسجيل */
  notes: string[];
}

/**
 * يقرّر ماذا يُنشأ لهذا الملف.
 *
 * الغياب يُعلَن ولا يُخمَّن: الفاتورة بلا رقم أو بلا مبلغ في اسمها تُسجَّل
 * مستنداً بلا قيد، وتُذكر في الملاحظات كي تُراجَع لا كي تُنسى.
 */
export function planImport(parsed: ParsedFileName, hasSupplier: boolean): ImportPlan {
  const notes: string[] = [];
  const documentKind = KIND_FROM_NAME[parsed.kind] ?? "UNKNOWN";

  if (!hasSupplier && parsed.slug) notes.push(`المورد ${parsed.slug} غير مسجّل`);
  if (parsed.amountMinor === undefined) notes.push("لا مبلغ في الاسم — سُجّل مستنداً بلا قيد");
  if (parsed.monthOnly) notes.push("الاسم يحمل الشهر بلا يوم");
  if (parsed.kind === "INVOICE" && !parsed.invoiceNumber) notes.push("فاتورة بلا رقم في الاسم");
  if (parsed.kind === "SALES_INVOICE") notes.push("فاتورة صادرة منّا — لا تدخل المشتريات");

  const hasAmount = parsed.amountMinor !== undefined;

  return {
    documentKind,
    createsInvoice:
      parsed.kind === "INVOICE" && hasSupplier && Boolean(parsed.invoiceNumber) && hasAmount,
    createsStatement:
      (parsed.kind === "STATEMENT" || parsed.kind === "LEDGER") && hasSupplier && hasAmount,
    createsPayment: (parsed.kind === "RECEIPT" || parsed.kind === "CASH") && hasAmount,
    paymentMethod: parsed.kind === "CASH" ? "CASH" : "BANK_TRANSFER",
    notes,
  };
}
