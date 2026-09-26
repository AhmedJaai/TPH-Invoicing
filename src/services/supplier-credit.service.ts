/**
 * رصيدُ المورّد على فواتيره، والسدادُ من حساب المالك.
 *
 * ── لماذا كان النظام يقول «عليك ١٨ ألفاً» ──
 *
 * سببان، والحلّ لهما هنا:
 *
 * ١. **مالٌ عند المورّد لا يُخصم.** الدفعة تُوزَّع يوم قيدها على المفتوح
 *    يومئذٍ؛ فإن وصلت الفاتورة بعدها بقيت مستحقّة والمال عند المورّد.
 *    ← `applySupplierCredit`، ويُستدعى عند وصول كلّ فاتورة.
 *
 * ٢. **فاتورةٌ سُدّدت خارج حساب المقهى.** لا يراها كشف البنك، فيوزّع
 *    النظام حوالاتٍ لاحقة عليها «بالأقدم أوّلاً»، فتبقى الفاتورة التي
 *    سُدّدت بتلك الحوالات فعلاً مفتوحة. وهذا ما وقع لمصنع الكوب الذهبي:
 *    مايو من حساب المالك، والحوالات الأربع (١٣٬٣٥٤٫٣٨) خُصّصت على مايو،
 *    فبقيت يوليو (١٢٬٠٠٣٫١٣) كاملةً وقد سُدّدت.
 *    ← `markPaidByOwner`: يُقيَّد سدادُ المالك، وتُفَكّ حوالاتُ المقهى
 *    عن تلك الفاتورة، ثمّ تُخصم من فواتير المورّد الأخرى. ومعاينتُه
 *    `previewOwnerPaid` تعرض ما سينتقل قبل أن يقع.
 *
 * والتخصيص نفسه يمرّ بـ`allocate()` — فيحرسه مؤثِّر القاعدة ولا يتجاوز
 * فاتورةً ولا دفعة.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { paymentAllocations } from "@/db/schema";
import {
  planCreditApplication,
  type AvailableCredit,
  type CreditAllocation,
  type OpenInvoice,
} from "@/lib/allocation";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { allocate, createPayment, refreshPaymentStatus } from "./payment.service";
import type { db } from "@/db";
import type { Tx } from "./types";

type Executor = typeof db | Tx;

/** طرقُ سدادٍ لا تمرّ بحساب المقهى — تخصيصُها يبقى عند الفكّ. */
const OUTSIDE_BANK_METHODS = new Set(["OWNER_ACCOUNT", "CASH"]);

export class CreditError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "CreditError";
    this.status = status;
  }
}

interface CreditRow extends AvailableCredit {
  amountMinor: number;
}

async function loadCredits(executor: Executor, supplierId: string): Promise<CreditRow[]> {
  const rows = (
    await executor.execute<{ id: string; paid_at: Date | string; amount_minor: number; available: string | number }>(sql`
      select p.id, p.paid_at, p.amount_minor,
             (p.amount_minor - p.fee_minor - coalesce((
               select sum(pa.amount_minor) from payment_allocations pa where pa.payment_id = p.id
             ), 0))::bigint as available
        from payments p
       where p.supplier_id = ${supplierId}
         and p.status not in ('REVERSED', 'VOID')
    `)
  ).rows;
  return rows
    .map((r) => ({
      paymentId: r.id,
      paidAt: new Date(r.paid_at),
      amountMinor: Number(r.amount_minor),
      availableMinor: Number(r.available),
    }))
    .filter((r) => r.availableMinor > 0);
}

async function loadOpenInvoices(
  executor: Executor,
  supplierId: string,
): Promise<(OpenInvoice & { number: string })[]> {
  const rows = (
    await executor.execute<{ id: string; invoice_date: Date | string; invoice_number: string; remaining: string | number }>(sql`
      select i.id, i.invoice_date, i.invoice_number,
             (i.total_minor - coalesce((
               select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id
             ), 0))::bigint as remaining
        from invoices i
       where i.supplier_id = ${supplierId}
    `)
  ).rows;
  return rows
    .map((r) => ({
      invoiceId: r.id,
      invoiceDate: new Date(r.invoice_date),
      number: r.invoice_number,
      outstandingMinor: Number(r.remaining),
    }))
    .filter((r) => r.outstandingMinor > SETTLED_TOLERANCE_MINOR);
}

