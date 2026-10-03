/**
 * صفوفُ الكشف الملتبسة والمتضاربة — تُحفظ حتّى يقرّر إنسان (051).
 *
 * المزامنةُ لا تحسم ما لا دليلَ عليه: صفٌّ بلا مرجعٍ يشبه حركةً لها مرجع
 * («أهي هي أم ثانية؟»)، أو المرجعُ نفسُه بمبلغٍ آخر («المصدر يكذّب نفسه»). وكانا
 * يُعدّان في نتيجة الاستيراد ثمّ يختفيان — فحوالةٌ ثانيةٌ حقيقيّة تضيع، ويظهر
 * فرقٌ في معادلة البنك لا يُعرف مصدره.
 *
 * والقرار: «هي نفسها» يُغلقه ويُذكَر (إعادةُ الاستيراد لا تعيده)؛ «حركةٌ أخرى»
 * تُضيفه حركةً بهويّتها من الخوارزميّة الواحدة (`identityKeyOf`) فيدخل الطابور؛
 * والمتضاربُ «تحقّقتُ» بعد النظر في الملفّ — لا يُضاف: مرجعُه لحركةٍ أخرى.
 *
 * والثالث عكسُهما (058): حركةٌ **عندنا** وليست في كشفٍ يغطّي يومها — «احذفها»
 * تحذفها ومصروفَها (ما لم تُطابَق بدفعة، وشهرُها مفتوح)، أو «أبقِها».
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankHeldRows, bankTransactions, expenses } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { toCanonical } from "@/lib/bank/canonical";
import { factKey, identityKeyOf } from "@/lib/bank/sync";
import { assertMonthsOpen } from "./month-guard";
import type { Conn, Tx } from "./types";

export type HeldKind = "AMBIGUOUS" | "CONFLICT" | "MISSING_FROM_FILE";
export type HeldDecision = "SAME" | "ADDED" | "CHECKED" | "REMOVED";

export interface HeldRowInput {
  kind: HeldKind;
  bankImportId: string | null;
  bankAccountId: string | null;
  againstTransactionId: string;
  reason: string;
  valueDate: Date;
  description: string | null;
  beneficiaryRaw: string | null;
  transactionType: string | null;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  operationRef: string | null;
}

/** يُحفظ ما التبس — وما حُفظ من قبل (أو حُسم) لا يُكرَّر. */
export async function holdRows(rows: readonly HeldRowInput[], conn: Conn = db): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await conn.insert(bankHeldRows).values(rows.map((r) => ({
    ...r,
    factKey: factKey(toCanonical({
      valueDate: r.valueDate, description: r.description, beneficiaryRaw: r.beneficiaryRaw,
      transactionType: r.transactionType, amountMinor: r.amountMinor, direction: r.direction,
    })),
  }))).onConflictDoNothing().returning({ id: bankHeldRows.id });
  return inserted.length;
}

export interface HeldRowView {
  id: string;
  kind: HeldKind;
  reason: string;
  day: string;
  description: string | null;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  against: { id: string; day: string; amountMinor: number; description: string | null; operationRef: string | null } | null;
}

export async function loadOpenHeldRows(conn: Conn = db): Promise<HeldRowView[]> {
  const rows = await conn.execute<{
    id: string; kind: HeldKind; reason: string; day: string; description: string | null;
    amount_minor: number; direction: "DEBIT" | "CREDIT";
    against_id: string | null; against_day: string | null; against_amount: number | null;
    against_description: string | null; against_ref: string | null;
  }>(sql`
    select h.id, h.kind, h.reason, to_char(h.value_date, 'YYYY-MM-DD') as day, h.description,
           h.amount_minor, h.direction::text as direction,
           t.id as against_id, to_char(t.value_date, 'YYYY-MM-DD') as against_day, t.amount_minor as against_amount,
           t.description as against_description, t.operation_ref as against_ref
      from bank_held_rows h
      left join bank_transactions t on t.id = h.against_transaction_id
     where h.resolved_at is null
     order by h.value_date desc
     limit 200
  `);
  return rows.rows.map((r) => ({
    id: r.id, kind: r.kind, reason: r.reason, day: r.day, description: r.description,
    amountMinor: Number(r.amount_minor), direction: r.direction,
    against: r.against_id
      ? { id: r.against_id, day: r.against_day ?? "", amountMinor: Number(r.against_amount), description: r.against_description, operationRef: r.against_ref }
      : null,
  }));
}

