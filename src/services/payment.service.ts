/**
 * خدمة المدفوعات: التسجيل والتخصيص.
 *
 * القاعدة التي يفرضها هذا الملف: **مجموع ما يُخصَّص من دفعة لا يتجاوز
 * قيمتها**. وجدنا في البيانات دفعةً بـ١٥٠٠٫٠٠ خُصّص منها ١٥٠٠٫٠١ — هللةٌ
 * واحدة، لكنّها تعني أنّ النظام يخلق مالاً لم يُدفع. فالتخصيص يُحدّ بما
 * بقي، والفائض يُعلَن ولا يُبتلَع.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { bankTransactions, invoices, paymentAllocations, payments } from "@/db/schema";
import { assertMonthsOpen } from "./month-guard";
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
  method: "BANK_TRANSFER" | "CASH" | "EMPLOYEE_ADVANCE" | "OWNER_ACCOUNT";
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
  /**
   * أُقِرّ أنّ دفعةً بنفس المورّد واليوم والمبلغ **واقعةٌ أخرى**.
   *
   * بلا هذا يرمي `createPayment` بـ`PaymentTwinError` إن وجد توأماً —
   * فالسؤال يقع في الموضع الذي يمرّ به كلُّ باب، لا في مسارين من ثمانية.
   * وبيكوف يُدفَع له مرّتين في اليوم حقيقةً، فهو إقرارٌ لا منع.
   */
  acknowledgeTwin?: boolean;
}

/** توأمٌ وُجد ولم يُقَرّ بأنّه واقعةٌ أخرى. */
export class PaymentTwinError extends Error {
  readonly status = 409;
  constructor(readonly twin: { id: string; hasBankRow: boolean; allocatedMinor: number }) {
    super("سدادٌ بنفس المورّد والمبلغ في اليوم نفسه مقيَّدٌ من قبل — افتحه قبل أن تسجّل ثانيةً");
    this.name = "PaymentTwinError";
  }
}

/** الحركة قُيّدت بدفعةٍ بين قراءتها وكتابتها — ضغطتان أو تبويبان. */
export class AlreadyMatchedError extends Error {
  readonly status = 409;
  constructor() {
    super("قُيّدت هذه الحركة من قبل — لم يُكتب شيءٌ ثانيةً. افتحها في صفحة البنك لترى دفعتها");
    this.name = "AlreadyMatchedError";
  }
}

/**
 * دفعةٌ سبقتها بنفس المورّد ونفس اليوم ونفس المبلغ.
 *
 * **الريال الواحد يُسجَّل مرّتين حين يأتي من بابين.** إيصالُ السداد في
 * الدرايف يُنشئ دفعة، وحركةُ الكشف نفسُها تُنشئ أخرى، ولا فاحصَ بينهما.
 * وقِيس على قاعدة أحمد فوُجدت أربع: أفال ٨٬٤٠٢٫٧٧ · بيكوف ٩٠٠ · لافا
 * ٩٤٥ · كوهي ٨٣٣٫٧٥ — **١١٬٠٨١٫٥٢ ريالاً محسوبةً مرّتين**، تُظهر
 * المورّد مدفوعاً له أكثر ممّا أخذ فيُطالَب بردٍّ لا يستحقّه.
 *
 * والمفتاح ثلاثة: المورّد واليومُ والمبلغ. ولا يُضاف إليه المصدر —
 * فالمقصود بالضبط أن يلتقي مصدران على واقعةٍ واحدة.
 *
 * وهذا **كشفٌ لا قيد**: مورّدٌ قد يُدفع له مرّتين في اليوم بنفس المبلغ
 * حقيقةً (بيكوف يُسدَّد بمئةٍ وخمسين لكلّ فاتورة). فيُرَدّ ما وُجد
 * ويُترَك القرارُ لمن استدعى — ومن يقيّد من إيصالٍ يتبنّى، ومن يقيّد
 * من كشفٍ يُنشئ.
 */
export async function findPaymentTwin(
  tx: Tx,
  input: { supplierId: string | null; paidAt: Date; amountMinor: number },
): Promise<{
  id: string;
  documentId: string | null;
  allocatedMinor: number;
  hasBankRow: boolean;
} | null> {
  if (!input.supplierId) return null;

  const [row] = await tx
    .select({
      id: payments.id,
      documentId: payments.documentId,
      allocatedMinor: sql<number>`coalesce((
        select sum(pa.amount_minor)::int from payment_allocations pa
         where pa.payment_id = ${payments}.id
      ), 0)`,
      hasBankRow: sql<boolean>`exists (
        select 1 from bank_transactions bt where bt.matched_payment_id = ${payments}.id
      )`,
    })
    .from(payments)
    .where(and(
      eq(payments.supplierId, input.supplierId),
      eq(payments.amountMinor, input.amountMinor),
      /* اليومُ نفسه — لا اللحظةُ نفسها: الإيصال يُؤرَّخ بيومه والكشف بوقته */
      sql`${payments.paidAt}::date = ${input.paidAt.toISOString().slice(0, 10)}::date`,
      sql`${payments.status} not in ('REVERSED','VOID')`,
    ))
    /* ما لا حركةَ بنكٍ له أوّلاً: هو الذي يُتبنّى، وما له حركة واقعةٌ أخرى */
    .orderBy(
      sql`exists (select 1 from bank_transactions bt where bt.matched_payment_id = ${payments}.id)`,
      payments.createdAt,
    )
    .limit(1);

  return row
    ? {
        id: row.id,
        documentId: row.documentId,
        allocatedMinor: Number(row.allocatedMinor),
        hasBankRow: Boolean(row.hasBankRow),
      }
    : null;
}

