/**
 * النقد القادم من القاعدة — الدفعتان من `payment-run.service`، والمتكرّرُ من
 * `recurring_expenses`، والرصيدُ من آخر فترة تسويةٍ معروفة. والبناءُ في
 * `lib/cash-outlook.ts` الخالصة.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { expenses, recurringExpenses } from "@/db/schema";
import {
  asCadence, buildCashOutlook, withoutPayrollDuplicates, dueThisWeek, floorBreach, type CashOutlook, type FloorBreach, type PayrollDue, type RecurringInput, type SupplierDue, type VatDue, type WeekDue,
} from "@/lib/cash-outlook";
import { addMonths } from "@/lib/filing";
import { payrollTotals, suggestedPayMonth } from "@/lib/payroll/calc";
import { loadOpenTransfers, loadPayrollMonths, transfersSince } from "./payroll.service";
import { previousMonth } from "@/lib/filing";
import { buildPaymentRun, type PaymentRun } from "@/lib/payment-run";
import { currentMonthRiyadh, todayInRiyadh } from "@/lib/riyadh-time";
import { loadCashPosition } from "./briefing.service";
import { loadHoldOverrides } from "./payment-hold.service";
import { loadPayableInvoices } from "./payment-run.service";
import { loadSupplierBalances } from "./supplier-balance.service";
import { filingDeadline, periodKey, previousQuarter, quarterLabel, quarterOfMonth, type VatQuarter } from "@/lib/vat-return";
import { loadVatReturn } from "./vat-return.service";
import { loadCashFloor } from "./app-settings.service";
import { buildCommitments, type Commitments } from "@/lib/commitments";
import { OBLIGATION_KIND_LABEL } from "@/lib/obligations";
import { loadObligations } from "./obligation.service";
import { pgErrorCode } from "./guard";

function dues(run: PaymentRun): SupplierDue[] {
  return run.ready.map((s) => ({ supplierId: s.supplierId, supplierName: s.supplierName, amountMinor: s.totalMinor }));
}

/** المصروفاتُ المتكرّرة الفاعلة بصيغة الإسقاط — للنقد القادم ولـ«هذا الأسبوع» في الإحاطة. */
export async function loadRecurringInputs(): Promise<RecurringInput[]> {
  const rows = await db.select().from(recurringExpenses).where(eq(recurringExpenses.isActive, true));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    amountMinor: r.amountMinor,
    cadence: asCadence(r.cadence),
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    category: r.category,
  }));
}

/**
 * ما يخرج في الأيّام السبعة القادمة — من دفعة الشهر المنقضي والمتكرّرِ
 * الفاعل، وكلاهما يطلبه المتّصلُ مع غيره معاً (الإحاطةُ تحمل الدفعةَ سلفاً)،
 * فلا يُنتظَر استعلامٌ بعد استعلام.
 */
export function weekDue(run: PaymentRun, recurring: readonly RecurringInput[], payroll: readonly PayrollDue[] = []): WeekDue {
  return dueThisWeek({ today: todayInRiyadh(), overdueRun: dues(run), recurring: withoutPayrollDuplicates(recurring, payroll), payroll });
}

/**
 * ما بقي من الرواتب في المسيّر — من المصدر نفسه الذي يقرؤه `/payroll` (`loadPayrollMonths`).
 * الأشهرُ المطلوبة وحدها؛ ومن لا راتبَ مكتوبٌ له يُعَدّ ولا يُحسب. وجدولٌ لم تُطبَّق هجرتُه
 * أو قراءةٌ تعذّرت: لا رواتبَ في الإسقاط (كما كان) — لا صفرٌ مكتوب.
 */