export class HeldRowRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeldRowRefused";
  }
}

/** «هي نفسها» · «حركةٌ أخرى» · «تحقّقتُ» · «احذفها» — بقفلٍ، ومرّةً واحدة. */
export async function resolveHeldRow(
  tx: Tx,
  id: string,
  decision: HeldDecision,
  actorId: string,
): Promise<{ transactionId: string | null; removed?: boolean }> {
  const [row] = await tx.select().from(bankHeldRows).where(eq(bankHeldRows.id, id)).for("update");
  if (!row) throw new HeldRowRefused("لم يُوجد الصفّ — حدّث الصفحة");
  if (row.resolvedAt) throw new HeldRowRefused("حُسم هذا الصفّ من قبل — حدّث الصفحة");
  if (row.kind === "MISSING_FROM_FILE") return resolveMissing(tx, row, decision, actorId);
  if (decision === "REMOVED") throw new HeldRowRefused("الحذفُ لحركةٍ عندنا ليست في الكشف — وهذا صفٌّ من الكشف");
  if (decision === "ADDED" && row.kind === "CONFLICT") {
    throw new HeldRowRefused("المتضاربُ لا يُضاف: مرجعُه لحركةٍ مقيَّدة بمبلغٍ آخر — انظر الملفّ ثمّ «تحقّقتُ»");
  }
  if (decision === "SAME" && row.kind === "CONFLICT") decision = "CHECKED";

  let transactionId: string | null = null;
  if (decision === "ADDED" && !row.bankImportId) {
    throw new HeldRowRefused("حُذف الاستيرادُ الذي جاء منه هذا الصفّ — استورد الكشفَ ثانيةً فيعود إن كان حركةً أخرى");
  }
  if (decision === "ADDED" && row.bankImportId) {
    /*
      الهويّةُ بالخوارزميّة الواحدة: الوقائعُ وترتيبُها بين ما يحمل الوقائعَ
      نفسها في الحساب — كما تحسبها المزامنة لو جاءت الحركةُ جديدة.
    */
    const sameDay = await tx.select({
      valueDate: bankTransactions.valueDate, description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw, transactionType: bankTransactions.transactionType,
      amountMinor: bankTransactions.amountMinor, direction: bankTransactions.direction,
    }).from(bankTransactions).where(and(
      eq(bankTransactions.amountMinor, row.amountMinor),
      eq(bankTransactions.direction, row.direction),
      sql`to_char(${bankTransactions.valueDate}, 'YYYY-MM-DD') = to_char(${row.valueDate}::timestamptz, 'YYYY-MM-DD')`,
      row.bankAccountId
        ? sql`(${bankTransactions.bankAccountId} = ${row.bankAccountId} or ${bankTransactions.bankAccountId} is null)`
        : undefined,
    ));
    let occurrence = sameDay.filter((t) => factKey(toCanonical({ ...t, direction: t.direction })) === row.factKey).length;
    let identityKey = identityKeyOf(row.bankAccountId, null, row.factKey, occurrence);
    /* فجوةٌ في الترتيب (حركةٌ حُذفت) لا تُسقط الإضافة — يُؤخذ أوّلُ ترتيبٍ خالٍ */
    for (let i = 0; i < 20; i++) {
      const [taken] = await tx.select({ id: bankTransactions.id }).from(bankTransactions)
        .where(eq(bankTransactions.identityKey, identityKey)).limit(1);
      if (!taken) break;
      occurrence++;
      identityKey = identityKeyOf(row.bankAccountId, null, row.factKey, occurrence);
    }
    const [created] = await tx.insert(bankTransactions).values({
      bankImportId: row.bankImportId,
      bankAccountId: row.bankAccountId,
      externalId: identityKey,
      identityKey,
      occurrence,
      valueDate: row.valueDate,
      description: row.description,
      transactionType: row.transactionType,
      beneficiaryRaw: row.beneficiaryRaw,
      amountMinor: row.amountMinor,
      direction: row.direction,
      category: "UNKNOWN",
      matchStatus: "UNMATCHED",
    }).returning({ id: bankTransactions.id });
    transactionId = created.id;
  }

  await tx.update(bankHeldRows).set({
    resolution: decision, resolvedTransactionId: transactionId, resolvedById: actorId, resolvedAt: new Date(),
  }).where(and(eq(bankHeldRows.id, id), isNull(bankHeldRows.resolvedAt)));

  await recordAudit({
    actorId,
    action: "BANK_HELD_ROW_RESOLVED",
    entityType: "bank_held_row",
    entityId: id,
    before: { النوع: row.kind, السبب: row.reason, تشبه: row.againstTransactionId },
    after: {
      القرار: decision === "ADDED" ? "حركةٌ أخرى — أُضيفت" : decision === "SAME" ? "هي نفسها" : "تحقّقتُ",
      الحركة: transactionId,
    },
  }, tx);
  return { transactionId };
}


