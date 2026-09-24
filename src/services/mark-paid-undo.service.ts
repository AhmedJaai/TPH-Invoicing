/**
 * التراجعُ عن «سجّل أنّها سُدّدت» — من إشعار التراجع، ما دام قريباً.
 *
 * الإقرارُ بالسداد دفعاتٌ يكتبها `/api/mark-paid` بلا حركة بنك. ومن ضغطها
 * خطأً كان لا يملك ردّها إلّا من صفحة البنك إن وُجدت حركة — ولا حركة.
 * فالتراجعُ هنا **إلغاءٌ لا حذف** (`VOID`: سُجّلت خطأً ولم تقع): تُفكّ
 * تخصيصاتُها فتعود الفواتيرُ مفتوحة، وتبقى الدفعةُ وأثرُها في السجلّ.
 *
 * وحارسُه أضيقُ من حارس الإلغاء العامّ: الدفعةُ نفسُها التي كُتبت الآن
 * (خلال `UNDO_WINDOW_MINUTES`)، بلا حركة بنك ولا مستند، وقائمةٌ لم تُردّ،
 * في شهرٍ مفتوح. فلا يصير الزرُّ باباً لإلغاء مالٍ تاريخيّ.
 */
import { inArray, sql } from "drizzle-orm";
import { payments } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertMonthsOpen } from "./month-guard";
import { reversePayment } from "./payment.service";
import type { Tx } from "./types";

export const UNDO_WINDOW_MINUTES = 30;

export class UndoError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
    this.name = "UndoError";
  }
}

export async function undoMarkedPaid(
  t: Tx,
  paymentIds: readonly string[],
  userId: string,
): Promise<{ voided: number; freedMinor: number }> {
  const rows = await t
    .select({
      id: payments.id,
      status: payments.status,
      amountMinor: payments.amountMinor,
      paidAt: payments.paidAt,
      appliesToMonth: payments.appliesToMonth,
      documentId: payments.documentId,
      recent: sql<boolean>`${payments}.created_at > now() - make_interval(mins => ${UNDO_WINDOW_MINUTES})`,
      hasBankTx: sql<boolean>`exists (select 1 from bank_transactions bt where bt.matched_payment_id = ${payments}.id)`,
    })
    .from(payments)
    .where(inArray(payments.id, [...paymentIds]))
    .for("update");

  if (rows.length !== paymentIds.length) {
    throw new UndoError("لم تُوجد كلُّ الدفعات — ربما أُلغيت من نافذةٍ أخرى. حدّث الصفحة.", 404);
  }
  for (const p of rows) {
    if (p.status === "REVERSED" || p.status === "VOID") {
      throw new UndoError("أُلغي هذا السداد من قبل — حدّث الصفحة.", 409);
    }
    if (!p.recent) {
      throw new UndoError("فات وقتُ التراجع من الإشعار — ألغِ الدفعة من ملفّ الفاتورة.", 409);
    }
    if (p.hasBankTx || p.documentId) {
      throw new UndoError("لهذه الدفعة حركةُ بنكٍ أو إيصال — لا تُلغى من هنا.", 409);
    }
  }

  await assertMonthsOpen(t, rows.flatMap((p) => [p.appliesToMonth, p.paidAt.toISOString().slice(0, 7)]));

  let freedMinor = 0;
  for (const p of rows) {
    const out = await reversePayment(t, {
      paymentId: p.id,
      kind: "VOID",
      reason: "تراجعٌ عن إقرار سدادٍ سُجّل خطأً — من إشعار التراجع",
      userId,
    });
    freedMinor += out.freedMinor;
    await recordAudit(
      {
        actorId: userId,
        action: "PAYMENT_VOIDED",
        entityType: "payment",
        entityId: p.id,
        after: {
          السبب: out.reason,
          "فُكّ عن الفواتير بالهللات": out.freedMinor,
          الفواتير: out.freedInvoiceIds,
        },
      },
      t,
    );
  }
  return { voided: rows.length, freedMinor };
}
