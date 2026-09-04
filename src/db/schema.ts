/**
 * مخطط قاعدة البيانات — نظام فواتير مؤسسة ذا بوبليك هاوس
 *
 * قاعدتان تسريان على الملف كله:
 *  ١. كل المبالغ تُخزَّن بالهللات كأعداد صحيحة (١٠٠ هللة = ريال) — لا فاصلة عائمة إطلاقاً.
 *  ٢. كل شهر محاسبي نصٌّ بصيغة YYYY-MM مشتقٌّ من تاريخ الفاتورة لا تاريخ الرفع.
 */
import {
  pgTable, pgEnum, text, integer, boolean, timestamp, jsonb,
  doublePrecision, numeric, uniqueIndex, index, primaryKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createId } from "@/lib/id";

const id = () => text("id").primaryKey().$defaultFn(createId);
const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ───────────────────────── الهوية والصلاحيات ───────────────────────── */

export const roleEnum = pgEnum("role", [
  "OWNER",      // المالك — كل شيء
  "ACCOUNTANT", // المحاسب — كل المالية عدا إدارة المستخدمين
  "PURCHASING", // مدير المشتريات — الرفع والمتابعة فقط
]);

export const users = pgTable("users", {
  id: id(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  role: roleEnum("role").notNull().default("PURCHASING"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: now(),
});

/** جدول Auth.js — يحمل أيضاً refresh_token الخاص بجوجل للرفع للدرايف بصلاحية المستخدم */
export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.identifier, t.token] })]);

/* ───────────────────────── الموردون ───────────────────────── */

export const supplierCategoryEnum = pgEnum("supplier_category", [
  "COFFEE", "FOOD", "PACKAGING", "EQUIPMENT", "WATER", "UTILITIES", "OTHER",
]);

export const billingCycleEnum = pgEnum("billing_cycle", [
  "PER_DELIVERY",      // فاتورة لكل توريد
  "MONTHLY_STATEMENT", // كشف شهري فقط بلا فواتير
]);

