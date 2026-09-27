/**
 * حوالةٌ لمورّدٍ خرجت ثمّ عادت — «ارتدّت» أو «ليست ردّاً».
 *
 * كان الكشفُ (`findReversals`) يقول «المبلغ نفسه رجع بعد أيّام — فالفاتورة تبدو
 * مسدَّدةً ولم تُسدَّد»، ويدلّ على التراجع عن المطابقة. لكنّ التراجع عن ربط سدادٍ
 * قُيِّد بيدٍ يُبقي الدفعة (وهو صحيحٌ لِما صُمّم له: «ليست هي»)، فتبقى الفاتورةُ
 * مسدَّدةً والمالُ عاد. ولا قرارَ يُغلق البند: يبقى في «يحتاج قرارك» ولو حُسم.
 *
 * «ارتدّت»: تُردّ الدفعة (`REVERSED` بسببها) فتعود فواتيرُها مستحقّة، وتُعرَّف حركةُ
 * العودة مالاً رجع من المورّد فلا تبقى في الطابور. «ليست ردّاً»: يُذكَر ولا يُمسّ
 * شيء. وكلاهما في `alert_resolutions` كقرار الازدواج.
 */
import { and, eq, sql } from "drizzle-orm";
import { alertResolutions, bankTransactions, decisionHistory, payments } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { REVERSAL_WINDOW_DAYS, reversalKey } from "@/lib/bank/reversal";
import { reversePayment } from "./payment.service";
import type { Conn, Tx } from "./types";

export class BounceRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BounceRefused";
  }
}

export async function resolveBounce(
  tx: Tx,
  input: { outgoingId: string; incomingId: string; decision: "BOUNCED" | "NOT_BOUNCE" },
  actorId: string,
): Promise<{ freedInvoices: number }> {
  const [out] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, input.outgoingId)).for("update");
  const [back] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, input.incomingId)).for("update");
  if (!out || !back) throw new BounceRefused("لم تُوجد الحركتان — حدّث الصفحة");
  const gapDays = (back.valueDate.getTime() - out.valueDate.getTime()) / 86_400_000;
  if (out.direction !== "DEBIT" || back.direction !== "CREDIT" || out.amountMinor !== back.amountMinor
    || gapDays <= 0 || gapDays > REVERSAL_WINDOW_DAYS + 1) {
    throw new BounceRefused("الحركتان ليستا خروجاً وعودةً بالمبلغ نفسه في نافذة الأيّام");
  }
  const key = reversalKey(out.id, back.id);
  const [already] = await tx.select({ key: alertResolutions.key }).from(alertResolutions).where(eq(alertResolutions.key, key));
  if (already) throw new BounceRefused("حُسم هذا من قبل — حدّث الصفحة");

  let freedInvoices = 0;
  if (input.decision === "BOUNCED") {
    const [p] = out.matchedPaymentId
      ? await tx.select({ id: payments.id, status: payments.status, supplierId: payments.supplierId })
        .from(payments).where(eq(payments.id, out.matchedPaymentId))
      : [];
    if (p && p.status !== "REVERSED" && p.status !== "VOID") {
      const r = await reversePayment(tx, {
        paymentId: p.id,
        kind: "REVERSED",
        reason: `ارتدّت الحوالة: عاد المبلغ نفسه في ${back.valueDate.toISOString().slice(0, 10)}`,
        userId: actorId,
      });
      freedInvoices = r.freedInvoiceIds.length;
    }
    /* العودةُ مالٌ رجع من المورّد — تُعرَّف فلا تبقى في الطابور تسأل «ما بابُها؟» */
    await tx.update(bankTransactions).set({
      category: "SUPPLIER",
      supplierId: p?.supplierId ?? out.supplierId,
      matchStatus: "IGNORED",
      matchOutcome: "NOT_A_PAYMENT",
      lifecycle: "CONFIRMED",
    }).where(and(eq(bankTransactions.id, back.id)));
    await tx.insert(decisionHistory).values([
      { bankTransactionId: out.id, event: "MATCH_REVERSED", actor: "HUMAN", actorId, detail: "ارتدّت — عاد المبلغ", payload: { العودة: back.id, الدفعة: p?.id ?? null } },
      { bankTransactionId: back.id, event: "CLASSIFIED", actor: "HUMAN", actorId, detail: "عودةُ حوالةٍ ارتدّت", payload: { الخروج: out.id } },
    ]);
  }

  await tx.insert(alertResolutions).values({ key, decision: input.decision, userId: actorId });
  await recordAudit({
    actorId,
    action: "ALERT_RESOLVED",
    entityType: "alert",
    entityId: key,
    after: {
      القرار: input.decision === "BOUNCED" ? "ارتدّت — رُدّت الدفعة وعادت فواتيرها مستحقّة" : "ليست ردّاً",
      الخروج: out.id, العودة: back.id, المبلغ: out.amountMinor, "فواتير عادت مستحقّة": freedInvoices,
    },
  }, tx);
  return { freedInvoices };
}

/** للحركة المفتوحة: أهي طرفٌ في خروجٍ وعودةٍ لم يُحسما؟ — بالشرط نفسه في «يحتاج قرارك». */
export async function findBouncePartner(conn: Conn, id: string): Promise<{
  outgoingId: string; incomingId: string; outDay: string; backDay: string; amountMinor: number;
} | null> {
  const [r] = (await conn.execute<{ out_id: string; back_id: string; out_day: string; back_day: string; amount: number }>(sql`
    select o.id as out_id, b.id as back_id, to_char(o.value_date, 'YYYY-MM-DD') as out_day,
           to_char(b.value_date, 'YYYY-MM-DD') as back_day, o.amount_minor as amount
      from bank_transactions o
      join bank_transactions b
        on b.direction = 'CREDIT' and b.amount_minor = o.amount_minor
       and b.value_date > o.value_date and b.value_date <= o.value_date + make_interval(days => ${REVERSAL_WINDOW_DAYS})
       and b.category <> 'INTERNAL'
     where o.direction = 'DEBIT' and o.amount_minor > 100
       and (o.matched_payment_id is not null or o.category = 'SUPPLIER')
       and (o.id = ${id} or b.id = ${id})
       and not exists (select 1 from alert_resolutions a where a.key = 'bounce:' || o.id || ':' || b.id)
     order by b.value_date
     limit 1
  `)).rows;
  return r ? { outgoingId: r.out_id, incomingId: r.back_id, outDay: r.out_day, backDay: r.back_day, amountMinor: Number(r.amount) } : null;
}
