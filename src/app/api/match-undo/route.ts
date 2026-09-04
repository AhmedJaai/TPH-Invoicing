/**
 * التراجع عن مطابقة.
 *
 * كان القبول نهائياً: من وافق على مطابقة خاطئة لا يملك ردّها إلّا
 * بتعديل القاعدة يدوياً. والمال يُراجَع ويُصحَّح.
 *
 * والتراجع ليس حذفاً صامتاً: تُفكّ التخصيصات، وتُحذف الدفعة إن لم يبقَ
 * لها تخصيص، وتعود الحركة «تحتاج مراجعة»، ويُكتب ذلك كلّه في سجلّ
 * التدقيق باسم من تراجع.
 */
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, paymentAllocations, payments } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface Body {
  transactionId?: string;
  /** سبب التراجع — يُحفَظ كي يُفهَم لاحقاً لِمَ فُكّت. */
  reason?: string;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("match-undo", "bank:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  if (!body.transactionId) {
    return NextResponse.json({ error: "حدّد الحركة" }, { status: 400 });
  }

  const [tx] = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, body.transactionId));

  if (!tx) return NextResponse.json({ error: "لا توجد هذه الحركة" }, { status: 404 });
  if (!tx.matchedPaymentId) {
    return NextResponse.json({ error: "هذه الحركة غير مطابَقة أصلاً" }, { status: 409 });
  }

  const paymentId = tx.matchedPaymentId;
  let removedAllocations = 0;
  let removedPayment = false;

  await db.transaction(async (t) => {
    // تُفكّ الحركة عن الدفعة أوّلاً كي لا يمنع المفتاح الأجنبيّ حذفها
    await t
      .update(bankTransactions)
      .set({
        matchedPaymentId: null,
        matchStatus: "UNMATCHED",
        matchDisposition: "REVIEW",
        matchOutcome: null,
        matchScore: null,
      })
      .where(eq(bankTransactions.id, tx.id));

    const removed = await t
      .delete(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId));
    removedAllocations = removed.rowCount ?? 0;

    /*
      الدفعة تُحذف إن لم تعد تفسّر شيئاً. أمّا إن بقيت لها حركة أخرى
      فتبقى — فحذفها يكسر مطابقةً صحيحة لم يُطلَب التراجع عنها.
    */
    const [{ others }] = (
      await t.execute<{ others: number }>(sql`
        select count(*)::int as others from bank_transactions
        where matched_payment_id = ${paymentId}
      `)
    ).rows;

    if (Number(others) === 0) {
      await t.delete(payments).where(eq(payments.id, paymentId));
      removedPayment = true;
    }
  });

  await recordAudit({
    actorId: user.id,
    action: "INVOICES_MARKED_PAID",
    entityType: "bank_transaction",
    entityId: tx.id,
    before: {
      الدفعة: paymentId,
      الحالة: tx.matchStatus,
      القرار: tx.matchDisposition,
      الدرجة: tx.matchScore,
      الأدلّة: tx.matchEvidence,
    },
    after: {
      الفعل: "تراجع عن المطابقة",
      السبب: body.reason?.trim() || "لم يُذكر",
      "تخصيصات فُكّت": removedAllocations,
      "حُذفت الدفعة": removedPayment,
    },
  });

  return NextResponse.json({
    ok: true,
    removedAllocations,
    removedPayment,
    message: removedPayment
      ? `فُكّت المطابقة وحُذفت الدفعة و${removedAllocations} تخصيصاً`
      : `فُكّت المطابقة و${removedAllocations} تخصيصاً، والدفعة باقية لحركة أخرى`,
  });
}
