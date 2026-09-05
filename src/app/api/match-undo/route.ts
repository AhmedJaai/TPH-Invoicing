/**
 * التراجع عن مطابقة.
 *
 * كان القبول نهائياً: من وافق على مطابقة خاطئة لا يملك ردّها إلّا
 * بتعديل القاعدة يدوياً. والمال يُراجَع ويُصحَّح.
 *
 * **ولا يُحذف شيء.** كانت الدفعة تُحذف إن لم تعد تفسّر حركة — فيختفي
 * أنّ مالاً خرج ونُسب ثمّ رُدّ نسبُه، ولا يبقى إلّا سطرٌ في سجلّ
 * التدقيق يقول إنّ شيئاً حُذف. ومن راجع بعد شهر يجد فاتورةً عادت
 * مستحقّةً بلا سببٍ ظاهر، فيدفع ثمنها مرّتين.
 *
 * فصارت الدفعة تُردّ لا تُحذف: تُفكّ تخصيصاتها، وتُعلَن `REVERSED`
 * بسببها ومن ردّها، فتخرج من «ما دُفع» ويبقى أثرها. ويُكتب الحدث في
 * `decision_history` — وهو يجيب عن سؤالٍ آخر غير «من فعل ماذا»:
 * **كيف تطوّر هذا القرار؟**
 */
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, decisionHistory } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { reversePayment } from "@/services/payment.service";

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
  const reason = body.reason?.trim() || "تراجعٌ يدويّ عن المطابقة";
  let freedInvoices: string[] = [];
  let freedMinor = 0;
  let reversedPayment = false;

  await db.transaction(async (t) => {
    await t
      .update(bankTransactions)
      .set({
        matchedPaymentId: null,
        matchStatus: "UNMATCHED",
        matchDisposition: "REVIEW",
        matchOutcome: null,
        matchScore: null,
        /*
          الردّ يُنزل الطبقة إلى «مقترَحة»: عاد لها مرشّحٌ بلا حسم.
          ولا تعود `RAW` — فما عُرف عنها لم يُمحَ بردّ المطابقة.
        */
        lifecycle: "SUGGESTED",
      })
      .where(eq(bankTransactions.id, tx.id));

    /*
      الدفعة تُردّ إن لم تعد تفسّر حركة. أمّا إن بقيت لها حركة أخرى
      فتبقى عاملة — فردّها يكسر مطابقةً صحيحة لم يُطلَب التراجع عنها.
    */
    const [{ others }] = (
      await t.execute<{ others: number }>(sql`
        select count(*)::int as others from bank_transactions
        where matched_payment_id = ${paymentId}
      `)
    ).rows;

    if (Number(others) === 0) {
      const outcome = await reversePayment(t, {
        paymentId,
        kind: "REVERSED",
        reason,
        userId: user.id,
      });
      freedInvoices = outcome.freedInvoiceIds;
      freedMinor = outcome.freedMinor;
      reversedPayment = true;
    }

    /*
      الحدث في تاريخ القرار — لا في سجلّ التدقيق وحده.

      سجلّ التدقيق يجيب «من فعل ماذا ومتى»، وهذا يجيب «كيف صار هذا
      القرار على ما هو عليه»: صُنّفت، ثمّ اقتُرحت، ثمّ أُقرّت، ثمّ رُدّت.
      وبلا التسلسل لا يُقاس أين يُخطئ النظام.
    */
    await t.insert(decisionHistory).values({
      bankTransactionId: tx.id,
      event: "MATCH_REVERSED",
      actor: "HUMAN",
      actorId: user.id,
      detail: reason,
      payload: {
        الدفعة: paymentId,
        "فواتير تحرّرت": freedInvoices.length,
        "مبلغ تحرّر": freedMinor,
        "رُدّت الدفعة": reversedPayment,
      },
    });
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
      السبب: reason,
      "تخصيصات فُكّت": freedInvoices.length,
      "رُدّت الدفعة": reversedPayment,
      "مبلغ تحرّر": freedMinor,
    },
  });

  return NextResponse.json({
    ok: true,
    removedAllocations: freedInvoices.length,
    reversedPayment,
    freedMinor,
    message: reversedPayment
      ? `فُكّت المطابقة ورُدّت الدفعة و${freedInvoices.length} تخصيصاً — والدفعة باقيةٌ في السجلّ مردودةً بسببها`
      : `فُكّت المطابقة و${freedInvoices.length} تخصيصاً، والدفعة باقية لحركة أخرى`,
  });
}
