/**
 * سجل التدقيق.
 *
 * الجدول نفسه يرفض التعديل والحذف والإفراغ عبر مشغّلات في قاعدة البيانات،
 * فما يُكتب هنا يبقى. لا تكتب في السجل أسراراً — يُكتب ما فُعل لا بماذا.
 */
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

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
  | "STATEMENT_RECONCILED";

export async function recordAudit(entry: {
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: (entry.before ?? null) as never,
    after: (entry.after ?? null) as never,
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