/** يكتب خطّة رصيد — كلّ دفعةٍ بتخصيصاتها عبر `allocate()`. */
async function writeCreditPlan(
  tx: Tx,
  allocations: readonly CreditAllocation[],
  amounts: Map<string, number>,
): Promise<number> {
  const byPayment = new Map<string, { invoiceId: string; amountMinor: number }[]>();
  for (const a of allocations) {
    const list = byPayment.get(a.paymentId) ?? [];
    list.push({ invoiceId: a.invoiceId, amountMinor: a.amountMinor });
    byPayment.set(a.paymentId, list);
  }
  let written = 0;
  for (const [paymentId, requests] of byPayment) {
    const outcome = await allocate(tx, paymentId, amounts.get(paymentId) ?? 0, requests);
    written += outcome.allocatedMinor;
  }
  return written;
}

export interface CreditOutcome {
  allocations: CreditAllocation[];
  appliedMinor: number;
  creditLeftMinor: number;
}

/**
 * يخصم رصيدَنا عند المورّد من فواتيره المفتوحة.
 *
 * `forwardDays: 7` هو ما يقع آلياً عند وصول الفاتورة. و`null` حين يقرّر
 * إنسان (إقرارُ اقتراحٍ أو سدادٌ من حساب المالك).
 */
export async function applySupplierCredit(
  tx: Tx,
  supplierId: string,
  options: { forwardDays: number | null; paymentIds?: readonly string[] },
): Promise<CreditOutcome> {
  let credits = await loadCredits(tx, supplierId);
  if (options.paymentIds) {
    const only = new Set(options.paymentIds);
    credits = credits.filter((c) => only.has(c.paymentId));
  }
  if (credits.length === 0) return { allocations: [], appliedMinor: 0, creditLeftMinor: 0 };

  const open = await loadOpenInvoices(tx, supplierId);
  const plan = planCreditApplication(credits, open, { forwardDays: options.forwardDays });
  if (plan.allocations.length === 0) {
    return { allocations: [], appliedMinor: 0, creditLeftMinor: plan.creditLeftMinor };
  }

  const amounts = new Map(credits.map((c) => [c.paymentId, c.amountMinor]));
  const applied = await writeCreditPlan(tx, plan.allocations, amounts);
  return { allocations: plan.allocations, appliedMinor: applied, creditLeftMinor: plan.creditLeftMinor };
}

/* ─────────────────── السداد من حساب المالك ─────────────────── */

export interface OwnerPaidPlan {
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  invoiceTotalMinor: number;
  /** ما يُقيَّد سداداً من حساب المالك. */
  ownerPaymentMinor: number;
  /** تخصيصاتُ حوالاتٍ من حساب المقهى تُفَكّ عن هذه الفاتورة. */
  freed: { paymentId: string; paidAt: string; amountMinor: number }[];
  /** وأين تذهب بعد الفكّ. */
  reapplied: { invoiceId: string; invoiceNumber: string; amountMinor: number }[];
  /** ما يبقى لنا عند المورّد بعدها. */
  creditLeftMinor: number;
}

async function loadInvoiceForOwner(executor: Executor, invoiceId: string) {
  const [inv] = (
    await executor.execute<{
      id: string; supplier_id: string | null; invoice_number: string; invoice_date: Date | string;
      period_month: string; total_minor: number;
    }>(sql`
      select id, supplier_id, invoice_number, invoice_date, period_month, total_minor
        from invoices where id = ${invoiceId}
    `)
  ).rows;
  if (!inv) throw new CreditError("الفاتورة غير موجودة", 404);
  if (!inv.supplier_id) throw new CreditError("الفاتورة بلا مورّد — لا حساب تُقيَّد عليه", 400);

  const allocs = (
    await executor.execute<{ payment_id: string; amount_minor: number; method: string; paid_at: Date | string }>(sql`
      select pa.payment_id, pa.amount_minor, p.method::text as method, p.paid_at
        from payment_allocations pa join payments p on p.id = pa.payment_id
       where pa.invoice_id = ${invoiceId}
    `)
  ).rows;

  return { inv, allocs };
}

