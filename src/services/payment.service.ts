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
import type { Tx } from "./types";

export type { AllocationRequest };

export interface CreatePaymentInput {
  documentId?: string | null;
  supplierId?: string | null;
  paidAt: Date;
  amountMinor: number;
  method: "BANK_TRANSFER" | "CASH" | "EMPLOYEE_ADVANCE";
  beneficiaryNameRaw?: string | null;
  appliesToMonth?: string | null;
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
    })
    .returning({ id: payments.id });
  return row.id;
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

  const plan = planAllocations(paymentAmountMinor, Number(already[0]?.sum ?? 0), requests);

  let count = 0;
  for (const a of plan.allocations) {
    const inserted = await tx
      .insert(paymentAllocations)
      .values({ paymentId, invoiceId: a.invoiceId, amountMinor: a.amountMinor })
      .onConflictDoNothing()
      .returning({ id: paymentAllocations.id });
    if (inserted.length > 0) count++;
  }

  return {
    allocatedMinor: plan.allocatedMinor,
    unallocatedMinor: plan.shortfallMinor,
    count,
  };
}