export const suppliers = pgTable("suppliers", {
  id: id(),
  /** الاسم المختصر داخل أسماء الملفات، مثل OliveLeaves */
  slug: text("slug").notNull().unique(),
  /** اسم المجلد في الدرايف حرفياً، مثل "Olive Leaves" — يخالف الـslug غالباً */
  driveFolderName: text("drive_folder_name").notNull(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en"),

  vatNumber: text("vat_number").unique(),
  crNumber: text("cr_number"),

  category: supplierCategoryEnum("category").notNull().default("OTHER"),
  billingCycle: billingCycleEnum("billing_cycle").notNull().default("PER_DELIVERY"),
  paymentTerms: text("payment_terms"),

  /** مورد لا يصدر فواتير ضريبية — أوسكا · البراونيز · فلاتر المياه */
  issuesInvoices: boolean("issues_invoices").notNull().default(true),
  /** وُقّع معه عقد توريد — يمنع تكرار التنبيه كل مرة */
  contractOnFile: boolean("contract_on_file").notNull().default(false),
  contractDriveFileId: text("contract_drive_file_id"),

  /** حد الرصيد الذي يفتح تنبيهاً، بالهللات. فارغ = بلا حد */
  balanceAlertMinor: integer("balance_alert_minor"),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("suppliers_active_idx").on(t.isActive)]);

export const aliasKindEnum = pgEnum("alias_kind", [
  "BANK_BENEFICIARY", // اسم المستفيد في كشف البنك
  "NAME_VARIANT",
  "VAT",
  "FOLDER",
]);

export const aliasSourceEnum = pgEnum("alias_source", [
  "MIGRATION", // مستخرج من ترحيل الأرشيف
  "MANUAL",
  "LEARNED",   // تعلّمه النظام بعد مطابقة يدوية
]);

export const supplierAliases = pgTable("supplier_aliases", {
  id: id(),
  supplierId: text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  value: text("value").notNull(),
  /** القيمة بعد التطبيع للمطابقة السريعة */
  normalized: text("normalized").notNull(),
  kind: aliasKindEnum("kind").notNull(),
  source: aliasSourceEnum("source").notNull().default("MANUAL"),
  confidence: doublePrecision("confidence").notNull().default(1),
  createdAt: now(),
}, (t) => [
  uniqueIndex("supplier_alias_uniq").on(t.supplierId, t.normalized, t.kind),
  index("supplier_alias_normalized_idx").on(t.normalized),
]);

/* ───────────────────────── المستندات ───────────────────────── */

export const documentKindEnum = pgEnum("document_kind", [
  "TAX_INVOICE",        // فاتورة ضريبية كاملة
  "SIMPLIFIED_INVOICE", // مبسطة — لا خصم مدخلات
  "STATEMENT",
  "QUOTATION",          // عرض سعر — لا يُقيَّد
  "PROFORMA",           // مبدئية — لا تُقيَّد
  "RECEIPT",
  "CASH_RECEIPT",
  "CONTRACT",
  "UTILITY",
  "UNKNOWN",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "PENDING", "EXTRACTED", "NEEDS_REVIEW", "ARCHIVED", "REJECTED",
]);

export const documents = pgTable("documents", {
  id: id(),
  driveFileId: text("drive_file_id").unique(),
  driveFolderId: text("drive_folder_id"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  /** بصمة المحتوى — تكشف رفع نفس الملف مرتين ولو اختلف اسمه */
  sha256: text("sha256"),

  kind: documentKindEnum("kind").notNull().default("UNKNOWN"),
  status: documentStatusEnum("status").notNull().default("PENDING"),
  periodMonth: text("period_month"),
  supplierId: text("supplier_id").references(() => suppliers.id),

  rawText: text("raw_text"),
  /** أي مسار استُخدم: نص مضمّن أم رؤية */
  textSource: text("text_source"),
  /** مخرجات النموذج الخام قبل أي تصحيح يدوي — لا تُعدَّل أبداً */
  extractionJson: jsonb("extraction_json"),
  extractionModel: text("extraction_model"),
  /** ثقة كل حقل على حدة، لتلوين الحقول منخفضة الثقة بالأصفر */
  fieldConfidence: jsonb("field_confidence"),

  uploadedById: text("uploaded_by_id").references(() => users.id),
  uploadedAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /*
   * البصمة فريدة: الملف نفسه لا يدخل النظام مرّتين مهما اختلف اسمه.
   * كان الفحص في الكود وحده — وهو يفلت من طلبين متزامنين، والقاعدة لا تفلت.
   *
   * والمحجور مستثنى: النسخة المكرّرة تبقى مسجّلةً ببصمتها لتُعرف، ولا
   * تمنع الأصل. حذف السجلّ كان سيُخفي أنّ الرفع وقع أصلاً.
   */
  uniqueIndex("documents_sha_uniq").on(t.sha256).where(sql`status <> 'REJECTED'`),
  index("documents_period_supplier_idx").on(t.periodMonth, t.supplierId),
  index("documents_status_idx").on(t.status),
]);

/* ───────────────────────── الفواتير ───────────────────────── */

/**
 * حالة الفاتورة ضريبياً.
 *
 * الراية الثنائية كانت تكذب: `false` تعني «ليست ضريبية» و«لا نعرف» معاً.
 * وأكثر فواتير الأرشيف رُحّلت من أسماء الملفات بلا تفصيل ضريبي، فوُسمت
 * كلّها «غير صالحة» — وهي في الحقيقة **مجهولة**. والفرق ليس لفظياً: الأولى
 * تُطالِب المورّد ببديل، والثانية تُطالِبنا نحن بقراءة المستند.
 */
export const taxStatusEnum = pgEnum("tax_status", [
  "VALID",          // تحمل الأركان الأربعة
  "INVALID",        // ينقصها ركن معلوم
  "UNKNOWN",        // لم يُقرأ تفصيلها الضريبي بعد
  "NOT_APPLICABLE", // عرض سعر أو مبدئية — لا تُقيَّد أصلاً
]);

export const inputVatStatusEnum = pgEnum("input_vat_status", [
  "ELIGIBLE",
  "NOT_ELIGIBLE",
  "UNKNOWN",
]);

export const invoices = pgTable("invoices", {
  id: id(),
  documentId: text("document_id").notNull().unique().references(() => documents.id, { onDelete: "cascade" }),
  supplierId: text("supplier_id").notNull().references(() => suppliers.id),

  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }).notNull(),
  /** شهر الأرشفة — شهر تاريخ الفاتورة إلا إذا رُحّلت */
  periodMonth: text("period_month").notNull(),

  /**
   * الصافي والضريبة يقبلان الفراغ عمداً: `null` تعني «لم يُقرأ» لا «صفر».
   * الإجمالي وحده إلزامي — لا تُقيَّد فاتورة بلا مبلغ.
   */
  subtotalMinor: integer("subtotal_minor"),
  vatMinor: integer("vat_minor"),
  totalMinor: integer("total_minor").notNull(),

  sellerVat: text("seller_vat"),
  buyerVat: text("buyer_vat"),

  /** الأركان الأربعة: رقم + ضريبي بائع + ضريبي مشترٍ مطابق + تفصيل ضريبة */
  taxStatus: taxStatusEnum("tax_status").notNull().default("UNKNOWN"),
  inputVatStatus: inputVatStatusEnum("input_vat_status").notNull().default("UNKNOWN"),
  /** معدّة فوق ٣٬٠٠٠ ريال — تُرسمل ولا تُصرف */
  isFixedAsset: boolean("is_fixed_asset").notNull().default(false),

  postedToAccounting: boolean("posted_to_accounting").notNull().default(false),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postingRef: text("posting_ref"),

  /** إن رُحّلت من شهر سابق، الشهر الأصلي هنا ليبقى الأثر مرئياً */
  carriedForwardFrom: text("carried_forward_from"),

  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("invoice_supplier_number_uniq").on(t.supplierId, t.invoiceNumber),
  index("invoices_period_idx").on(t.periodMonth),
  index("invoices_date_idx").on(t.invoiceDate),
  index("invoices_posted_idx").on(t.postedToAccounting),
  index("invoices_tax_status_idx").on(t.taxStatus),
]);