/** المعاينة — لا تكتب شيئاً. */
export async function previewOwnerPaid(executor: Executor, invoiceId: string): Promise<OwnerPaidPlan> {
  const { inv, allocs } = await loadInvoiceForOwner(executor, invoiceId);
  const supplierId = inv.supplier_id!;

  const kept = allocs.filter((a) => OUTSIDE_BANK_METHODS.has(a.method));
  const freedRows = allocs.filter((a) => !OUTSIDE_BANK_METHODS.has(a.method));
  const keptMinor = kept.reduce((s, a) => s + Number(a.amount_minor), 0);
  const ownerPaymentMinor = inv.total_minor - keptMinor;

  if (ownerPaymentMinor <= SETTLED_TOLERANCE_MINOR) {
    throw new CreditError("هذه الفاتورة مقيَّدةٌ سداداً من خارج حساب المقهى أصلاً");
  }

  /* المحاكاة: الحوالات بعد الفكّ، وفواتير المورّد الأخرى */
  const freedByPayment = new Map<string, number>();
  for (const f of freedRows) {
    freedByPayment.set(f.payment_id, (freedByPayment.get(f.payment_id) ?? 0) + Number(f.amount_minor));
  }

  const credits = (await loadCredits(executor, supplierId))
    .filter((c) => freedByPayment.has(c.paymentId));
  const creditIds = new Set(credits.map((c) => c.paymentId));
  const simulated: AvailableCredit[] = [
    ...credits.map((c) => ({ ...c, availableMinor: c.availableMinor + (freedByPayment.get(c.paymentId) ?? 0) })),
    ...freedRows
      .filter((f) => !creditIds.has(f.payment_id))
      .map((f) => ({
        paymentId: f.payment_id,
        paidAt: new Date(f.paid_at),
        availableMinor: freedByPayment.get(f.payment_id) ?? 0,
      })),
  ];
  // كلّ دفعةٍ مرّةً واحدة
  const uniq = new Map<string, AvailableCredit>();
  for (const c of simulated) if (!uniq.has(c.paymentId)) uniq.set(c.paymentId, c);

  const others = (await loadOpenInvoices(executor, supplierId)).filter((i) => i.invoiceId !== invoiceId);
  const plan = planCreditApplication([...uniq.values()], others, { forwardDays: null });
  const numberOf = new Map(others.map((o) => [o.invoiceId, o.number]));

  const reappliedByInvoice = new Map<string, number>();
  for (const a of plan.allocations) {
    reappliedByInvoice.set(a.invoiceId, (reappliedByInvoice.get(a.invoiceId) ?? 0) + a.amountMinor);
  }

  return {
    invoiceId,
    invoiceNumber: inv.invoice_number,
    supplierId,
    invoiceTotalMinor: inv.total_minor,
    ownerPaymentMinor,
    freed: [...freedByPayment.entries()].map(([paymentId, amountMinor]) => ({
      paymentId,
      paidAt: new Date(freedRows.find((f) => f.payment_id === paymentId)!.paid_at).toISOString().slice(0, 10),
      amountMinor,
    })),
    reapplied: [...reappliedByInvoice.entries()].map(([id, amountMinor]) => ({
      invoiceId: id,
      invoiceNumber: numberOf.get(id) ?? "—",
      amountMinor,
    })),
    creditLeftMinor: plan.creditLeftMinor,
  };
}

export interface OwnerPaidOutcome extends OwnerPaidPlan {
  ownerPaymentId: string;
  appliedMinor: number;
}

/**
 * يقيّد الفاتورة مسدَّدةً من حساب المالك، وينقل حوالاتِ المقهى عنها.
 *
 * في معاملةٍ واحدة يمرّرها المستدعي: إمّا أن يقع كلُّه أو لا يقع منه شيء.
 */
export async function markPaidByOwner(tx: Tx, invoiceId: string): Promise<OwnerPaidOutcome> {
  const plan = await previewOwnerPaid(tx, invoiceId);
  const { inv } = await loadInvoiceForOwner(tx, invoiceId);

  const freedIds = plan.freed.map((f) => f.paymentId);
  if (freedIds.length > 0) {
    await tx.delete(paymentAllocations).where(and(
      eq(paymentAllocations.invoiceId, invoiceId),
      inArray(paymentAllocations.paymentId, freedIds),
    ));
    for (const id of freedIds) await refreshPaymentStatus(tx, id);
  }

  const ownerPaymentId = await createPayment(tx, {
    supplierId: plan.supplierId,
    paidAt: new Date(inv.invoice_date),
    amountMinor: plan.ownerPaymentMinor,
    method: "OWNER_ACCOUNT",
    appliesToMonth: inv.period_month,
    /* إقرارُ المالك صريحٌ بفاتورةٍ بعينها، ولا يظهر في كشف المقهى */
    acknowledgeTwin: true,
  });
  await allocate(tx, ownerPaymentId, plan.ownerPaymentMinor, [
    { invoiceId, amountMinor: plan.ownerPaymentMinor },
  ]);

  const credit = freedIds.length > 0
    ? await applySupplierCredit(tx, plan.supplierId, { forwardDays: null, paymentIds: freedIds })
    : { appliedMinor: 0, creditLeftMinor: 0, allocations: [] };

  return { ...plan, ownerPaymentId, appliedMinor: credit.appliedMinor };
}