export async function createPayment(tx: Tx, input: CreatePaymentInput): Promise<string> {
  await assertMonthsOpen(tx, [input.appliesToMonth ?? input.paidAt.toISOString().slice(0, 7)]);

  /*
    ── الواقعة الواحدة لا تُقيَّد دفعتين ──

    كان `findPaymentTwin` يُسأل في مسارين من ثمانية تُنشئ دفعة، وحتى
    هناك يُنشأ ثانٍ إن كان التوأم مخصَّصاً. فبقيت لافا ٩٤٥ دفعتين على
    فاتورتين وأطلس ٥٧٥ رصيداً وهميّاً. فصار السؤال هنا، ومن أراد
    الإنشاء مع وجود التوأم يُقِرّ بذلك صراحةً.
  */
  if (input.supplierId && !input.acknowledgeTwin) {
    const twin = await findPaymentTwin(tx, {
      supplierId: input.supplierId,
      paidAt: input.paidAt,
      amountMinor: input.amountMinor,
    });
    if (twin) throw new PaymentTwinError(twin);
  }

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
 * دفعةٌ من حركة بنك — تُتبنّى إن كانت الواقعةُ مقيَّدةً بلا حركة.
 *
 * إيصالٌ في الدرايف أو قيدٌ يدويّ سبق الكشف: هو **هذه** الحوالة، فتُربَط
 * بها ولا تُنسَخ — مخصَّصةً كانت أو لا. وكان التبنّي مشروطاً بألّا يكون
 * التوأم مخصَّصاً، فأُنشئ لأطلس ثانٍ غير مخصَّص بجانب الأوّل المخصَّص.
 * وتوأمٌ له حركةُ بنكٍ أخرى واقعةٌ أخرى، فيُنشأ مع الإقرار.
 */
export async function recordBankPayment(
  tx: Tx,
  input: CreatePaymentInput,
): Promise<{ id: string; adopted: boolean }> {
  const twin = await findPaymentTwin(tx, {
    supplierId: input.supplierId ?? null,
    paidAt: input.paidAt,
    amountMinor: input.amountMinor,
  });

  if (twin && !twin.hasBankRow) {
    await assertMonthsOpen(tx, [input.appliesToMonth]);
    await tx
      .update(payments)
      .set({
        beneficiaryNameRaw: sql`coalesce(${payments.beneficiaryNameRaw}, ${input.beneficiaryNameRaw ?? null})`,
        appliesToMonth: sql`coalesce(${payments.appliesToMonth}, ${input.appliesToMonth ?? null})`,
      })
      .where(eq(payments.id, twin.id));
    return { id: twin.id, adopted: true };
  }

  const id = await createPayment(tx, { ...input, acknowledgeTwin: true });
  return { id, adopted: false };
}

/**
 * يربط الحركة بدفعتها — **بشرط ألّا تكون مربوطة**، ويرمي إن لم يُكتب صفّ.
 *
 * كان الفحص قبل المعاملة والتحديثُ بالمعرّف وحده، فطلبان متزامنان
 * (ضغطتان، أو تبويبان) يمرّان كلاهما ويُنشئان دفعتين والحركةُ تشير إلى
 * الثانية. ومؤثِّر `026` يمنع تجاوز الفاتورة لا تكرار الدفعة للحركة.
 * والرمي داخل المعاملة يُلغي الدفعة وتخصيصها معاً.
 */
export async function claimBankTransaction(
  tx: Tx,
  bankTransactionId: string,
  set: Partial<typeof bankTransactions.$inferInsert> & { matchedPaymentId: string },
): Promise<void> {
  const rows = await tx
    .update(bankTransactions)
    .set(set)
    .where(and(
      eq(bankTransactions.id, bankTransactionId),
      sql`${bankTransactions.matchedPaymentId} is null`,
    ))
    .returning({ id: bankTransactions.id });
  if (rows.length === 0) throw new AlreadyMatchedError();
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
  /**
   * ما كانت الدفعة تغطّيه قبل الردّ — **فاتورةً فاتورة بمبلغها**.
   *
   * وكان المردود يُحفَظ عدداً ومجموعاً: «فُكّت ٢ تخصيصات، تحرّر ٣٠٠٠».
   * وذلك يجيب «كم» ولا يجيب «أيّ» — فلا يُعرَف بعد شهرٍ أنّ هذه الدفعة
   * كانت على فاتورتَي أغسطس ٤ و١٢. والصفوف تُحذَف من `payment_allocations`
   * لأنّ خمسين استعلاماً تحسب المستحقّ منها، وإبقاءُ المردود فيها يوجب
   * تصفيتَه في كلٍّ منها — وفي مؤثِّرَي القاعدة أيضاً؛ ونسيانُ واحدٍ
   * يُنقص المستحقّ صامتاً. فيُحفَظ التفصيل في أثر القرار وسجلّ التدقيق،
   * وكلاهما لا يُحذَف منه شيء.
   */
  previousAllocations: { invoiceId: string; amountMinor: number }[];
}

/**
 * يردّ دفعةً أو يلغيها.
 *
 * والدفعة تبقى بحالها وسببها ومن ردّها — لا تُحذَف. والحذف يجعل الفاتورة
 * تعود مستحقّةً بلا سببٍ ظاهر، فيُدفَع ثمنها مرّتين. وما كانت تغطّيه
 * يخرج في `previousAllocations` كي يُقيَّد أثراً لا يُمحى.
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
    previousAllocations: allocations.map((a) => ({
      invoiceId: a.invoiceId,
      amountMinor: a.amountMinor,
    })),
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
  if (requests.length > 0) {
    const months = await tx
      .select({ month: invoices.periodMonth })
      .from(invoices)
      .where(inArray(invoices.id, requests.map((r) => r.invoiceId)));
    await assertMonthsOpen(tx, months.map((m) => m.month));
  }

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
