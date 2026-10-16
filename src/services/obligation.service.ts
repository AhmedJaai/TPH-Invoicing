/**
 * الوثائقُ ذاتُ تاريخ الانتهاء — قراءتُها وكتابتُها. والحكمُ («حان تذكيرُها؟») في
 * `lib/obligations.ts` الخالصة.
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { obligations } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  OBLIGATION_KIND_LABEL, dueObligations, isObligationKind, type DueObligation, type Obligation, type ObligationKind,
} from "@/lib/obligations";
import { silencedKeys } from "@/lib/signal-decisions";
import { todayInRiyadh, isoDay } from "@/lib/riyadh-time";
import { pgErrorCode } from "./guard";

type Row = typeof obligations.$inferSelect;

function toObligation(r: Row): Obligation {
  return {
    id: r.id,
    kind: isObligationKind(r.kind) ? r.kind : "OTHER",
    title: r.title,
    issuer: r.issuer,
    reference: r.reference,
    holder: r.holder,
    expiresOn: r.expiresOn,
    remindDays: r.remindDays,
    note: r.note,
  };
}

export interface ObligationsView {
  open: Obligation[];
  archived: (Obligation & { closedOn: string | null })[];
  /** ما أجّل صاحبُه تذكيرَه — بمفاتيحه. */
  silenced: Set<string>;
}

export async function loadObligations(): Promise<ObligationsView> {
  const [open, archived, decisions] = await Promise.all([
    db.select().from(obligations).where(isNull(obligations.closedAt)).orderBy(asc(obligations.expiresOn)),
    db.select().from(obligations).where(isNotNull(obligations.closedAt)).orderBy(asc(obligations.expiresOn)),
    db.execute<{ key: string; decision: string }>(sql`select key, decision from alert_resolutions where key like 'obligation:%'`),
  ]);
  return {
    open: open.map(toObligation),
    archived: archived.map((r) => ({ ...toObligation(r), closedOn: r.closedAt ? isoDay(r.closedAt) : null })),
    silenced: silencedKeys(decisions.rows, todayInRiyadh()),
  };
}

/**
 * ما حان تذكيرُه — لـ«يحتاج قرارك»، ويُحسب مع كلّ صفحة.
 *
 * وجدولٌ لم تُطبَّق هجرتُه بعد (`42P01`) يُقرأ «لا وثائق» لا عطباً: هذه الواقعةُ
 * تدخل عدّادَ القشرة، وعطبُها يُسقط كلَّ صفحةٍ في التطبيق لأجل ميزةٍ جانبيّة.
 */
export async function loadDueObligations(): Promise<DueObligation[]> {
  try {
    const view = await loadObligations();
    return dueObligations(view.open, todayInRiyadh(), view.silenced);
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return [];
    throw e;
  }
}

export interface ObligationInput {
  kind: ObligationKind;
  title: string;
  issuer: string | null;
  reference: string | null;
  holder: string | null;
  expiresOn: string;
  remindDays: number;
  note: string | null;
}

function auditShape(o: ObligationInput) {
  return {
    النوع: OBLIGATION_KIND_LABEL[o.kind], العنوان: o.title, الجهة: o.issuer, الرقم: o.reference, لمن: o.holder,
    تنتهي: o.expiresOn, مهلة_التذكير_بالأيّام: o.remindDays, ملاحظة: o.note,
  };
}

export async function createObligation(input: ObligationInput, actorId: string): Promise<string> {
  return db.transaction(async (t) => {
    const [row] = await t.insert(obligations).values({ ...input, createdById: actorId }).returning({ id: obligations.id });
    await recordAudit({ actorId, action: "DOCUMENT_EXPIRY_SAVED", entityType: "obligation", entityId: row.id, after: auditShape(input) }, t);
    return row.id;
  });
}

/** يُرجع `false` إن لم توجد. والتجديدُ تعديلُ تاريخ الانتهاء — وقديمُه في السجلّ. */
export async function updateObligation(id: string, input: ObligationInput, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const [before] = await t.select().from(obligations).where(eq(obligations.id, id)).for("update");
    if (!before) return false;
    await t.update(obligations).set({ ...input, updatedAt: new Date() }).where(eq(obligations.id, id));
    const was = toObligation(before);
    await recordAudit({
      actorId, action: "DOCUMENT_EXPIRY_SAVED", entityType: "obligation", entityId: id,
      before: auditShape({ ...was }), after: auditShape(input),
    }, t);
    return true;
  });
}

/** أرشفةٌ لا حذف — و`closed: false` يعيدها. */
export async function setObligationClosed(id: string, closed: boolean, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const [before] = await t.select().from(obligations).where(eq(obligations.id, id)).for("update");
    if (!before) return false;
    await t.update(obligations)
      .set({ closedAt: closed ? new Date() : null, closedById: closed ? actorId : null, updatedAt: new Date() })
      .where(and(eq(obligations.id, id)));
    await recordAudit({
      actorId, action: "DOCUMENT_EXPIRY_CLOSED", entityType: "obligation", entityId: id,
      after: { العنوان: before.title, الحال: closed ? "أرشفت" : "أعيدت" },
    }, t);
    return true;
  });
}
