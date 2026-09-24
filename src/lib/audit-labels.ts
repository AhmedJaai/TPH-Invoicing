/**
 * تسمية القيم الإنجليزيّة في سجلّ التدقيق.
 *
 * كان السجلّ يكتب ما في `jsonb` كما هو: «النوع: MISSING_INVOICES»
 * و«الباب: BANK_FEE». والسجلّ مرجعٌ يُقرأ عند الخلاف — فمن يقرؤه أحمد
 * أو محاسبُه، وكلاهما لا يقرأ أسماء الثوابت في الشيفرة.
 *
 * والقوائم مغلقة، فالتسمية تُؤخذ من مصدرها لا تُكتب ثانيةً: أنواع
 * اقتراحات التحليل من `finding-labels`، وأبواب حركة البنك من `rules`.
 * ومن أضاف نوعاً أو باباً جديداً أوقفه الاختبار حتى يسمّيه.
 */
import { FINDING_LABEL } from "./ai/finding-labels";
import { CATEGORY_LABEL } from "./bank/rules";
import type { AuditAction } from "./audit";

/** قيودٌ قديمة كُتبت بأسماءٍ لم تعد في `AuditAction` — تبقى في السجلّ فتبقى أسماؤها. */
type LegacyAction = "DELETE_DUPLICATE_TRANSACTION" | "BANK_MATCH_UNDONE";

/** قيمٌ إنجليزيّة أخرى تظهر في السجلّ ولا تنتمي إلى قائمةٍ مغلقة. */
const OTHER_VALUE_LABEL: Record<string, string> = {
  SPREADSHEET: "جدول (Excel أو CSV)",
  PDF: "ملفّ PDF",
  IMAGE: "صورة",
  TEXT: "نصّ",
  OWNER: "المالك",
  ACCOUNTANT: "المحاسب",
  PURCHASING: "مدير المشتريات",
  DEBIT: "صادر",
  CREDIT: "وارد",
  /* أبوابُ الهدر وحركاتُ المخزون — قوائمُ مغلقة في `036` */
  EXPIRED: "منتهي الصلاحية",
  SPILLED: "مسكوب",
  FAILED_PREP: "تحضيرٌ فاشل",
  CALIBRATION: "معايرة",
  STAFF_DRINK: "مشروب موظَّف",
  DAMAGED: "تالف",
  OTHER: "سببٌ آخر",
  OPENING: "رصيدٌ افتتاحيّ",
  ADJUST_IN: "تسويةٌ بالزيادة",
  ADJUST_OUT: "تسويةٌ بالنقص",
  TRANSFER_IN: "نقلٌ وارد",
  TRANSFER_OUT: "نقلٌ صادر",
};

export const VALUE_LABEL: Record<string, string> = {
  ...FINDING_LABEL,
  ...CATEGORY_LABEL,
  ...OTHER_VALUE_LABEL,
};

/**
 * القيمة كما تُقرأ. وما لا تسمية له يبقى كما هو — فإخفاؤه أسوأ من
 * عرضه بالإنجليزيّة: السجلّ لا يُخفي شيئاً وقع.
 */
export function labelValue(value: unknown): string {
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  const raw = String(value);
  return VALUE_LABEL[raw] ?? raw;
}

/**
 * اسمُ الفعل في السجلّ — يقرؤه صاحبُ المقهى ومحاسبُه لا مبرمج.
 *
 * مفاتيحُه `AuditAction` كلُّها بحكم النوع: كان ستّةَ عشر فعلاً بلا اسم
 * — منها «تصحيح حقول فاتورة» و«إعادة قراءة مستند» — فتُكتب في السجلّ
 * بالإنجليزيّة. ومن أضاف فعلاً ولم يسمّه أوقفه `tsc`.
 */