export const invoiceLines = pgTable("invoice_lines", {
  id: id(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  /** الوصف بعد التطبيع — عليه يقوم تجميع الأصناف وتتبّع الأسعار */
  normalizedDescription: text("normalized_description").notNull().default(""),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull().default("1"),
  /**
   * السعر الفعلي للوحدة — ما دُفع، لا ما في القائمة.
   * النموذج ينسخ سعر القائمة أحياناً والإجمالي بعد الخصم، فيصير الضرب
   * لا يستقيم. عليه وحده يقوم تتبّع الأسعار. راجع lib/line-pricing.ts
   */
  unitPriceMinor: integer("unit_price_minor").notNull(),
  lineTotalMinor: integer("line_total_minor").notNull(),
  /** سعر القائمة قبل الخصم، إن خالف الفعلي */
  listUnitPriceMinor: integer("list_unit_price_minor"),
  discountMinor: integer("discount_minor").notNull().default(0),
  /** كيف سُوّي التعارض: CONSISTENT · DISCOUNTED · TOTAL_INCLUDES_VAT · DERIVED · INCONSISTENT */
  pricingBasis: text("pricing_basis"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.15"),
  /** تاريخ الفاتورة منسوخ هنا لتتبّع الأسعار بلا ربط في كل استعلام */
  invoiceDate: timestamp("invoice_date", { withTimezone: true }),
  supplierId: text("supplier_id").references(() => suppliers.id),
  /** صنف المورّد، ومنه إلى الصنف المعياري */
  supplierProductId: text("supplier_product_id"),
}, (t) => [
  index("invoice_lines_invoice_idx").on(t.invoiceId),
  index("invoice_lines_supplier_product_idx").on(t.supplierProductId),
  index("invoice_lines_item_idx").on(t.normalizedDescription),
  index("invoice_lines_item_date_idx").on(t.normalizedDescription, t.invoiceDate),
]);

/* ───────────────────────── كشوف الموردين ───────────────────────── */

export const statements = pgTable("statements", {
  id: id(),
  documentId: text("document_id").notNull().unique().references(() => documents.id, { onDelete: "cascade" }),
  supplierId: text("supplier_id").notNull().references(() => suppliers.id),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  openingBalanceMinor: integer("opening_balance_minor").notNull().default(0),
  closingBalanceMinor: integer("closing_balance_minor").notNull().default(0),
  createdAt: now(),
}, (t) => [index("statements_supplier_end_idx").on(t.supplierId, t.periodEnd)]);

export const matchStatusEnum = pgEnum("match_status", [
  "UNMATCHED", "MATCHED", "PARTIAL",
  "DISPUTED", // فرق مبلغ
  "IGNORED",
]);

export const statementLines = pgTable("statement_lines", {
  id: id(),
  statementId: text("statement_id").notNull().references(() => statements.id, { onDelete: "cascade" }),
  date: timestamp("date", { withTimezone: true }).notNull(),
  ref: text("ref"),
  description: text("description"),
  debitMinor: integer("debit_minor").notNull().default(0),
  creditMinor: integer("credit_minor").notNull().default(0),
  matchedInvoiceId: text("matched_invoice_id").references(() => invoices.id),
  matchStatus: matchStatusEnum("match_status").notNull().default("UNMATCHED"),
}, (t) => [
  index("statement_lines_statement_idx").on(t.statementId),
  index("statement_lines_status_idx").on(t.matchStatus),
]);

/* ───────────────────────── المدفوعات ───────────────────────── */

export const paymentMethodEnum = pgEnum("payment_method", [
  "BANK_TRANSFER",
  "CASH",
  "EMPLOYEE_ADVANCE", // تحويل لموظف — يفتح تنبيهاً حتى تصل الإيصالات
]);

export const payments = pgTable("payments", {
  id: id(),
  documentId: text("document_id").unique().references(() => documents.id),
  supplierId: text("supplier_id").references(() => suppliers.id),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  amountMinor: integer("amount_minor").notNull(),
  method: paymentMethodEnum("method").notNull().default("BANK_TRANSFER"),
  /** اسم المستفيد كما ورد في الإيصال أو البنك — قد يخالف اسم المورد تماماً */
  beneficiaryNameRaw: text("beneficiary_name_raw"),
  /** الشهر الذي تخصّه الدفعة، لا شهر التحويل */
  appliesToMonth: text("applies_to_month"),
  createdAt: now(),
}, (t) => [
  index("payments_supplier_date_idx").on(t.supplierId, t.paidAt),
  index("payments_applies_month_idx").on(t.appliesToMonth),
]);

export const paymentAllocations = pgTable("payment_allocations", {
  id: id(),
  paymentId: text("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amountMinor: integer("amount_minor").notNull(),
}, (t) => [uniqueIndex("payment_allocation_uniq").on(t.paymentId, t.invoiceId)]);

/* ───────────────────────── كشف البنك ───────────────────────── */

export const bankImports = pgTable("bank_imports", {
  id: id(),
  fileName: text("file_name").notNull(),
  /** بصمة الملف — استيراده ثانيةً يُعرف بها ولا يُكرَّر */
  fileSha256: text("file_sha256"),
  bank: text("bank"),
  accountNumber: text("account_number"),
  rowCount: integer("row_count").notNull().default(0),
  /** حركات دخلت فعلاً في هذا الاستيراد، بعد استبعاد المكرّر */
  newRowCount: integer("new_row_count").notNull().default(0),
  importedById: text("imported_by_id").references(() => users.id),
  importedAt: now(),
}, (t) => [uniqueIndex("bank_imports_file_sha_uniq").on(t.fileSha256)]);

export const txDirectionEnum = pgEnum("tx_direction", ["DEBIT", "CREDIT"]);

/**
 * تصنيف الحركة البنكية.
 *
 * كشف الحساب ليس كلّه مورّدين: فيه رواتب وإيجار وزكاة وكهرباء وتحويلات
 * شخصية للمالك. وعرضها كلّها «مدفوعات مورّدين مجهولة» يغرق النافع في
 * الضجيج. ولا يمكن استنتاج هذا من الوصف وحده استنتاجاً موثوقاً — فيقرّره
 * المالك مرّة، ويتعلّمه النظام قاعدةً تسري على ما يشبهها بعدها.
 */
export const txCategoryEnum = pgEnum("tx_category", [
  "SUPPLIER",   // سداد مورّد
  "SALARY",     // راتب أو أجر
  "RENT",       // إيجار
  "ZAKAT",      // زكاة أو صدقة
  "UTILITY",    // كهرباء · مياه · اتصالات · إنترنت
  "GOVERNMENT", // رسوم حكومية · تأمينات · ضريبة
  "PERSONAL",   // تحويل شخصي للمالك
  "INTERNAL",   // حركة تشغيلية: نقاط بيع · رسوم بنك
  "OTHER",
  "UNKNOWN",
  "POS_SETTLEMENT", "POS_FEE", "POS_VAT", "BANK_FEE",
]);

export const ruleSourceEnum = pgEnum("rule_source", ["MANUAL", "SUGGESTED"]);

/**
 * قاعدة تصنيف تعلّمها النظام من إقرار المالك.
 * النمط يُطابَق بكلماته المميِّزة لا بنصّه كاملاً، لأنّ وصف البنك مقطوع.
 */
export const bankRules = pgTable("bank_rules", {
  id: id(),
  /** النمط كما كتبه المالك */
  pattern: text("pattern").notNull(),
  normalized: text("normalized").notNull(),
  category: txCategoryEnum("category").notNull(),
  /** يُملأ حين يكون التصنيف SUPPLIER */
  supplierId: text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  note: text("note"),
  source: ruleSourceEnum("source").notNull().default("MANUAL"),
  createdById: text("created_by_id").references(() => users.id),
  createdAt: now(),
}, (t) => [
  uniqueIndex("bank_rule_normalized_uniq").on(t.normalized),
  index("bank_rules_category_idx").on(t.category),
]);

export const bankTransactions = pgTable("bank_transactions", {
  id: id(),
  bankImportId: text("bank_import_id").notNull().references(() => bankImports.id, { onDelete: "cascade" }),
  valueDate: timestamp("value_date", { withTimezone: true }).notNull(),
  description: text("description"),
  /**
   * «نوع العملية» في كشف البنك، منفصلاً عن الوصف.
   *
   * كنّا نقرؤه للمطابقة ثمّ نطرحه — و«نقاط بيع» و«رسوم» ترد فيه لا في
   * الوصف، فبقيت مئات الحركات «غير مصنَّفة» لأنّ ما يصنّفها لم يُحفظ.
   * والفراغ فيه يعني «حركة قديمة استُوردت قبل حفظه» لا «بلا نوع».
   */
  transactionType: text("transaction_type"),
  beneficiaryRaw: text("beneficiary_raw"),
  amountMinor: integer("amount_minor").notNull(),
  direction: txDirectionEnum("direction").notNull(),
  ref: text("ref"),
  matchedPaymentId: text("matched_payment_id").references(() => payments.id),
  matchStatus: matchStatusEnum("match_status").notNull().default("UNMATCHED"),
  /** ما هذه الحركة: سداد مورّد أم راتب أم إيجار أم غيره */
  category: txCategoryEnum("category").notNull().default("UNKNOWN"),
  /**
   * هوية الحركة عند البنك: بصمة من الحساب والتاريخ والمبلغ والاتجاه والوصف.
   *
   * بدونها كان استيراد الكشف نفسه مرّتين يضاعف حركاته — ووجدنا في قاعدة
   * أحمد ألفاً وأربعمئة مجموعة مكرّرة فعلاً. وهذه ليست مشكلة عرض بل مشكلة
   * سلامة بيانات مالية: كل تقرير مبنيّ عليها يصير مضاعفاً.
   */
  externalId: text("external_id"),
  /** القاعدة التي صنّفتها، إن وُجدت */
  ruleId: text("rule_id").references(() => bankRules.id, { onDelete: "set null" }),
}, (t) => [
  index("bank_tx_date_idx").on(t.valueDate),
  index("bank_tx_status_idx").on(t.matchStatus),
  index("bank_tx_category_idx").on(t.category),
  index("bank_tx_type_idx").on(t.transactionType),
  uniqueIndex("bank_tx_external_uniq").on(t.externalId),
]);

/* ───────────────────────── التنبيهات ───────────────────────── */

export const issueSeverityEnum = pgEnum("issue_severity", [
  "INFO", "WARN",
  "BLOCKER", // يمنع القيد أو الإدراج في دفعة السداد
]);

export const issueStatusEnum = pgEnum("issue_status", [
  "OPEN", "RESOLVED",
  "WAIVED", // تجاوزه المالك عمداً مع تسجيل السبب
]);

export const issues = pgTable("issues", {
  id: id(),
  code: text("code").notNull(),
  severity: issueSeverityEnum("severity").notNull(),
  status: issueStatusEnum("status").notNull().default("OPEN"),
  /** مرجع متعدد الأنواع — document أو invoice أو payment أو supplier */
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  message: text("message").notNull(),
  resolvedById: text("resolved_by_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  waiverReason: text("waiver_reason"),
  createdAt: now(),
}, (t) => [
  index("issues_status_severity_idx").on(t.status, t.severity),
  index("issues_entity_idx").on(t.entityType, t.entityId),
  index("issues_code_idx").on(t.code),
]);

/* ───────────────────────── إقفال الشهر ───────────────────────── */

export const monthCloseStatusEnum = pgEnum("month_close_status", ["OPEN", "IN_REVIEW", "CLOSED"]);

export const monthCloses = pgTable("month_closes", {
  id: id(),
  month: text("month").notNull().unique(),
  status: monthCloseStatusEnum("status").notNull().default("OPEN"),
  /** حالة كل بند في قائمة التحقق */
  checklist: jsonb("checklist"),
  closedById: text("closed_by_id").references(() => users.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

/* ───────────────────────── حدّ الطلبات ───────────────────────── */

/**
 * عدّاد الطلبات في نافذة ثابتة.
 * في القاعدة لا في ذاكرة العملية: البيئة السحابية تُشغّل نسخاً متعدّدة،
 * فعدّادُ كل نسخة على حدة يجعل الحدّ الفعلي أضعافه.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.key, t.windowStart] }),
  index("rate_limits_window_idx").on(t.windowStart),
]);


/* ───────────────────────── الأصناف المعيارية ───────────────────────── */

/**
 * الصنف المعياري.
 *
 * `normalized_description` ليس مُعرِّف صنف: «حليب كامل الدسم ٢ لتر» عند
 * مورّد و«Full Cream Milk 2L» عند آخر شيء واحد، و«عنب» عند محمصة كيلو بنّ
 * وعند لافا زجاجة كمبوتشا شيئان. فالاسم لا يجمع ولا يفرّق.
 *
 * وهذا الجدول هو ما يجمع، ومنه وحده يمكن لاحقاً: مبيعات ← استهلاك ← تكلفة.
 */
export const productCategoryEnum = pgEnum("product_category", [
  "COFFEE", "DAIRY", "BAKERY", "FOOD", "BEVERAGE",
  "PACKAGING", "CLEANING", "EQUIPMENT", "OTHER",
]);

export const baseUnitEnum = pgEnum("base_unit", ["KG", "G", "L", "ML", "PIECE", "PACK"]);

export const products = pgTable("products", {
  id: id(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en"),
  category: productCategoryEnum("category").notNull().default("OTHER"),
  /** الوحدة التي يُقاس بها الصنف مهما اختلفت عبوات مورّديه */
  baseUnit: baseUnitEnum("base_unit").notNull().default("PIECE"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("products_category_idx").on(t.category)]);

/**
 * صنف المورّد وربطه بالمعياري.
 *
 * الربط **لا يقع تلقائياً على تشابه الاسم** — درس «العنب». يُقترح ويؤكّده
 * إنسان، وما لم يؤكَّد يبقى اقتراحاً لا يُبنى عليه رقم.
 */
export const supplierProducts = pgTable("supplier_products", {
  id: id(),
  supplierId: text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  normalizedDescription: text("normalized_description").notNull(),
  displayName: text("display_name").notNull(),
  productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
  /** حجم العبوة بالوحدة الأساس: كرتون ١٢ × ١ لتر = 12 */
  packSize: numeric("pack_size", { precision: 12, scale: 3 }),
  confirmedById: text("confirmed_by_id").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: now(),
}, (t) => [
  uniqueIndex("supplier_products_uniq").on(t.supplierId, t.normalizedDescription),
  index("supplier_products_product_idx").on(t.productId),
]);

/* ───────────────────────── المصروفات المتكرّرة ───────────────────────── */

/**
 * المصروف الذي يتكرّر بلا فاتورة تصله: الإيجار والرواتب والاشتراكات.
 * تصنيفات كشف البنك تقول «أين ذهب المال»، وهذا يقول «كم يُتوقَّع» —
 * فيُقابَل المتوقَّع بالفعلي.
 */
export const recurringExpenses = pgTable("recurring_expenses", {
  id: id(),
  label: text("label").notNull(),
  category: txCategoryEnum("category").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  /** MONTHLY · QUARTERLY · ANNUAL */
  cadence: text("cadence").notNull().default("MONTHLY"),
  startsOn: text("starts_on"),
  endsOn: text("ends_on"),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: text("created_by_id").references(() => users.id),
  createdAt: now(),
}, (t) => [index("recurring_expenses_active_idx").on(t.isActive)]);

export const expenseSourceEnum = pgEnum("expense_source", ["BANK", "INVOICE", "MANUAL"]);

/**
 * المصروف الفعلي — مقابل `recurring_expenses` الذي يقول المتوقَّع.
 *
 * كان الفعليّ يُشتقّ من كشف البنك عند العرض، وذلك يترك ثلاث فجوات:
 * مصروفٌ دُفع نقداً لا يظهر، ومصروفٌ تصله فاتورة لا يُحسب مصروفاً، ولا
 * يُعرف هل دُفع إيجار هذا الشهر أصلاً.
 *
 * والمبلغ موجب دائماً: كونه مصروفاً يحمل اتجاهه.
 */
export const expenses = pgTable("expenses", {
  id: id(),
  periodMonth: text("period_month").notNull(),
  occurredOn: text("occurred_on").notNull(),
  category: txCategoryEnum("category").notNull(),
  label: text("label").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  source: expenseSourceEnum("source").notNull(),
  bankTransactionId: text("bank_transaction_id").references(() => bankTransactions.id, { onDelete: "set null" }),
  invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  recurringExpenseId: text("recurring_expense_id").references(() => recurringExpenses.id, { onDelete: "set null" }),
  note: text("note"),
  createdById: text("created_by_id").references(() => users.id),
  createdAt: now(),
}, (t) => [
  index("expenses_period_idx").on(t.periodMonth),
  index("expenses_category_idx").on(t.category),
  index("expenses_recurring_idx").on(t.recurringExpenseId),
]);

/* ───────────────────────── مجال المبيعات ───────────────────────── */

/**
 * جداول محايدة عن أي مزوّد، تُنشأ فارغةً وتنتظر موصلاً.
 *
 * وجودها الآن يمنع أن تُبنى التقارير فوق نموذج فواتير ثمّ تُعاد كتابتها.
 * ولا واجهة برمجية لأي مزوّد في هذا المستودع — الموصل يُكتب لاحقاً.
 */
export const salesSources = pgTable("sales_sources", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("POS"),
  isConnected: boolean("is_connected").notNull().default(false),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: now(),
});

export const posProducts = pgTable("pos_products", {
  id: id(),
  sourceId: text("source_id").notNull().references(() => salesSources.id, { onDelete: "cascade" }),
  /** معرّف الصنف عند المزوّد */
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  category: text("category"),
  priceMinor: integer("price_minor"),
  productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
  createdAt: now(),
}, (t) => [uniqueIndex("pos_products_uniq").on(t.sourceId, t.externalId)]);

export const sales = pgTable("sales", {
  id: id(),
  sourceId: text("source_id").notNull().references(() => salesSources.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
  businessDate: text("business_date").notNull(),
  grossMinor: integer("gross_minor").notNull(),
  discountMinor: integer("discount_minor").notNull().default(0),
  refundMinor: integer("refund_minor").notNull().default(0),
  vatMinor: integer("vat_minor").notNull().default(0),
  netMinor: integer("net_minor").notNull(),
  orderCount: integer("order_count").notNull().default(1),
  createdAt: now(),
}, (t) => [
  uniqueIndex("sales_uniq").on(t.sourceId, t.externalId),
  index("sales_date_idx").on(t.businessDate),
]);

export const saleLines = pgTable("sale_lines", {
  id: id(),
  saleId: text("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
  posProductId: text("pos_product_id").references(() => posProducts.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  lineTotalMinor: integer("line_total_minor").notNull(),
}, (t) => [index("sale_lines_sale_idx").on(t.saleId)]);

/* ───────────────────────── سجل التدقيق ───────────────────────── */

/**
 * سجل غير قابل للتعديل ولا الحذف.
 * تُسحب صلاحيات UPDATE و DELETE من دور التطبيق في هجرة مستقلة،
 * فلا يكفي الاتفاق البرمجي وحده — القاعدة نفسها تمنعه.
 */
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorId: text("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_entity_idx").on(t.entityType, t.entityId),
  index("audit_at_idx").on(t.at),
]);

/* ───────────────────────── العلاقات ───────────────────────── */

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  aliases: many(supplierAliases),
  documents: many(documents),
  invoices: many(invoices),
  statements: many(statements),
  payments: many(payments),
}));

export const supplierAliasesRelations = relations(supplierAliases, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierAliases.supplierId], references: [suppliers.id] }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  supplier: one(suppliers, { fields: [documents.supplierId], references: [suppliers.id] }),
  uploadedBy: one(users, { fields: [documents.uploadedById], references: [users.id] }),
  invoice: one(invoices),
  statement: one(statements),
  payment: one(payments),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  document: one(documents, { fields: [invoices.documentId], references: [documents.id] }),
  supplier: one(suppliers, { fields: [invoices.supplierId], references: [suppliers.id] }),
  lines: many(invoiceLines),
  allocations: many(paymentAllocations),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
}));

export const statementsRelations = relations(statements, ({ one, many }) => ({
  document: one(documents, { fields: [statements.documentId], references: [documents.id] }),
  supplier: one(suppliers, { fields: [statements.supplierId], references: [suppliers.id] }),
  lines: many(statementLines),
}));

export const statementLinesRelations = relations(statementLines, ({ one }) => ({
  statement: one(statements, { fields: [statementLines.statementId], references: [statements.id] }),
  matchedInvoice: one(invoices, { fields: [statementLines.matchedInvoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  document: one(documents, { fields: [payments.documentId], references: [documents.id] }),
  supplier: one(suppliers, { fields: [payments.supplierId], references: [suppliers.id] }),
  allocations: many(paymentAllocations),
  bankTransactions: many(bankTransactions),
}));

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  payment: one(payments, { fields: [paymentAllocations.paymentId], references: [payments.id] }),
  invoice: one(invoices, { fields: [paymentAllocations.invoiceId], references: [invoices.id] }),
}));

export const bankImportsRelations = relations(bankImports, ({ one, many }) => ({
  importedBy: one(users, { fields: [bankImports.importedById], references: [users.id] }),
  transactions: many(bankTransactions),
}));

export const bankTransactionsRelations = relations(bankTransactions, ({ one }) => ({
  bankImport: one(bankImports, { fields: [bankTransactions.bankImportId], references: [bankImports.id] }),
  matchedPayment: one(payments, { fields: [bankTransactions.matchedPaymentId], references: [payments.id] }),
  rule: one(bankRules, { fields: [bankTransactions.ruleId], references: [bankRules.id] }),
}));

export const bankRulesRelations = relations(bankRules, ({ one }) => ({
  supplier: one(suppliers, { fields: [bankRules.supplierId], references: [suppliers.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  uploadedDocuments: many(documents),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
