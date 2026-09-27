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
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankHeldRows, bankTransactions } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { toCanonical } from "@/lib/bank/canonical";
import { factKey, identityKeyOf } from "@/lib/bank/sync";
import type { Conn, Tx } from "./types";

export interface HeldRowInput {
  kind: "AMBIGUOUS" | "CONFLICT";
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
  kind: "AMBIGUOUS" | "CONFLICT";
  reason: string;
  day: string;
  description: string | null;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  against: { id: string; day: string; amountMinor: number; description: string | null; operationRef: string | null } | null;
}

export async function loadOpenHeldRows(conn: Conn = db): Promise<HeldRowView[]> {
  const rows = await conn.execute<{
    id: string; kind: "AMBIGUOUS" | "CONFLICT"; reason: string; day: string; description: string | null;
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

/** «هي نفسها» · «حركةٌ أخرى» · «تحقّقتُ» — بقفلٍ، ومرّةً واحدة. */
export async function resolveHeldRow(
  tx: Tx,
  id: string,
  decision: "SAME" | "ADDED" | "CHECKED",
  actorId: string,
): Promise<{ transactionId: string | null }> {
  const [row] = await tx.select().from(bankHeldRows).where(eq(bankHeldRows.id, id)).for("update");
  if (!row) throw new HeldRowRefused("لم يُوجد الصفّ — حدّث الصفحة");
  if (row.resolvedAt) throw new HeldRowRefused("حُسم هذا الصفّ من قبل — حدّث الصفحة");
  if (decision === "ADDED" && row.kind === "CONFLICT") {
    throw new HeldRowRefused("المتضاربُ لا يُضاف: مرجعُه لحركةٍ مقيَّدة بمبلغٍ آخر — انظر الملفّ ثمّ «تحقّقتُ»");
  }
  if (decision === "SAME" && row.kind === "CONFLICT") decision = "CHECKED";

  let transactionId: string | null = null;
  if (decision === "ADDED") {
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
      bankImportId: row.bankImportId!,
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