export const ACTION_LABEL: Record<AuditAction | LegacyAction, string> = {
  DOCUMENT_UPLOADED: "رفع مستند",
  DOCUMENT_ARCHIVED: "أرشفة مستند",
  DOCUMENT_REJECTED: "رفض مستند",
  FIELD_CORRECTED: "تصحيح حقل",
  SUPPLIER_CREATED: "إنشاء مورّد",
  SUPPLIER_UPDATED: "تعديل مورّد",
  ISSUE_WAIVED: "تجاوز تنبيه",
  MONTH_CLOSED: "إقفال شهر",
  USER_ROLE_CHANGED: "تغيير دور",
  DRIVE_SYNCED: "مزامنة الدرايف",
  BANK_IMPORTED: "استيراد كشف بنك",
  INVOICES_MARKED_PAID: "وسم فواتير مسدَّدة",
  SUPPLIER_ALIAS_LEARNED: "تعلّم اسم بنكي",
  STATEMENT_RECONCILED: "مطابقة كشف مورّد",
  PRODUCT_LINKED: "ربط صنف معياري",
  PRODUCT_UNLINKED: "فكّ ربط صنف",
  EXPENSE_ADDED: "إضافة مصروف",
  EXPENSE_REMOVED: "حذف مصروف أو تعطيله",
  EXPENSE_REACTIVATED: "إعادة تفعيل مصروف متكرّر",
  INVOICE_PAID_BY_OWNER: "سداد فاتورة من حساب المالك",
  SUPPLIER_CREDIT_APPLIED: "خصم رصيد المورّد من فاتورة",
  AI_ANALYSIS_RUN: "تحليل الذكاء لحساب مورّد",
  AI_FINDING_DECIDED: "قرارٌ في اقتراح الذكاء",
  COUNTERPARTY_CONFIRMED: "تعريف جهة",
  BANK_RULE_LEARNED: "قاعدة تصنيف بنكية",
  MONTH_REOPENED: "إعادة فتح شهر",
  MATCH_CONFIRMED: "تقييد حوالة على فواتير",
  MATCH_UNDONE: "تراجع عن مطابقة",
  MATCH_REJECTED: "إعلان «ليست سداداً»",
  PAYMENT_RECORDED: "قيد دفعة",
  DRIVE_FILE_RENAMED: "إعادة تسمية في الدرايف",
  PAYMENT_RUN_EXPORTED: "تنزيل ملف التحويلات",
  ACCOUNTANT_PACK_EXPORTED: "تنزيل حزمة المحاسب",
  EXPENSES_DERIVED: "اشتقاق المصروفات من البنك",
  EXPENSE_RECLASSIFIED: "مصروفٌ تبع تصنيف حركته",
  RECONCILIATION_BALANCES_SET: "رصيدا الشهر في التسوية",
  DOCUMENT_STATUS_CHANGED: "تغيير حال مستند",
  INVOICE_FIELDS_CORRECTED: "تصحيح حقول فاتورة",
  DOCUMENT_REREAD: "إعادة قراءة مستند",
  ALERT_RESOLVED: "إغلاق تنبيه",
  BANK_RULE_DELETED: "حذف قاعدة تصنيف",
  PAYMENT_VOIDED: "إلغاء دفعة",
  CATALOG_IMPORTED: "استيراد كتالوج فودكس",
  RECIPE_VERSION_CORRECTED: "تصحيح نسخة وصفة",
  RECIPE_DELETED: "حذف وصفة",
  STOCK_ITEM_RETIRED: "إيقاف صنف مخزون",
  INVENTORY_COUNT_SCOPE_SET: "تحديد نطاق الجرد",
  INVENTORY_OPENING_SET: "رصيد افتتاحي للمخزون",
  INVENTORY_OPENING_CLEARED: "مسح رصيد افتتاحي",
  INVENTORY_RECEIPT_CREATED: "قيد استلام بضاعة",
  INVENTORY_RECEIPT_UPDATED: "تعديل استلام بضاعة",
  INVENTORY_RECEIPT_VOIDED: "إلغاء استلام بضاعة",
  INVENTORY_RECEIPT_RESOLVED: "حسم استلام بضاعة",
  /* الجرد وتسوية المخزون */
  SALES_IMPORTED: "استيراد ملفّ مبيعات",
  POS_PRODUCT_MAPPED: "ربط صنف فودكس",
  POS_PRODUCT_UNMAPPED: "فكّ ربط صنف فودكس",
  RECIPE_CREATED: "إنشاء وصفة",
  RECIPE_VERSION_SAVED: "حفظ نسخة وصفة",
  RECIPE_VERSION_ACTIVATED: "تفعيل نسخة وصفة",
  INVENTORY_COUNT_STARTED: "بدء جرد",
  INVENTORY_COUNT_LINE_EDITED: "تعديل عدٍّ فعليّ",
  INVENTORY_COUNT_FINALISED: "إقفال جرد",
  INVENTORY_COUNT_REOPENED: "إعادة فتح جرد",
  INVENTORY_MOVEMENT_RECORDED: "قيد حركة مخزون",
  WASTE_RECORDED: "تسجيل هدر",
  /* قيودٌ قديمة كُتبت قبل أن يكون لها اسم */
  DELETE_DUPLICATE_TRANSACTION: "حذف حركة مكرَّرة",
  BANK_MATCH_UNDONE: "تراجع عن مطابقة",
};

/** نوعُ ما وقع عليه الفعل — بالعربية لا باسم الجدول. */
export const ENTITY_LABEL: Record<string, string> = {
  bank_transaction: "حركة بنك",
  payment: "دفعة",
  bank_import: "استيراد كشف",
  bank_rule: "قاعدة بنك",
  document: "مستند",
  invoice: "فاتورة",
  supplier: "مورّد",
  counterparty: "جهة",
  statement: "كشف مورّد",
  month_close: "إقفال شهر",
  expense: "مصروف",
  drive: "الدرايف",
  drive_sync: "مزامنة الدرايف",
  payment_run: "دفعة الشهر",
  product: "صنف",
  ai_finding: "اقتراح ذكاء",
  sales_import: "استيراد مبيعات",
  pos_product: "صنف فودكس",
  recipe: "وصفة",
  recipe_version: "نسخة وصفة",
  inventory_count: "جرد",
  inventory_count_line: "سطر جرد",
  inventory_movement: "حركة مخزون",
  waste_record: "هدر مسجَّل",
};

/** اسمُ فعلٍ مقروءٍ من القاعدة — وما لا اسم له يُعرَض كما هو ولا يُخفى. */
export function actionLabel(action: string): string {
  const labels: Readonly<Record<string, string>> = ACTION_LABEL;
  return labels[action] ?? action;
}
