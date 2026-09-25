/**
 * أبوابُ سجلّ التدقيق — كي يُقرأ «ما الذي تغيّر» بأبوابه لا سطراً سطراً.
 *
 * الفعلُ يُنسب إلى بابه بنمطٍ من اسمه، والنمطُ نفسُه يُرشِّح في القاعدة
 * (`action ~ pattern`) ويُرسم في الشاشة — مصدرٌ واحد. والتعلّمُ الآليّ
 * (أسماءٌ بديلة وقواعد يكتبها النظام بالمئات) بابٌ وحده يُخفى افتراضاً،
 * وإلّا غرق فعلُ الإنسان في سطوره.
 */

export type AuditKind = "money" | "documents" | "bank" | "suppliers" | "inventory" | "learned" | "other";

export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  money: "المال والسداد",
  documents: "المستندات",
  bank: "البنك",
  suppliers: "المورّدون",
  inventory: "الجرد",
  learned: "ما تعلّمه النظام",
  other: "أخرى",
};

/** ما يكتبه النظام وحده بالمئات — يُخفى إلّا إذا طُلب. */
export const LEARNED_ACTIONS: readonly string[] = ["SUPPLIER_ALIAS_LEARNED", "BANK_RULE_LEARNED"];

/** أنماطٌ يقرؤها JavaScript وPostgres معاً (POSIX). والترتيبُ مهمّ: الأوّلُ يغلب. */
export const KIND_PATTERN: readonly (readonly [Exclude<AuditKind, "learned" | "other">, string])[] = [
  ["money", "^(PAYMENT_|INVOICES_MARKED_PAID|INVOICE_PAID_BY_OWNER|MATCH_|SUPPLIER_CREDIT|MONTH_|RECONCILIATION_|EXPENSE|ALERT_RESOLVED|ACCOUNTANT_PACK|ISSUE_WAIVED)"],
  ["documents", "^(DOCUMENT_|FIELD_CORRECTED|INVOICE_FIELDS_CORRECTED|DRIVE_)"],
  ["bank", "^(BANK_|COUNTERPARTY_|STATEMENT_|DELETE_DUPLICATE_TRANSACTION)"],
  ["suppliers", "^(SUPPLIER_|AI_|PRODUCT_)"],
  ["inventory", "^(SALES_|CATALOG_|POS_|RECIPE_|STOCK_|INVENTORY_|WASTE_)"],
];

export function auditKind(action: string): AuditKind {
  if (LEARNED_ACTIONS.includes(action)) return "learned";
  for (const [kind, pattern] of KIND_PATTERN) if (new RegExp(pattern).test(action)) return kind;
  return "other";
}

export function isAuditKind(v: string | undefined): v is AuditKind {
  /* `in` يقبل «__proto__» من العنوان — والخاصّيّةُ الذاتيّة وحدها باب */
  return v !== undefined && Object.hasOwn(AUDIT_KIND_LABEL, v);
}