export async function loadPayrollDues(months: readonly string[]): Promise<PayrollDue[]> {
  try {
    const first = [...months].sort()[0];
    const [sheets, open] = await Promise.all([loadPayrollMonths(months), loadOpenTransfers(transfersSince(first))]);
    /*
      حوالةُ «راتب» في الكشف لم توزَّع بعد خرجت من الرصيد فعلاً — فتُخصم من باقي شهرها
      المقترح، وإلّا طُرحت مرّتين: كانت «رواتب سبتمبر ١٩٬١٣٤ متأخّرة» وحوالاتُها في الكشف
      يوم ٢٧ سبتمبر تنتظر التوزيع. والشهرُ من اقتراح المسيّر نفسه (`suggestedPayMonth`).
    */
    const undistributed = new Map<string, number>();
    for (const o of open) {
      if (o.viaOwner || o.freeMinor <= 0) continue;
      const m = o.suggestion?.month ?? suggestedPayMonth(o.day);
      undistributed.set(m, (undistributed.get(m) ?? 0) + o.freeMinor);
    }
    return sheets.map((sh) => {
      const slips = sh.rows.map((r) => r.slip);
      const t = payrollTotals(slips);
      const sent = Math.min(t.remainingMinor, undistributed.get(sh.month) ?? 0);
      return {
        month: sh.month,
        amountMinor: t.remainingMinor - sent,
        people: slips.filter((x) => (x.remainingMinor ?? 0) > 0).length,
        unknownPeople: t.unknown,
        undistributedMinor: sent,
      };
    });
  } catch {
    return [];
  }
}

/**
 * مستحقُّ الضريبة لربعٍ من حساب الإقرار نفسه (`loadVatReturn`) — لا حسابٌ ثانٍ.
 * `null`: الربعُ المنقضي قُدِّم (لا خروجَ ينتظر)، أو لا حركةَ فيه ولا فاتورة.
 * والمبلغُ `null` حين يغيب كشفُ شهرٍ انقضى من الربع: الناقصُ لا يُكتب رقماً.
 */
async function vatDueFor(quarter: VatQuarter, accruing: boolean): Promise<VatDue | null> {
  const view = await loadVatReturn(quarter);
  if (view.filing) return null;
  if (view.txs.length === 0 && view.invoices.length === 0) return null;
  const blind = view.coverage.some((c) => !c.open && c.gapDays === null);
  return {
    periodKey: periodKey(quarter),
    label: quarterLabel(quarter),
    deadline: filingDeadline(quarter),
    amountMinor: blind ? null : view.result.netMinor,
    accruing,
  };
}

/** الربعُ المنقضي إن لم يُقدَّم، والربعُ الجاري «حتى اليوم». */
export async function loadVatDues(): Promise<VatDue[]> {
  const current = quarterOfMonth(currentMonthRiyadh());
  const [previous, running] = await Promise.all([vatDueFor(previousQuarter(current), false), vatDueFor(current, true)]);
  return [previous, running].flatMap((v) => (v ? [v] : []));
}

/** وقائعُ الإسقاط كما حُمّلت — يبني منها تقويمُ الالتزامات يوماً بيوم، بلا تحميلٍ ثانٍ. */
export interface OutlookInputs {
  overdueRun: SupplierDue[];
  nextRun: SupplierDue[];
  recurring: RecurringInput[];
  paidThisMonth: Set<string>;
  vat: VatDue[];
  payroll: PayrollDue[];
  payrollHref: boolean;
}

/**
 * `withVat: false` يعرض الإسقاطَ كما كان قبل أن تدخله الضريبة — زرٌّ في الصفحة،
 * كي يرى صاحبُها الرقمين ويعرف من أين الفرق.
 */
