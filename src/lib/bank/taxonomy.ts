/**
 * لغة التسوية.
 *
 * كان النظام يعرف حالتين: طُوبقت أو لم تُطابَق. والواقع أغنى بكثير —
 * «عرفتُ المورّد ولم أجد فاتورة» ليست «لم أعرف المستفيد»، وليست
 * «وجدتُ الفاتورة والمبلغ يخالف». وثلاثتها تحتاج فعلاً مختلفاً.
 *
 * وكان كل وارد يُصنَّف «حركة تشغيلية» — فذهب مليون ومئة ألف ريال من
 * تسويات البطاقات إلى سلّة الضجيج. وهي إيراد المقهى نفسه.
 */

/** ما هي هذه الحركة في عمل المقهى. */
export type TxKind =
  | "SUPPLIER_PAYMENT"   // سداد مورّد
  | "POS_SETTLEMENT"     // تسوية شبكة — إيراد البطاقات يصل الحساب
  | "POS_FEE"            // رسوم شبكة على العملية
  | "POS_VAT"            // ضريبة رسوم الشبكة
  | "BANK_FEE"           // رسوم بنكية
  | "BANK_VAT"           // ضريبة القيمة المضافة على رسم البنك
  | "INTERNAL_TRANSFER"  // بين حسابَي المنشأة
  | "OWNER_TRANSFER"     // سحب المالك أو إيداعه
  | "SALARY"
  | "RENT"
  | "UTILITY"
  | "GOVERNMENT"
  | "ZAKAT"
  | "EXPENSE"
  | "UNKNOWN";

export const KIND_LABEL: Record<TxKind, string> = {
  SUPPLIER_PAYMENT: "سداد مورّد",
  POS_SETTLEMENT: "تسوية شبكة",
  POS_FEE: "رسوم شبكة",
  POS_VAT: "ضريبة رسوم الشبكة",
  BANK_FEE: "رسوم بنكية",
  BANK_VAT: "ضريبة رسوم البنك",
  INTERNAL_TRANSFER: "تحويل داخلي",
  OWNER_TRANSFER: "تحويل المالك",
  SALARY: "راتب أو أجر",
  RENT: "إيجار",
  UTILITY: "كهرباء · مياه · اتصالات",
  GOVERNMENT: "حكومي · تأمينات · ضريبة",
  ZAKAT: "زكاة أو صدقة",
  EXPENSE: "مصروف",
  UNKNOWN: "غير معروفة",
};

/**
 * هذه وحدها إيرادٌ يصل الحساب.
 *
 * تُفصل عن غيرها لأنّ ربطها بالمبيعات لاحقاً هو ما يجيب: «بعتُ تسعة
 * آلاف ووصلني ثمانية آلاف وسبعمئة وستّون — أين الفرق؟»
 */
export const REVENUE_KINDS: readonly TxKind[] = ["POS_SETTLEMENT"];

/** ما يُخصم من إيراد الشبكة قبل أن يصل. */
export const POS_COST_KINDS: readonly TxKind[] = ["POS_FEE", "POS_VAT"];

/** ما لا يُقيَّد مصروفاً ولا يُنسب إلى مورّد. */
export const NON_OPERATIONAL: readonly TxKind[] = [
  "POS_SETTLEMENT", "INTERNAL_TRANSFER", "OWNER_TRANSFER", "UNKNOWN",
];

/**
 * نتيجة محاولة نسبة حركةٍ إلى فواتير.
 *
 * كل حالة تُسمّى بما هي، لا بـ«لم تُطابَق» — لأنّ الفعل المطلوب يختلف:
 * المجهول يحتاج تعريفاً، والمعروف بلا فاتورة يحتاج فاتورة، والمبلغ
 * المخالف يحتاج تحقيقاً.
 */
export type Outcome =
  | "EXACT_INVOICE"           // فاتورة واحدة بمبلغها
  | "MULTI_INVOICE"           // دفعة تسدّد عدّة فواتير
  | "PARTIAL_PAYMENT"         // جزء من فاتورة
  | "OVERPAYMENT"             // أكثر ممّا عليها
  | "AMOUNT_MISMATCH"         // المورّد معروف والمبلغ لا يوافق شيئاً
  | "KNOWN_SUPPLIER_NO_INVOICE" // مورّد معروف بلا فاتورة مفتوحة
  | "UNKNOWN_ENTITY"          // لم يُعرف المستفيد
  | "DUPLICATE_PAYMENT"       // يُشتبه بتكرارها
  | "NOT_A_PAYMENT";          // ليست سداد مورّد أصلاً

export const OUTCOME_LABEL: Record<Outcome, string> = {
  EXACT_INVOICE: "فاتورة بعينها",
  MULTI_INVOICE: "دفعة لعدّة فواتير",
  PARTIAL_PAYMENT: "سداد جزئي",
  OVERPAYMENT: "أكثر من المستحقّ",
  AMOUNT_MISMATCH: "المبلغ لا يوافق فاتورة",
  KNOWN_SUPPLIER_NO_INVOICE: "مورّد معروف بلا فاتورة مفتوحة",
  UNKNOWN_ENTITY: "مستفيد غير معروف",
  DUPLICATE_PAYMENT: "يُشتبه بتكرارها",
  NOT_A_PAYMENT: "ليست سداد مورّد",
};

/** ماذا يفعل النظام بالنتيجة. */
export type Disposition = "AUTO" | "SUGGEST" | "REVIEW";

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  AUTO: "طُوبقت تلقائياً",
  SUGGEST: "اقتراح ينتظر تأكيدك",
  REVIEW: "تحتاج قرارك",
};
