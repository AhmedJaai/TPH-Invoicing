/**
 * خدمة المدفوعات: التسجيل والتخصيص.
 *
 * القاعدة التي يفرضها هذا الملف: **مجموع ما يُخصَّص من دفعة لا يتجاوز
 * قيمتها**. وجدنا في البيانات دفعةً بـ١٥٠٠٫٠٠ خُصّص منها ١٥٠٠٫٠١ — هللةٌ
 * واحدة، لكنّها تعني أنّ النظام يخلق مالاً لم يُدفع. فالتخصيص يُحدّ بما
 * بقي، والفائض يُعلَن ولا يُبتلَع.
 */
import { eq, sql } from "drizzle-orm";
import { paymentAllocations, payments } from "@/db/schema";
import { planAllocations, type AllocationRequest } from "@/lib/allocation";
import {
  derivePaymentStatus, planReversal, type PaymentStatus,
} from "@/lib/payment-state";
import type { Tx } from "./types";

export type { AllocationRequest };
export type { PaymentStatus };

export interface CreatePaymentInput {
  documentId?: string | null;
  supplierId?: string | null;
  paidAt: Date;
  amountMinor: number;
  method: "BANK_TRANSFER" | "CASH" | "EMPLOYEE_ADVANCE";
  beneficiaryNameRaw?: string | null;
  appliesToMonth?: string | null;
  /**
   * رسمُ التحويل داخل المبلغ — يخرج من القسمة قبلها.
   * وبلا فصله تظهر الدفعة فائضةً ويُفتَح للمورّد رصيدٌ لا وجود له.
   */
  feeMinor?: number;
  /**
   * دفعةٌ مقدّمة أعلنها صاحبها.
   *
   * وهي غير «لم تُخصَّص بعد»: تلك تنتظر عملاً، وهذه تمّ عملها. ومن دفع
   * قبل وصول الفاتورة كانت دفعته تبقى معلّقةً إلى الأبد وكأنّها خطأ.
   */
  isAdvance?: boolean;
}

export async function createPayment(tx: Tx, input: CreatePaymentInput): Promise<string> {
  const [row] = await tx
    .insert(payments)
    .values({
      documentId: input.documentId ?? null,
      supplierId: input.supplierId ?? null,
      paidAt: input.paidAt,
      amountMinor: input.amountMinor,
      method: input.method,
      beneficiaryNameRaw: input.beneficiaryNameRaw ?? null,
      appliesToMonth: input.appliesToMonth ?? null,
      feeMinor: Math.max(0, Math.min(input.feeMinor ?? 0, input.amountMinor)),
      isAdvance: input.isAdvance ?? false,
      /*
        الحال يُشتقّ لا يُكتَب بالحدس: دفعةٌ بلا تخصيصٍ بعدُ إمّا منتظرة
        وإمّا مقدّمة، والفرق نيّةٌ أعلنها صاحبها.
      */
      status: input.isAdvance ? "ADVANCE" : "UNAPPLIED",
    })
    .returning({ id: payments.id });
  return row.id;
}

/**
 * يعيد حساب حال الدفعة من تخصيصاتها.
 *
 * ويُستدعى بعد كل تغيير في التخصيص. وبدونه يبقى الحال المحفوظ يقول
 * «مستقرّة» بعد أن فُكَّ تخصيصها — والعمود الذي يخالف الحقيقة أسوأ من
 * غيابه، لأنّه يُبحَث به ويُجمَع عليه.
 */