export async function loadCashOutlook(opts: { withVat?: boolean; canSeePayroll?: boolean } = {}): Promise<CashOutlook & { runMonth: string; thisMonth: string; vatOff: VatDue[]; floorMinor: number | null; breach: FloorBreach | null; inputs: OutlookInputs }> {
  const withVat = opts.withVat ?? true;
  const thisMonth = currentMonthRiyadh();
  const runMonth = previousMonth(thisMonth);

  /*
    الدفعتان من استعلامٍ واحد: صفوفُ الشهر الجاري تحوي صفوفَ ما قبله، والبناءُ
    يعيد فحصَ الشهر — فلا رحلتان إلى القاعدة بعد انتهاء ما فوقهما.
  */
  const [balances, recurring, cash, paid, payable, overrides, vat, floorMinor, payroll] = await Promise.all([
    loadSupplierBalances(),
    loadRecurringInputs(),
    loadCashPosition(),
    /* ما قُيِّد من مصروفٍ هذا الشهر مربوطاً بمتوقَّعه — دُفع، فلا يُسقَط ثانيةً */
    db.select({ id: expenses.recurringExpenseId })
      .from(expenses)
      .where(and(eq(expenses.periodMonth, thisMonth), isNotNull(expenses.recurringExpenseId))),
    loadPayableInvoices(thisMonth),
    loadHoldOverrides(),
    loadVatDues(),
    loadCashFloor(),
    loadPayrollDues([runMonth, thisMonth, addMonths(thisMonth, 1)]),
  ]);
  const credit = new Map(balances.map((b) => [b.supplierId, b.creditMinor]));
  const overdue = buildPaymentRun(payable, runMonth, { includeOlderUnpaid: true, creditBySupplier: credit, overrides });
  /* ما خصمته الدفعةُ الأولى من رصيدنا لا يُخصم ثانيةً من الثانية */
  const left = new Map(credit);
  for (const s of [...overdue.ready, ...overdue.coveredByCredit]) {
    left.set(s.supplierId, Math.max(0, (left.get(s.supplierId) ?? 0) - s.creditAppliedMinor));
  }
  const next = buildPaymentRun(payable, thisMonth, { includeOlderUnpaid: false, creditBySupplier: left, overrides });

  const paidThisMonth = new Set(paid.flatMap((p) => (p.id ? [p.id] : [])));
  const outlook = buildCashOutlook({
    today: todayInRiyadh(),
    runMonth,
    overdueRun: dues(overdue),
    heldMinor: overdue.heldTotalMinor,
    nextRun: dues(next),
    recurring: withoutPayrollDuplicates(recurring, payroll),
    paidThisMonth,
    balanceMinor: cash.balanceMinor,
    balanceAsOf: cash.asOf,
    vat: withVat ? vat : [],
    payroll,
  });
  /* الرواتبُ للمالك وحده (`payroll.md`): لغيره سطرٌ مجموع بلا رابطٍ إلى المسيّر */
  if (!opts.canSeePayroll) for (const b of outlook.buckets) for (const l of b.lines) if (l.kind === "PAYROLL") delete l.href;
  /* ما أُخرج بطلب صاحبه يُسمّى — فلا يُظنّ أنّ الضريبةَ صفر */
  return {
    ...outlook, runMonth, thisMonth, vatOff: withVat ? [] : vat, floorMinor, breach: floorBreach(outlook.buckets, floorMinor),
    inputs: { overdueRun: dues(overdue), nextRun: dues(next), recurring, paidThisMonth, vat, payroll, payrollHref: opts.canSeePayroll ?? false },
  };
}

/** كم شهراً يعرض التقويم — الجاري والقادم (أفقُ «النقد القادم» نفسُه) وشهرٌ بعدهما للوثائق والضريبة. */
export const COMMITMENT_MONTHS = 3;

/**
 * تقويمُ الالتزامات — من وقائع «النقد القادم» نفسها ووثائقِ الانتهاء.
 * وجدولُ الوثائق إن لم تُطبَّق هجرتُه بعد (`42P01`) يُقرأ «لا وثائق».
 */
export async function loadCommitments(opts: { canSeePayroll?: boolean } = {}): Promise<Commitments & { fromMonth: string; hasObligations: boolean }> {
  const [outlook, docs] = await Promise.all([
    loadCashOutlook({ canSeePayroll: opts.canSeePayroll }),
    loadObligations().then((v) => v.open).catch((e: unknown) => {
      if (pgErrorCode(e) === "42P01") return [];
      throw e;
    }),
  ]);
  const built = buildCommitments({
    today: todayInRiyadh(),
    fromMonth: outlook.thisMonth,
    months: COMMITMENT_MONTHS,
    ...outlook.inputs,
    expiries: docs.map((o) => ({ id: o.id, title: o.title, kindLabel: OBLIGATION_KIND_LABEL[o.kind], expiresOn: o.expiresOn })),
  });
  return { ...built, fromMonth: outlook.thisMonth, hasObligations: docs.length > 0 };
}
