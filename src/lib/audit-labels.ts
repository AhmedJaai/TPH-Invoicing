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
  AUDITOR: "المراجع",
  DEBIT: "صادر",
  CREDIT: "وارد",
  /* أبوابُ الهدر وحركاتُ المخزون — قوائمُ مغلقة في `036` */
  EXPIRED: "منتهي الصلاحية",
  SPILLED: "مسكوب",
  FAILED_PREP: "تحضير فاشل",
  CALIBRATION: "معايرة",
  STAFF_DRINK: "مشروب موظّف",
  DAMAGED: "تالف",
  OTHER: "سبب آخر",
  OPENING: "رصيد افتتاحي",
  ADJUST_IN: "تسوية بالزيادة",
  ADJUST_OUT: "تسوية بالنقص",
  TRANSFER_IN: "نقل وارد",
  TRANSFER_OUT: "نقل صادر",
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
  DOCUMENT_CAPTURE_LINK_CREATED: "إنشاء رابط تصوير لموظف",
  DOCUMENT_CAPTURE_LINK_REVOKED: "إلغاء رابط تصوير",
  DOCUMENT_CAPTURE_REJECTED: "رفض صورة من الفريق",
  FIELD_CORRECTED: "تصحيح حقل",
  SUPPLIER_CREATED: "إنشاء مورّد",
  SUPPLIER_UPDATED: "تعديل مورّد",
  ISSUE_WAIVED: "تجاوز تنبيه",
  MONTH_CLOSED: "إقفال شهر",
  USER_ROLE_CHANGED: "تغيير دور",
  USER_ACCESS_CHANGED: "تعطيل مستخدم أو تفعيله",
  USER_SESSIONS_ENDED: "إنهاء جلسات مستخدم",
  DRIVE_SYNCED: "مزامنة الدرايف",
  BANK_IMPORTED: "استيراد كشف بنك",
  INVOICES_MARKED_PAID: "تسجيل فواتير مسدّدة",
  SUPPLIER_ALIAS_LEARNED: "تعلّم اسم بنكي",
  STATEMENT_RECONCILED: "مطابقة كشف مورّد",
  PRODUCT_LINKED: "ربط صنف معياري",
  SUPPLIER_ITEM_MERGED: "دمج صيغة صنف في الصنف الأصلي",
  PAYMENT_REALLOCATED: "إعادة توزيع حوالة على الأقدم أولاً",
  STATEMENT_INVOICES_RECORDED: "تسجيل فواتير من كشف المورّد",
  SUPPLIER_VAT_LEARNED: "تعلّم الرقم الضريبي للمورّد",
  PRODUCT_UNLINKED: "فكّ ربط صنف",
  EXPENSE_ADDED: "إضافة مصروف",
  EXPENSE_REMOVED: "حذف مصروف أو تعطيله",
  EXPENSE_REACTIVATED: "إعادة تفعيل مصروف متكرّر",
  INVOICE_PAID_BY_OWNER: "سداد فاتورة من حساب المالك",
  DOCUMENT_BLOCKER_OVERRIDDEN: "أرشفة رغم مانع أقرّ به صاحب العمل",
  OWNER_PAYMENT_SOURCE_SET: "تحديد مصدر سداد المالك (من تحويلات المقهى أو من ماله الخاص)",
  SUPPLIER_CREDIT_APPLIED: "خصم رصيد المورّد من فاتورة",
  AI_ANALYSIS_RUN: "تحليل الذكاء لحساب مورّد",
  AI_FINDING_DECIDED: "قرار في اقتراح الذكاء",
  COUNTERPARTY_CONFIRMED: "تعريف جهة",
  BANK_RULE_LEARNED: "قاعدة تصنيف بنكية",
  MONTH_REOPENED: "إعادة فتح شهر",
  MATCH_CONFIRMED: "تسجيل حوالة على فواتير",
  MATCH_UNDONE: "تراجع عن مطابقة",
  MATCH_REJECTED: "تسجيل «ليست سداداً»",
  PAYMENT_RECORDED: "تسجيل دفعة",
  DRIVE_FILE_RENAMED: "إعادة تسمية في الدرايف",
  DRIVE_FILE_RENAME_INTENT: "تسمية ملفّ في الدرايف",
  DRIVE_FILE_RENAME_FAILED: "تسمية في الدرايف لم تقع",
  DRIVE_NAME_CHANGED_EXTERNALLY: "اسم غُيّر في الدرايف يدوياً",
  PAYMENT_RUN_EXPORTED: "تنزيل ملف التحويلات",
  PAYMENT_HOLD_OVERRIDDEN: "إضافة فاتورة موقوفة إلى الدفعة بقرار المالك",
  PAYMENT_HOLD_RESTORED: "إعادة فاتورة إلى الإيقاف",
  DOCUMENT_AUTO_PAUSED: "إيقاف العمل الآليّ",
  DOCUMENT_AUTO_RESUMED: "تشغيل العمل الآليّ",
  ACCOUNTANT_PACK_EXPORTED: "تنزيل حزمة المحاسب",
  EXPENSES_DERIVED: "اشتقاق المصروفات من البنك",
  EXPENSE_RECLASSIFIED: "مصروف تغيّر بتغيّر تصنيف حركته",
  RECONCILIATION_BALANCES_SET: "رصيدا الشهر في التسوية",
  DOCUMENT_STATUS_CHANGED: "تغيير حالة مستند",
  INVOICE_FIELDS_CORRECTED: "تصحيح حقول فاتورة",
  INVOICE_REPLACED: "فاتورة مصحّحة حلّت محل الفاتورة المسجّلة",
  INVOICE_MERGED: "نسخة مكرّرة دُمجت في هذه الفاتورة",
  DOCUMENT_REREAD: "إعادة قراءة مستند",
  DOCUMENT_RECORDED_BY_HAND: "تسجيل فاتورة من مستند يدوياً",
  ALERT_RESOLVED: "إغلاق تنبيه",
  SUPPLIER_REQUEST_SENT: "مطالبة مورّد بفواتيره",
  DOCUMENT_EXPIRY_SAVED: "حفظ وثيقة بتاريخ انتهائها",
  DOCUMENT_EXPIRY_CLOSED: "أرشفة وثيقة أو إعادتها",
  PAYMENT_CASH_FLOOR_SET: "ضبط حدّ الرصيد الأدنى",
  BANK_HELD_ROW_RESOLVED: "قرار في سطر كشف غير واضح",
  BANK_ACCOUNT_UPDATED: "تعديل بيانات حساب بنكيّ",
  BANK_RULE_DELETED: "حذف قاعدة تصنيف",
  PAYMENT_VOIDED: "إلغاء دفعة",
  PAYMENT_ECHO_MERGED: "دمج دفعة سُجّلت مرتين",
  BANK_CREDIT_UNDRAWN: "فكّ حوالة عن فاتورة",
  HAND_PAYMENT_LINKED: "ربط حوالة بسداد سُجّل يدوياً",
  PAYMENT_CREDIT_NOTE_RECORDED: "إشعار دائن من المورّد على فاتورة",
  CATALOG_IMPORTED: "استيراد كتالوج فودكس",
  RECIPE_VERSION_CORRECTED: "تصحيح نسخة وصفة",
  RECIPE_DELETED: "حذف وصفة",
  STOCK_ITEM_RETIRED: "إيقاف صنف مخزون",
  STOCK_ITEM_RESTORED: "إعادة صنف مخزون",
  INVENTORY_COUNT_SCOPE_SET: "تحديد نطاق الجرد",
  INVENTORY_OPENING_SET: "رصيد افتتاحي للمخزون",
  INVENTORY_OPENING_CLEARED: "مسح رصيد افتتاحي",
  INVENTORY_RECEIPT_CREATED: "تسجيل استلام بضاعة",
  INVENTORY_RECEIPT_UPDATED: "تعديل استلام بضاعة",
  INVENTORY_RECEIPT_VOIDED: "إلغاء استلام بضاعة",
  INVENTORY_RECEIPT_RESOLVED: "قرار في استلام بضاعة",
  /* الجرد وتسوية المخزون */
  SALES_IMPORTED: "استيراد ملفّ مبيعات",
  SUPPLIER_FOODICS_LINKED: "ربط مورّد فودكس بمورّد",
  EMPLOYEE_SAVED: "حفظ بيانات موظف",
  EMPLOYEE_DELETED: "حذف موظف أُضيف خطأً",
  EMPLOYEE_RATE_SET: "تحديد راتب موظف",
  EMPLOYEE_RATE_REMOVED: "حذف تغيير في راتب موظف",
  PAYROLL_ADJUSTMENT_ADDED: "إضافة خصم أو سلفة أو مكافأة",
  PAYROLL_ADJUSTMENT_VOIDED: "سحب خصم أو سلفة أو مكافأة",
  PAYROLL_ATTENDANCE_SET: "تسجيل تأخير أو غياب",
  PAYROLL_ATTENDANCE_CLEARED: "مسح تأخير أو غياب",
  PAYROLL_WEEK_SET: "تسجيل أسبوع موظف جزئي",
  PAYROLL_WEEK_CLEARED: "مسح أسبوع موظف جزئي",
  PAYROLL_LINKED: "ربط حوالة بموظف",
  PAYROLL_UNLINKED: "فكّ ربط حوالة بموظف",
  PAYROLL_VIOLATION_ADDED: "تسجيل مخالفة من لائحة تنظيم العمل",
  PAYROLL_VIOLATION_VOIDED: "سحب مخالفة مسجّلة",
  PAYROLL_PENALTY_WAIVED: "العفو عن جزاء مخالفة",
  PAYROLL_PENALTY_RESTORED: "إعادة جزاء بعد العفو",
  EMPLOYEE_CHECKIN_LINK_ISSUED: "إنشاء رابط حضور لموظف",
  EMPLOYEE_CHECKIN_LINK_REVOKED: "إلغاء رابط حضور موظف",
  ATTENDANCE_SETTINGS_SET: "ضبط موقع المقهى أو شبكته للحضور",
  ATTENDANCE_CHECKIN_REVIEWED: "قبول أو رد تسجيل حضور",
  FINANCE_DECLARATION_CREATED: "إضافة مصروف خارج الكشف أو توزيعه",
  FINANCE_DECLARATION_VOIDED: "سحب إضافة مالية",
  FINANCE_PNL_FROZEN: "تجميد قائمة دخل شهر",
  POS_PRODUCT_MAPPED: "ربط صنف فودكس",
  POS_PRODUCT_UNMAPPED: "فكّ ربط صنف فودكس",
  RECIPE_CREATED: "إنشاء وصفة",
  RECIPE_VERSION_SAVED: "حفظ نسخة وصفة",
  RECIPE_VERSION_ACTIVATED: "تفعيل نسخة وصفة",
  INVENTORY_COUNT_STARTED: "بدء جرد",
  INVENTORY_COUNT_LINE_EDITED: "تعديل عدّ فعليّ",
  INVENTORY_COUNT_FINALISED: "إقفال جرد",
  INVENTORY_COUNT_REOPENED: "إعادة فتح جرد",
  INVENTORY_COUNT_DISCARDED: "إلغاء جرد لم يُقفل",
  INVENTORY_MOVEMENT_RECORDED: "تسجيل حركة مخزون",
  WASTE_RECORDED: "تسجيل هدر",
  WASTE_VOIDED: "إبطال هدر مسجّل",
  VAT_TX_CHOSEN: "اختيار حركة في إقرار الضريبة",
  VAT_INVOICE_CHOSEN: "اعتماد فاتورة في خصم الضريبة",
  VAT_RETURN_FILED: "تقديم إقرار الضريبة",
  VAT_FILING_VOIDED: "تراجع عن تسجيل تقديم الإقرار",
  VAT_CASH_SALES_SET: "مبيعات النقد في إقرار الضريبة",
  VAT_RETURN_EXPORTED: "تنزيل سجلّ إقرار الضريبة",
  /* قيودٌ قديمة كُتبت قبل أن يكون لها اسم */
  DELETE_DUPLICATE_TRANSACTION: "حذف حركة مكرّرة",
  BANK_MATCH_UNDONE: "تراجع عن مطابقة",
};

/** نوعُ ما وقع عليه الفعل — بالعربية لا باسم الجدول. */
export const ENTITY_LABEL: Record<string, string> = {
  bank_transaction: "حركة بنك",
  payment: "دفعة",
  bank_import: "استيراد كشف",
  bank_rule: "قاعدة بنك",
  document: "مستند",
  obligation: "وثيقة بتاريخ انتهاء",
  setting: "إعداد",
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
  waste_record: "هدر مسجّل",
  employee: "موظف",
  employee_rate: "راتب موظف",
  payroll_adjustment: "خصم أو إضافة على راتب",
  payroll_attendance: "تأخير أو غياب",
  payroll_week: "أسبوع موظف جزئي",
  payroll_link: "ربط حوالة براتب",
  attendance_checkin: "تسجيل حضور",
  payroll_violation: "مخالفة من لائحة تنظيم العمل",
};

/** اسمُ فعلٍ مقروءٍ من القاعدة — وما لا اسم له يُعرَض كما هو ولا يُخفى. */
export function actionLabel(action: string): string {
  const labels: Readonly<Record<string, string>> = ACTION_LABEL;
  return labels[action] ?? action;
}