export async function refreshPaymentStatus(tx: Tx, paymentId: string): Promise<PaymentStatus> {
  const [row] = await tx
    .select({
      amountMinor: payments.amountMinor,
      feeMinor: payments.feeMinor,
      isAdvance: payments.isAdvance,
      reversedAt: payments.reversedAt,
      voidedAt: payments.voidedAt,
      allocated: sql<number>`coalesce((
        select sum(amount_minor)::int from payment_allocations where payment_id = ${paymentId}
      ), 0)`,
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!row) return "VOID";

  const status = derivePaymentStatus({
    amountMinor: row.amountMinor,
    allocatedMinor: Number(row.allocated),
    feeMinor: row.feeMinor,
    declaredAdvance: row.isAdvance,
    reversedAt: row.reversedAt,
    voided: row.voidedAt !== null,
  });

  await tx.update(payments).set({ status }).where(eq(payments.id, paymentId));
  return status;
}

export interface ReverseInput {
  paymentId: string;
  kind: "REVERSED" | "VOID";
  reason: string;
  userId: string;
}

export interface ReverseOutcome {
  status: PaymentStatus;
  freedInvoiceIds: string[];
  freedMinor: number;
  reason: string;
}

/**
 * يردّ دفعةً أو يلغيها.
 *
 * ولا يحذف شيئاً: التخصيصات تُفَكّ والدفعة تبقى بحالها وسببها. والحذف
 * يجعل الفاتورة تعود مستحقّةً بلا سببٍ ظاهر، فيُدفَع ثمنها مرّتين.
 */
export async function reversePayment(tx: Tx, input: ReverseInput): Promise<ReverseOutcome> {
  const allocations = await tx
    .select({ invoiceId: paymentAllocations.invoiceId, amountMinor: paymentAllocations.amountMinor })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, input.paymentId));

  const plan = planReversal(allocations, input.kind, input.reason);

  await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, input.paymentId));

  const now = new Date();
  await tx
    .update(payments)
    .set({
      status: plan.status,
      reversalReason: plan.reason,
      reversedById: input.userId,
      ...(input.kind === "VOID" ? { voidedAt: now, reversedAt: null } : { reversedAt: now }),
    })
    .where(eq(payments.id, input.paymentId));

  return {
    status: plan.status,
    freedInvoiceIds: plan.freedInvoiceIds,
    freedMinor: plan.freedMinor,
    reason: plan.reason,
  };
}

export interface AllocationOutcome {
  allocatedMinor: number;
  /** ما لم يُخصَّص لأنّ الدفعة نفدت */
  unallocatedMinor: number;
  count: number;
}

/**
 * يخصّص دفعةً على فواتير.
 * الحساب في lib/allocation.ts دالةً خالصة؛ وهذه تكتب ما خطّطته.
 */
export async function allocate(
  tx: Tx,
  paymentId: string,
  paymentAmountMinor: number,
  requests: readonly AllocationRequest[],
): Promise<AllocationOutcome> {
  const already = await tx
    .select({ sum: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::int` })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, paymentId));

  /*
    الرسم يُطرَح من القابل للتخصيص.

    كان `splitBankFee` يحسب الرسم ثمّ لا يصل إلى التخصيص — فتُقسَّم
    الدفعة كاملةً بما فيها رسمُ البنك، ويُنسَب إلى المورّد مالٌ ذهب
    إلى البنك. حسابٌ صحيح لا يصل إلى المال أسوأ من عدمه: يوهم أنّ
    الحالة معالَجة.
  */
  const [meta] = await tx
    .select({ feeMinor: payments.feeMinor })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  const distributable = Math.max(0, paymentAmountMinor - (meta?.feeMinor ?? 0));
  const plan = planAllocations(distributable, Number(already[0]?.sum ?? 0), requests);

  let count = 0;
  for (const a of plan.allocations) {
    const inserted = await tx
      .insert(paymentAllocations)
      .values({ paymentId, invoiceId: a.invoiceId, amountMinor: a.amountMinor })
      .onConflictDoNothing()
      .returning({ id: paymentAllocations.id });
    if (inserted.length > 0) count++;
  }

  await refreshPaymentStatus(tx, paymentId);

  return {
    allocatedMinor: plan.allocatedMinor,
    unallocatedMinor: plan.shortfallMinor,
    count,
  };
}
