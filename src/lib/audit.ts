/**
 * سجل التدقيق.
 *
 * الجدول نفسه يرفض التعديل والحذف والإفراغ عبر مشغّلات في قاعدة البيانات،
 * فما يُكتب هنا يبقى. لا تكتب في السجل أسراراً — يُكتب ما فُعل لا بماذا.
 */
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { previewAllowed } from "./preview-mode";

/**
 * مقبض الكتابة: القاعدة أو معاملةٌ جارية.
 *
 * القيد يُكتب **داخل** المعاملة التي كتبت المال حين تُمرَّر، فإن أُلغيت
 * أُلغي معها. وكان يُكتب بـ`db` دائماً، فبقي في السجلّ ١٤ «تعلّماً»
 * لجهاتٍ أُلغي إنشاؤها — سجلٌّ لا يُحذف منه شيء يشهد بما لم يقع.
 */
type AuditWriter = Pick<typeof db, "insert">;

export type AuditAction =
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_ARCHIVED"
  | "DOCUMENT_REJECTED"
  | "FIELD_CORRECTED"
  | "SUPPLIER_CREATED"
  | "SUPPLIER_UPDATED"
  | "ISSUE_WAIVED"
  | "MONTH_CLOSED"
  | "USER_ROLE_CHANGED"
  | "DRIVE_SYNCED"
  | "BANK_IMPORTED"
  | "INVOICES_MARKED_PAID"
  | "SUPPLIER_ALIAS_LEARNED"
  | "STATEMENT_RECONCILED"
  | "PRODUCT_LINKED"
  | "PRODUCT_UNLINKED"
  | "EXPENSE_ADDED"
  | "EXPENSE_REMOVED"
  | "EXPENSE_REACTIVATED"
  | "INVOICE_PAID_BY_OWNER"
  | "SUPPLIER_CREDIT_APPLIED"
  | "AI_ANALYSIS_RUN"
  | "AI_FINDING_DECIDED"
  | "COUNTERPARTY_CONFIRMED"
  | "BANK_RULE_LEARNED"
  | "MONTH_REOPENED"
  | "MATCH_CONFIRMED"
  | "MATCH_UNDONE"
  | "MATCH_REJECTED"
  | "PAYMENT_RECORDED"
  | "DRIVE_FILE_RENAMED"
  | "PAYMENT_RUN_EXPORTED"
  | "EXPENSES_DERIVED"
  | "EXPENSE_RECLASSIFIED"
  | "RECONCILIATION_BALANCES_SET"
  | "DOCUMENT_STATUS_CHANGED";

export async function recordAudit(entry: {
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}, writer: AuditWriter = db): Promise<void> {
  await writer.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: (entry.before ?? null) as never,
    /*
      وضعُ التجربة يستعير معرّف المالك لأنّ القيود مقيَّدةٌ بمفتاحٍ أجنبيّ —
      فيُوسَم القيد كي لا يُقرأ فعلاً وقع من المالك نفسه.
    */
    after: (previewAllowed(process.env)
      ? {
          ...(entry.after && typeof entry.after === "object" && !Array.isArray(entry.after)
            ? entry.after as Record<string, unknown>
            : { القيمة: entry.after ?? null }),
          "وضع التجربة": true,
        }
      : entry.after ?? null) as never,
  });
}

/**
 * يقارن ما استُخرج آلياً بما اعتمده الإنسان، ويرجع الحقول المعدَّلة فقط.
 * هذا هو ما يجيب سؤال «أي حقل عُدّل يدوياً ومن عدّله».
 */
export function diffCorrections(
  extracted: Record<string, unknown>,
  confirmed: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(confirmed)) {
    const before = extracted[key];
    const after = confirmed[key];
    const normalize = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
    if (normalize(before) !== normalize(after)) changes[key] = { from: before ?? null, to: after };
  }
  return changes;
}
