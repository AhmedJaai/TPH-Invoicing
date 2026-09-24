/**
 * حسمُ دفعةٍ بلا مورّد ولا حركة بنك — انظر `lib/orphan-payment.ts`.
 *
 * والمعاملةُ واحدة: القفلُ على الدفعة، والشرطُ أنّها **ما زالت** بلا مورّد
 * وقائمة — فضغطتان متزامنتان لا تنسبانها مرّتين، ولا يُعاد نسبُ دفعةٍ لها
 * مورّدٌ من هذا الباب أبداً (نسبُ المال التاريخيّ إلى غير صاحبه له بابُه
 * وإذنُه). والشهرُ المقفل يمنع، والأثرُ في سجلّ التدقيق بالمقبض نفسه.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { documents, payments, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertMonthsOpen } from "./month-guard";
import { reversePayment } from "./payment.service";
import type { OrphanPaymentRequest } from "@/lib/orphan-payment";
import type { Tx } from "./types";

export class OrphanPaymentError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
    this.name = "OrphanPaymentError";
  }
}

/** يُستدعى داخل معاملة — والمسارُ يفتحها، والاختبارُ يفتحها ويُلغيها. */
export async function resolveOrphanPayment(
  t: Tx,
  req: OrphanPaymentRequest,
  userId: string,
): Promise<{ message: string }> {
  const [p] = await t
    .select({
      id: payments.id,
      supplierId: payments.supplierId,
      status: payments.status,
      amountMinor: payments.amountMinor,
      paidAt: payments.paidAt,
      appliesToMonth: payments.appliesToMonth,
      documentId: payments.documentId,
      hasBankTx: sql<boolean>`exists (
        select 1 from bank_transactions bt where bt.matched_payment_id = ${payments}.id
      )`,
    })
    .from(payments)
    .where(eq(payments.id, req.paymentId))
    .for("update")
    .limit(1);

  if (!p) throw new OrphanPaymentError("لا دفعة بهذا المعرّف — ربما حُسمت من نافذةٍ أخرى. حدّث الصفحة.", 404);
  if (p.status === "REVERSED" || p.status === "VOID") {
    throw new OrphanPaymentError("هذه الدفعة مُلغاةٌ أو مردودة من قبل — حدّث الصفحة.", 409);
  }
  if (p.supplierId) {
    throw new OrphanPaymentError("هذه الدفعة منسوبةٌ إلى مورّدٍ من قبل — ولا يُعاد نسبُها من هنا.", 409);
  }
  /* دفعةٌ لها حركة بنك تُعرَّف جهتُها من الحركة — بابُها صفحةُ البنك */
  if (p.hasBankTx) {
    throw new OrphanPaymentError("لهذه الدفعة حركةُ بنك — عرّف جهتها من صفحة البنك.", 409);
  }

  await assertMonthsOpen(t, [p.appliesToMonth, p.paidAt.toISOString().slice(0, 7)]);

  if (req.action === "assign") {
    const [s] = await t
      .select({ id: suppliers.id, nameAr: suppliers.nameAr, isActive: suppliers.isActive })
      .from(suppliers)
      .where(eq(suppliers.id, req.supplierId))
      .limit(1);
    if (!s || !s.isActive) throw new OrphanPaymentError("لا مورّد قائم بهذا المعرّف.", 404);

    const rows = await t
      .update(payments)
      .set({ supplierId: s.id })
      .where(and(eq(payments.id, p.id), isNull(payments.supplierId)))
      .returning({ id: payments.id });
    if (rows.length === 0) throw new OrphanPaymentError("نُسبت هذه الدفعة للتوّ من نافذةٍ أخرى.", 409);

    /* الإيصالُ يتبع دفعتَه — وإلّا بقي «بلا مورّد» في الأرشيف وحده */
    if (p.documentId) {
      await t
        .update(documents)
        .set({ supplierId: s.id })
        .where(and(eq(documents.id, p.documentId), isNull(documents.supplierId)));
    }

    await recordAudit({
      actorId: userId,
      action: "PAYMENT_RECORDED",
      entityType: "payment",
      entityId: p.id,
      before: { المورّد: null },
      after: { المورّد: s.nameAr, المبلغ: p.amountMinor, السبب: "نُسبت دفعةٌ بلا مورّد من إيصالها" },
    }, t);

    return { message: `نُسبت إلى ${s.nameAr} — وصارت رصيداً له يُخصم من دَينه.` };
  }

  const outcome = await reversePayment(t, { paymentId: p.id, kind: "VOID", reason: req.reason, userId });
  await recordAudit({
    actorId: userId,
    action: "PAYMENT_VOIDED",
    entityType: "payment",
    entityId: p.id,
    before: { الحال: p.status, المبلغ: p.amountMinor },
    after: { الحال: outcome.status, السبب: outcome.reason },
  }, t);
  return { message: "أُلغي قيدُها — ليست سدادَ مورّد. والإيصالُ باقٍ في الأرشيف، والأثرُ في السجلّ." };
}