/**
 * حركةٌ عندنا ليست في الكشف الذي يغطّي يومها: «احذفها» أو «أبقِها».
 *
 * الحذفُ يقع على ما لا أثرَ له إلّا نفسه ومصروفه المشتقّ منه: المطابَقةُ بدفعةٍ
 * تُفكّ أوّلاً (سدادٌ قائم على حركةٍ لم تقع خطأٌ آخر يُنظر فيه)، والشهرُ المقفل
 * لا يُكتب فيه. والوقائعُ كاملةً في السجلّ — الحذفُ لا يمحو أثره.
 */
async function resolveMissing(
  tx: Tx,
  row: typeof bankHeldRows.$inferSelect,
  decision: HeldDecision,
  actorId: string,
): Promise<{ transactionId: string | null; removed: boolean }> {
  if (decision !== "REMOVED" && decision !== "CHECKED") {
    throw new HeldRowRefused("هذه حركةٌ عندنا ليست في الكشف — «احذفها» أو «أبقِها»");
  }
  let removed = false;
  let facts: Record<string, unknown> = {};
  if (decision === "REMOVED" && row.againstTransactionId) {
    const [t] = await tx.select().from(bankTransactions)
      .where(eq(bankTransactions.id, row.againstTransactionId)).for("update");
    if (t) {
      if (t.matchedPaymentId || t.matchStatus === "MATCHED") {
        throw new HeldRowRefused("الحركةُ مطابَقةٌ بدفعة — فكّ المطابقة من صفحتها أوّلاً، ثمّ احذفها");
      }
      const linked = await tx.select({ id: expenses.id, month: expenses.periodMonth, amountMinor: expenses.amountMinor, label: expenses.label })
        .from(expenses).where(eq(expenses.bankTransactionId, t.id));
      await assertMonthsOpen(tx, [t.valueDate.toISOString().slice(0, 7), ...linked.map((e) => e.month)]);
      if (linked.length > 0) await tx.delete(expenses).where(inArray(expenses.id, linked.map((e) => e.id)));
      await tx.delete(bankTransactions).where(eq(bankTransactions.id, t.id));
      removed = true;
      facts = {
        الحركة: t.id, اليوم: t.valueDate.toISOString().slice(0, 10), المبلغ: t.amountMinor, الاتجاه: t.direction,
        الوصف: t.description, الهويّة: t.identityKey, الاستيراد: t.bankImportId,
        مصروفاتٌ_حُذفت: linked.map((e) => `${e.label} · ${e.amountMinor}`),
      };
    }
  }

  await tx.update(bankHeldRows).set({
    resolution: decision, resolvedById: actorId, resolvedAt: new Date(),
  }).where(and(eq(bankHeldRows.id, row.id), isNull(bankHeldRows.resolvedAt)));

  await recordAudit({
    actorId,
    action: "BANK_HELD_ROW_RESOLVED",
    entityType: "bank_held_row",
    entityId: row.id,
    before: { النوع: row.kind, السبب: row.reason, الحركة: row.againstTransactionId },
    after: { القرار: removed ? "ليست في الكشف — حُذفت" : "أُبقيت", ...facts },
  }, tx);
  return { transactionId: null, removed };
}