/* ─────────────────── «سُدّدت» وحوالتُها في الكشف ─────────────────── */

/** كم يوماً قبل يوم السداد تُعدّ حوالةُ الكشف غيرُ المنسوبة حوالةَ هذه الفاتورة. */
export const DRAW_LOOKBACK_DAYS = 60;

/**
 * قبل أن يُنشئ «سجّل أنّها سُدّدت» دفعةً بلا حركة، يسأل: أللمورّد حوالةٌ
 * في الكشف لم تُنسب إلى فاتورة؟ فهي — على الأرجح — هذا السداد نفسه.
 *
 * كان يُنشئ دفعةً ثانية، فبقيت الحوالةُ «رصيداً لك» والفاتورةُ الأحدث
 * «مسدَّدة» على الورق (كوهي ٨٣٣٫٧٥ وأطلس ٥٧٥). والتوأمةُ عند الإنشاء
 * تطابق اليوم، والإقرارُ لا يعرف يوم الخصم.
 *
 * ولو لم تكن هي: المجموعُ صحيحٌ في الحالين — مالٌ خرج للمورّد فنُسب، والحوالةُ
 * الجديدة حين تصل الكشفَ تصير رصيداً يُخصم من القادم.
 * يُعيد ما نُسب (للتراجع من الإشعار) وما بقي بلا حوالة.
 */
export async function drawBankCredit(
  tx: Tx,
  input: { supplierId: string; invoiceId: string; remainingMinor: number; paidOn: string },
): Promise<{ drawn: { paymentId: string; invoiceId: string; amountMinor: number; paidOn: string }[]; restMinor: number }> {
  const rows = (
    await tx.execute<{ id: string; amount_minor: number; day: string; available: string | number }>(sql`
      select p.id, p.amount_minor, to_char(p.paid_at, 'YYYY-MM-DD') as day,
             (p.amount_minor - p.fee_minor - coalesce((
               select sum(pa.amount_minor) from payment_allocations pa where pa.payment_id = p.id
             ), 0))::bigint as available
        from payments p
       where p.supplier_id = ${input.supplierId}
         and p.status not in ('REVERSED', 'VOID')
         and exists (select 1 from bank_transactions bt where bt.matched_payment_id = p.id)
         and p.paid_at::date between ${input.paidOn}::date - ${DRAW_LOOKBACK_DAYS} and ${input.paidOn}::date + 3
       order by abs(p.paid_at::date - ${input.paidOn}::date), p.paid_at
       for update of p
    `)
  ).rows;

  let rest = input.remainingMinor;
  const drawn: { paymentId: string; invoiceId: string; amountMinor: number; paidOn: string }[] = [];
  for (const r of rows) {
    if (rest <= SETTLED_TOLERANCE_MINOR) break;
    const available = Number(r.available);
    if (available <= 0) continue;
    const take = Math.min(available, rest);
    const out = await allocate(tx, r.id, Number(r.amount_minor), [{ invoiceId: input.invoiceId, amountMinor: take }]);
    if (out.allocatedMinor <= 0) continue;
    drawn.push({ paymentId: r.id, invoiceId: input.invoiceId, amountMinor: out.allocatedMinor, paidOn: r.day });
    rest -= out.allocatedMinor;
  }
  return { drawn, restMinor: Math.max(0, rest) };
}

/** التراجعُ عمّا نسبه `drawBankCredit` — فكٌّ لا إلغاء: الحوالةُ حقيقيّةٌ وتبقى. */
export async function undrawBankCredit(
  tx: Tx,
  pairs: readonly { paymentId: string; invoiceId: string }[],
): Promise<number> {
  let freed = 0;
  for (const p of pairs) {
    const removed = await tx
      .delete(paymentAllocations)
      .where(and(
        eq(paymentAllocations.paymentId, p.paymentId),
        eq(paymentAllocations.invoiceId, p.invoiceId),
        sql`exists (select 1 from bank_transactions bt where bt.matched_payment_id = ${p.paymentId})`,
      ))
      .returning({ amountMinor: paymentAllocations.amountMinor });
    for (const r of removed) freed += r.amountMinor;
    if (removed.length > 0) await refreshPaymentStatus(tx, p.paymentId);
  }
  return freed;
}
