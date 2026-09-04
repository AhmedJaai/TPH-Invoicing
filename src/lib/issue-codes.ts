/** أكواد التنبيهات ونصوصها العربية الثابتة. */

export const ISSUE = {
  DUPLICATE_INVOICE: "DUPLICATE_INVOICE",
  DUPLICATE_FILE: "DUPLICATE_FILE",
  BUYER_VAT_MISMATCH: "BUYER_VAT_MISMATCH",
  MISSING_BUYER_VAT: "MISSING_BUYER_VAT",
  MISSING_SELLER_VAT: "MISSING_SELLER_VAT",
  MISSING_INVOICE_NUMBER: "MISSING_INVOICE_NUMBER",
  NOT_A_TAX_INVOICE: "NOT_A_TAX_INVOICE",
  VAT_MATH_MISMATCH: "VAT_MATH_MISMATCH",
  POSSIBLE_FIXED_ASSET: "POSSIBLE_FIXED_ASSET",
  SUPPLIER_WITHOUT_CONTRACT: "SUPPLIER_WITHOUT_CONTRACT",
  LOW_CONFIDENCE_FIELD: "LOW_CONFIDENCE_FIELD",
  TAX_STATUS_UNKNOWN: "TAX_STATUS_UNKNOWN",
  INVOICE_IN_STATEMENT_NOT_ARCHIVED: "INVOICE_IN_STATEMENT_NOT_ARCHIVED",
  INVOICE_NOT_IN_STATEMENT: "INVOICE_NOT_IN_STATEMENT",
  STATEMENT_AMOUNT_MISMATCH: "STATEMENT_AMOUNT_MISMATCH",
  PAYMENT_WITHOUT_INVOICE: "PAYMENT_WITHOUT_INVOICE",
  PAYMENT_AMOUNT_MISMATCH: "PAYMENT_AMOUNT_MISMATCH",
  DUPLICATE_PAYMENT: "DUPLICATE_PAYMENT",
  EMPLOYEE_ADVANCE_NO_RECEIPTS: "EMPLOYEE_ADVANCE_NO_RECEIPTS",
  STATEMENT_MISSING: "STATEMENT_MISSING",
  UNPOSTED_OVER_A_WEEK: "UNPOSTED_OVER_A_WEEK",
} as const;

export type IssueCode = (typeof ISSUE)[keyof typeof ISSUE];
export type Severity = "INFO" | "WARN" | "BLOCKER";

export const ISSUE_TEXT: Record<IssueCode, { severity: Severity; message: string }> = {
  DUPLICATE_INVOICE: { severity: "BLOCKER", message: "فاتورة مكررة — نفس المورد ونفس رقم الفاتورة موجودان مسبقاً" },
  DUPLICATE_FILE: { severity: "BLOCKER", message: "هذا الملف نفسه مرفوع من قبل" },
  BUYER_VAT_MISMATCH: { severity: "BLOCKER", message: "الرقم الضريبي للمشتري لا يطابق رقم المنشأة" },
  MISSING_BUYER_VAT: { severity: "WARN", message: "فاتورة مبسطة بلا رقم ضريبي للمشتري — لا تصلح لخصم ضريبة المدخلات" },
  MISSING_SELLER_VAT: { severity: "WARN", message: "لا يوجد رقم ضريبي للبائع" },
  MISSING_INVOICE_NUMBER: { severity: "WARN", message: "لا يوجد رقم فاتورة" },
  NOT_A_TAX_INVOICE: { severity: "BLOCKER", message: "عرض سعر أو طلبية مبدئية — لا تُقيَّد كفاتورة" },
  VAT_MATH_MISMATCH: { severity: "WARN", message: "الأرقام غير متسقة: المجموع لا يساوي الصافي زائد الضريبة" },
  POSSIBLE_FIXED_ASSET: { severity: "WARN", message: "أصل ثابت محتمل فوق ٣٬٠٠٠ ريال — يُرسمل ولا يُصرف" },
  SUPPLIER_WITHOUT_CONTRACT: { severity: "WARN", message: "مورد لا يصدر فواتير وبلا عقد توريد" },
  LOW_CONFIDENCE_FIELD: { severity: "WARN", message: "حقول استُخرجت بثقة منخفضة — تحتاج مراجعة بشرية" },
  TAX_STATUS_UNKNOWN: { severity: "WARN", message: "لم يُقرأ التفصيل الضريبي — الحالة مجهولة لا غير صالحة. اقرأ المستند لتُحسم" },
  INVOICE_IN_STATEMENT_NOT_ARCHIVED: { severity: "WARN", message: "فاتورة في كشف المورد وليس لها ملف في الأرشيف" },
  INVOICE_NOT_IN_STATEMENT: { severity: "INFO", message: "فاتورة عندنا ولم ترد في كشف المورد" },
  STATEMENT_AMOUNT_MISMATCH: { severity: "WARN", message: "فرق مبلغ بين الكشف والفاتورة" },
  PAYMENT_WITHOUT_INVOICE: { severity: "WARN", message: "حركة بنكية صادرة بلا فاتورة" },
  PAYMENT_AMOUNT_MISMATCH: { severity: "WARN", message: "المبلغ المسدد يخالف المفوتر" },
  DUPLICATE_PAYMENT: { severity: "BLOCKER", message: "دفعة مكررة لنفس الجهة في نفس اليوم" },
  EMPLOYEE_ADVANCE_NO_RECEIPTS: { severity: "WARN", message: "تحويل لموظف بلا إيصالات مرفقة" },
  STATEMENT_MISSING: { severity: "WARN", message: "لم يصل كشف حساب هذا المورد عن الشهر" },
  UNPOSTED_OVER_A_WEEK: { severity: "WARN", message: "مضى أسبوع على الفاتورة بلا قيد" },
};
