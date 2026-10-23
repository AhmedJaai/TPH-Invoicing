/**
 * الموظّفون والرواتب — مَن يعمل في الشهر، وكم يستحقّ، وكم حُوِّل له، وكم بقي.
 *
 * المسيّرُ يُحسَب عند كلّ قراءة (`lib/payroll/calc.ts`) من بنوده: الراتبُ النافذ بأيّام الشهر،
 * والخصوماتُ والإضافات، وأيّامُ التأخير والغياب، وأسابيعُ الجزئيّ، والحوالاتُ المربوطة بغرضها.
 * لا «صافي» مكتوب.
 *
 * والحوالةُ تُربط بموظّفٍ **بغرضها** — ليس كلُّ ما حُوِّل للوليد راتباً (بعضُه ليسدّد فاتورة)،
 * وليس كلُّ ما حوّله المالكُ لنفسه شخصيّاً (بعضُه رواتب دفعها منه). والحوالةُ الواحدة تُقسَم.
 * والمبلغُ يُحسب في الخادم من الحوالة، والقاعدةُ ترفض ما يتجاوزها (084).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appSettings, attendanceCheckins, employeeRates, employees, obligations, payrollAdjustments, payrollAttendance, payrollLinks, payrollViolations, payrollWeeks,
  type AttendanceKind, type CheckinVerdict, type PayrollAdjustmentKind, type PayrollLinkPurpose,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { formatRiyalsDisplay } from "@/lib/money";
import {
  activeIn, beneficiaryIdOf, beneficiaryNameOf, hoursPayMinor, loanBalance, PAYS_SALARY, payslip, rateFor, reclassTarget,
  suggestedPayMonth, weekMonth, weekStartOf, workedDays, type Payslip, type ReclassTarget,
} from "@/lib/payroll/calc";
import {
  DEFAULT_RADIUS_M, dayForOut, earlyMinutesAt, isWorkday, judgeCheckin, lateMinutesAt, riyadhDay, type CafePlace,
} from "@/lib/payroll/attendance";
import { addDays, monthEndDay, todayInRiyadh } from "@/lib/riyadh-time";
import { silencedKeys } from "@/lib/signal-decisions";
import {
  damageCapMinor, isViolationCode, loanCapMinor, monthViolations, REPEAT_WINDOW_DAYS, type AssessedViolation,
} from "@/lib/payroll/saudi-rules";
import { pgErrorCode } from "./guard";
import { assertMonthsOpen } from "./month-guard";
import type { Conn } from "./types";

export class PayrollRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollRefused";
  }
}

/* ─────────────────────────── الموظّفون ─────────────────────────── */

export interface EmployeeView {
  id: string;
  name: string;
  kind: "MONTHLY" | "PART_TIME";
  jobTitle: string | null;
  phone: string | null;
  nationalId: string | null;
  bankBeneficiaryId: string | null;
  iban: string | null;
  hiredOn: string;
  leftOn: string | null;
  shiftStart: string | null;
  shiftMinutes: number;
  lateGraceMinutes: number;
  daysOff: string;
  hasCheckinLink: boolean;
  note: string | null;
  rates: { id: string; fromMonth: string; amountMinor: number }[];
}

type EmployeeRow = typeof employees.$inferSelect;

function toView(e: EmployeeRow, rates: readonly (typeof employeeRates.$inferSelect)[]): EmployeeView {
  return {
    id: e.id, name: e.name, kind: e.kind, jobTitle: e.jobTitle, phone: e.phone, nationalId: e.nationalId,
    bankBeneficiaryId: e.bankBeneficiaryId, iban: e.iban, hiredOn: e.hiredOn, leftOn: e.leftOn,
    shiftStart: e.shiftStart, shiftMinutes: e.shiftMinutes, lateGraceMinutes: e.lateGraceMinutes, daysOff: e.daysOff,
    hasCheckinLink: e.checkinTokenHash !== null, note: e.note,
    rates: rates.filter((r) => r.employeeId === e.id).map((r) => ({ id: r.id, fromMonth: r.fromMonth, amountMinor: r.amountMinor })),
  };
}

export async function loadEmployees(conn: Conn = db): Promise<EmployeeView[]> {
  const [rows, rates] = await Promise.all([
    conn.select().from(employees).orderBy(employees.name),
    conn.select().from(employeeRates).orderBy(employeeRates.fromMonth),
  ]);
  return rows.map((e) => toView(e, rates));
}

export async function loadEmployee(id: string, conn: Conn = db): Promise<EmployeeView | null> {
  const [row] = await conn.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!row) return null;
  const rates = await conn.select().from(employeeRates).where(eq(employeeRates.employeeId, id)).orderBy(employeeRates.fromMonth);
  return toView(row, rates);
}

/* ─────────────────────────── المسيّر ─────────────────────────── */

export interface LinkView {
  id: string;
  employeeId: string;
  month: string;
  purpose: PayrollLinkPurpose;
  amountMinor: number;
  txId: string;
  txDay: string;
  txAmountMinor: number;
  /** حوالةٌ إلى المالك نفسه دفع منها. */
  viaOwner: boolean;
  /** باقي الحوالة غيرُ موزَّع. */
  txFreeMinor: number;
  /** صاحبُ الحساب الذي ذهبت إليه الحوالة — يميّز حوالتين بالمبلغ نفسه في اليوم نفسه. */
  txPayee: string | null;
  note: string | null;
}

export interface PayrollRow {
  employee: EmployeeView;
  /** الراتبُ النافذ في الشهر (للجزئيّ أجرُ الساعة). */
  rateMinor: number | null;
  slip: Payslip;
  adjustments: { id: string; kind: PayrollAdjustmentKind; amountMinor: number; note: string | null; createdAt: Date }[];
  attendance: { id: string; day: string; kind: AttendanceKind; minutes: number | null; source: "MANUAL" | "CHECKIN"; note: string | null; disrupted: boolean; penaltyWaived: boolean }[];
  /** مخالفاتُ الشهر بجزائها من جدول اللائحة — من الحضور ومن المسجَّل بيده. */
  violations: (AssessedViolation & { source: "ATTENDANCE" | "MANUAL" })[];
  /** غيابٌ فوق عشرة أيّامٍ متّصلة — المادّة ٨٠، قرارٌ لا مبلغ. */
  article80: { start: string; days: number }[];
  weeks: { id: string; weekStart: string; minutes: number | null; amountMinor: number; note: string | null }[];
  /** كلُّ ما رُبط به في الشهر — راتباً أو غيره. */
  links: LinkView[];
  /** رصيدُ سلفه اليوم — كلُّ الأشهر. */
  loanMinor: number;
}

export interface PayrollMonth {
  month: string;
  rows: PayrollRow[];
}

export async function loadPayrollMonth(month: string, conn: Conn = db): Promise<PayrollMonth> {
  const firstWeek = weekStartOf(`${month}-01`);
  const lastDay = monthEndDay(month);
  /* التكرارُ يُعدّ من ١٨٠ يوماً قبل المخالفة — فيُقرأ ما قبل الشهر بقدرها وفوقه سلسلةٌ أطول */
  const historyFrom = addDays(`${month}-01`, -(REPEAT_WINDOW_DAYS * 2));
  const [list, adj, attAll, weeks, links, loans, manualAll] = await Promise.all([
    loadEmployees(conn),
    conn.select().from(payrollAdjustments).where(and(eq(payrollAdjustments.month, month), isNull(payrollAdjustments.voidedAt))).orderBy(payrollAdjustments.createdAt),
    conn.select().from(payrollAttendance).where(and(gte(payrollAttendance.day, historyFrom), lte(payrollAttendance.day, lastDay), isNull(payrollAttendance.voidedAt))).orderBy(payrollAttendance.day),
    conn.select().from(payrollWeeks).where(and(gte(payrollWeeks.weekStart, firstWeek), lte(payrollWeeks.weekStart, lastDay), isNull(payrollWeeks.voidedAt))).orderBy(payrollWeeks.weekStart),
    loadLinks(conn, sql`pl.month = ${month}`),
    loadLoanBalances(conn),
    conn.select().from(payrollViolations).where(and(gte(payrollViolations.day, historyFrom), lte(payrollViolations.day, lastDay), isNull(payrollViolations.voidedAt))),
  ]);
  const att = attAll.filter((a) => a.day >= `${month}-01`);
  const rows: PayrollRow[] = [];
  for (const employee of list) {
    const mine = <T extends { employeeId: string }>(xs: readonly T[]) => xs.filter((x) => x.employeeId === employee.id);
    const myLinks = mine(links);
    const myAdj = mine(adj);
    /* مَن خرج من الشهر وبقي له فيه مالٌ مربوط أو بند لا يختفي */
    if (!activeIn(employee, month) && myLinks.length === 0 && myAdj.length === 0) continue;
    const myWeeks = mine(weeks).filter((w) => weekMonth(w.weekStart) === month);
    const myAtt = mine(att);
    const rateMinor = rateFor(employee.rates, month);
    const regs = employee.kind === "MONTHLY" && rateMinor !== null
      ? monthViolations({
          month, monthlyMinor: rateMinor, graceMinutes: employee.lateGraceMinutes, daysOff: employee.daysOff,
          history: mine(attAll), manual: mine(manualAll).map((v) => ({ id: v.id, day: v.day, code: v.code, waived: v.waived, note: v.note })),
        })
      : null;
    const manualIds = new Set(manualAll.map((v) => v.id));
    rows.push({
      employee, rateMinor,
      slip: payslip({
        kind: employee.kind,
        salaryMinor: employee.kind === "MONTHLY" ? rateMinor : null,
        days: workedDays(employee, month) ?? { worked: 0, of: 1 },
        weeksMinor: myWeeks.map((w) => w.amountMinor),
        policy: { shiftMinutes: employee.shiftMinutes, graceMinutes: employee.lateGraceMinutes },
        adjustments: myAdj,
        attendance: myAtt,
        penalties: regs?.capped,
        paidMinor: myLinks.filter((l) => PAYS_SALARY.has(l.purpose)).reduce((s, l) => s + l.amountMinor, 0),
      }),
      adjustments: myAdj.map((a) => ({ id: a.id, kind: a.kind, amountMinor: a.amountMinor, note: a.note, createdAt: a.createdAt })),
      attendance: myAtt.map((a) => ({ id: a.id, day: a.day, kind: a.kind, minutes: a.minutes, source: a.source, note: a.note, disrupted: a.disrupted, penaltyWaived: a.penaltyWaived })),
      violations: (regs?.items ?? []).map((v) => ({ ...v, source: manualIds.has(v.id) ? "MANUAL" as const : "ATTENDANCE" as const })),
      article80: regs?.article80 ?? [],
      weeks: myWeeks.map((w) => ({ id: w.id, weekStart: w.weekStart, minutes: w.minutes, amountMinor: w.amountMinor, note: w.note })),
      links: myLinks,
      loanMinor: loans.get(employee.id) ?? 0,
    });
  }
  return { month, rows };
}

async function loadLinks(conn: Conn, where: ReturnType<typeof sql>): Promise<LinkView[]> {
  const { rows } = await conn.execute<{ id: string; employee_id: string; month: string; purpose: string; amount_minor: number; tx_id: string; day: string; tx_amount: number; category: string; used: string; note: string | null; beneficiary: string | null; description: string | null }>(sql`
    select pl.id, pl.employee_id, pl.month, pl.purpose, pl.amount_minor, bt.id as tx_id,
           bt.beneficiary_raw as beneficiary, bt.description,
           to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
           bt.amount_minor as tx_amount, bt.category::text as category, pl.note,
           (select coalesce(sum(x.amount_minor), 0) from payroll_links x where x.bank_transaction_id = bt.id and x.voided_at is null)::bigint as used
      from payroll_links pl join bank_transactions bt on bt.id = pl.bank_transaction_id
     where pl.voided_at is null and ${where}
     order by bt.value_date, pl.created_at
  `);
  return rows.map((r) => ({
    id: r.id, employeeId: r.employee_id, month: r.month, purpose: r.purpose as PayrollLinkPurpose, amountMinor: r.amount_minor,
    txId: r.tx_id, txDay: r.day, txAmountMinor: r.tx_amount, viaOwner: r.category === "PERSONAL",
    txFreeMinor: r.tx_amount - Number(r.used), txPayee: beneficiaryNameOf(r.beneficiary, r.description), note: r.note,
  }));
}

/** رصيدُ سلف كلّ موظّف: حوالاتُ «سلفة بالأقساط» + سلفٌ نقداً − أقساطٌ سُدّدت. */
async function loadLoanBalances(conn: Conn): Promise<Map<string, number>> {
  const { rows } = await conn.execute<{ employee_id: string; links: string; given: string; repaid: string }>(sql`
    select e.id as employee_id,
           coalesce((select sum(amount_minor) from payroll_links where employee_id = e.id and purpose = 'LOAN' and voided_at is null), 0)::bigint as links,
           coalesce((select sum(amount_minor) from payroll_adjustments where employee_id = e.id and kind = 'LOAN_GIVEN' and voided_at is null), 0)::bigint as given,
           coalesce((select sum(amount_minor) from payroll_adjustments where employee_id = e.id and kind = 'LOAN_REPAYMENT' and voided_at is null), 0)::bigint as repaid
      from employees e
  `);
  return new Map(rows.map((r) => [r.employee_id, loanBalance({ loanLinksMinor: Number(r.links), loanGivenMinor: Number(r.given), repaidMinor: Number(r.repaid) })]));
}

/** كلُّ ما رُبط بالموظّف — لصفحته. */
export async function loadEmployeeLinks(employeeId: string, conn: Conn = db): Promise<LinkView[]> {
  return loadLinks(conn, sql`pl.employee_id = ${employeeId}`);
}

/** شهورُ الموظّف: المستحقّ والمحوَّل والباقي لكلّ شهرٍ عمل فيه — لصفحته. */
export async function loadEmployeeHistory(employeeId: string, months: readonly string[]): Promise<{ month: string; slip: Payslip }[]> {
  const sheets = await Promise.all(months.map((m) => loadPayrollMonth(m)));
  return sheets.flatMap((sheet) => {
    const row = sheet.rows.find((r) => r.employee.id === employeeId);
    return row ? [{ month: sheet.month, slip: row.slip }] : [];
  });
}

/* ─────────────────────────── الحوالات ─────────────────────────── */

export interface TransferView {
  id: string;
  day: string;
  amountMinor: number;
  /** ما لم يُوزَّع بعد. */
  freeMinor: number;
  viaOwner: boolean;
  payeeName: string | null;
  beneficiaryId: string | null;
  /** موظّفٌ يُعرف برقم المستفيد — والشهرُ المقترح. */
  suggestion: { employeeId: string; employeeName: string; month: string } | null;
  /** حوالةُ راتبٍ لم تُقيَّد مصروفاً — فلا تظهر في قائمة الدخل. */
  notInPnl: boolean;
}

/**
 * حوالاتُ «راتب» وتحويلاتُ المالك لنفسه التي بقي منها ما لم يُوزَّع — من `since` فما بعد.
 * وحوالةٌ إلى رقمِ مستفيدٍ معروف تأتي باقتراحها.
 */
/** حوالةُ «راتب» قال صاحبُها إنّها ليست لموظّف (سالم باحاج…) — تخرج من القائمة وتُعاد من «ما قرّرته». */
export const notPayrollKey = (txId: string) => `payroll-tx:${txId}`;

export async function loadOpenTransfers(since: string, conn: Conn = db, salarySince = "2000-01-01"): Promise<TransferView[]> {
  const [list, txs, hidden] = await Promise.all([
    conn.select({ id: employees.id, name: employees.name, ben: employees.bankBeneficiaryId }).from(employees),
    conn.execute<{ id: string; day: string; amount_minor: number; linked: string; category: string; beneficiary: string | null; description: string | null; has_expense: boolean }>(sql`
      select bt.id, to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day, bt.amount_minor,
             coalesce((select sum(pl.amount_minor) from payroll_links pl where pl.bank_transaction_id = bt.id and pl.voided_at is null), 0)::bigint as linked,
             bt.category::text as category, bt.beneficiary_raw as beneficiary, bt.description,
             exists (select 1 from expenses e where e.bank_transaction_id = bt.id) as has_expense
        from bank_transactions bt
       where bt.direction = 'DEBIT'
         and ((bt.category = 'PERSONAL' and to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') >= ${since})
           or (bt.category = 'SALARY' and to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') >= ${salarySince}))
       order by bt.value_date desc
    `),
    conn.execute<{ key: string; decision: string }>(sql`select key, decision from alert_resolutions where key like 'payroll-tx:%'`),
  ]);
  const silenced = silencedKeys(hidden.rows, todayInRiyadh());
  const byBen = new Map(list.filter((e) => e.ben).map((e) => [e.ben, e]));
  const out: TransferView[] = [];
  for (const t of txs.rows) {
    const freeMinor = t.amount_minor - Number(t.linked);
    if (freeMinor <= 0 || silenced.has(notPayrollKey(t.id))) continue;
    const beneficiaryId = beneficiaryIdOf(t.description, t.beneficiary);
    const viaOwner = t.category === "PERSONAL";
    /* رسومُ «راتب» بعشرين ريالاً بلا مستفيد ليست حوالةً لأحد */
    if (!viaOwner && !beneficiaryId && !beneficiaryNameOf(t.beneficiary, t.description)) continue;
    const who = beneficiaryId ? byBen.get(beneficiaryId) : undefined;
    out.push({
      id: t.id, day: t.day, amountMinor: t.amount_minor, freeMinor, viaOwner,
      payeeName: beneficiaryNameOf(t.beneficiary, t.description), beneficiaryId,
      suggestion: who ? { employeeId: who.id, employeeName: who.name, month: suggestedPayMonth(t.day) } : null,
      notInPnl: !viaOwner && !t.has_expense,
    });
  }
  return out;
}

export interface BankPayee {
  beneficiaryId: string;
  name: string;
  transfers: number;
  totalMinor: number;
  lastMinor: number;
  firstDay: string;
  lastDay: string;
  /** حوالاتُه مصنّفةٌ «راتب» — أو تحويلٌ للمالك (رقمُ المالك نفسه). */
  viaOwner: boolean;
}

/** مَن حُوِّل له في الكشف («راتب» أو تحويلٌ للمالك) ولم يُسجَّل موظّفاً — يُضاف بضغطة. */
export async function loadBankPayees(conn: Conn = db): Promise<BankPayee[]> {
  const [known, txs] = await Promise.all([
    conn.select({ ben: employees.bankBeneficiaryId }).from(employees),
    conn.execute<{ day: string; amount_minor: number; beneficiary: string | null; description: string | null; category: string }>(sql`
      select to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day, amount_minor, beneficiary_raw as beneficiary, description, category::text as category
        from bank_transactions where direction = 'DEBIT' and category in ('SALARY', 'PERSONAL') order by value_date
    `),
  ]);
  const taken = new Set(known.map((k) => k.ben).filter(Boolean));
  const map = new Map<string, BankPayee>();
  for (const t of txs.rows) {
    const ben = beneficiaryIdOf(t.description, t.beneficiary);
    if (!ben || taken.has(ben)) continue;
    const name = beneficiaryNameOf(t.beneficiary, t.description) ?? ben;
    const p = map.get(ben) ?? { beneficiaryId: ben, name, transfers: 0, totalMinor: 0, lastMinor: 0, firstDay: t.day, lastDay: t.day, viaOwner: true };
    p.transfers++;
    p.totalMinor += t.amount_minor;
    p.lastMinor = t.amount_minor;
    p.lastDay = t.day;
    if (t.category === "SALARY") p.viaOwner = false;
    map.set(ben, p);
  }
  return [...map.values()].sort((a, b) => Number(a.viaOwner) - Number(b.viaOwner) || b.lastDay.localeCompare(a.lastDay));
}

/**
 * أثرُ الربط في قائمة دخل الشهر: ما يُنقل من فئة الحوالة إلى فئة غرضها، أو يُخرج.
 * تحويلاتُ المالك بشهر الحوالة (كما تقرؤها قائمةُ الدخل)، وحوالاتُ «راتب» بشهر مصروفها
 * المقيَّد — وما لم يُقيَّد مصروفاً لا يُنقل منه شيء (ليس في القائمة أصلاً).
 */
export async function payrollReclass(month: string, conn: Conn = db): Promise<{ from: "SALARY" | "PERSONAL"; to: ReclassTarget; purpose: PayrollLinkPurpose; amountMinor: number; transfers: number }[]> {
  const { rows } = await conn.execute<{ category: string; purpose: string; total: string; n: number }>(sql`
    select bt.category::text as category, pl.purpose, sum(pl.amount_minor)::bigint as total, count(distinct bt.id)::int as n
      from payroll_links pl join bank_transactions bt on bt.id = pl.bank_transaction_id
     where pl.voided_at is null and bt.direction = 'DEBIT'
       and ((bt.category = 'PERSONAL' and to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM') = ${month})
         or (bt.category = 'SALARY'
             and exists (select 1 from expenses e where e.bank_transaction_id = bt.id and e.period_month = ${month} and e.category = 'SALARY')
             and not exists (select 1 from finance_declarations d where d.bank_transaction_id = bt.id and d.voided_at is null and d.kind = 'SPREAD')))
     group by 1, 2
  `);
  const out: { from: "SALARY" | "PERSONAL"; to: ReclassTarget; purpose: PayrollLinkPurpose; amountMinor: number; transfers: number }[] = [];
  for (const r of rows) {
    const from = r.category === "PERSONAL" ? "PERSONAL" as const : "SALARY" as const;
    const purpose = r.purpose as PayrollLinkPurpose;
    const to = reclassTarget(from, purpose);
    if (to) out.push({ from, to, purpose, amountMinor: Number(r.total), transfers: r.n });
  }
  return out;
}

/* ─────────────────────────── الكتابة: الموظّف ─────────────────────────── */

export interface EmployeeInput {
  name: string;
  kind: "MONTHLY" | "PART_TIME";
  jobTitle: string | null;
  phone: string | null;
  nationalId: string | null;
  bankBeneficiaryId: string | null;
  iban: string | null;
  hiredOn: string;
  leftOn: string | null;
  shiftStart: string | null;
  shiftMinutes: number;
  lateGraceMinutes: number;
  daysOff: string;
  note: string | null;
}

export async function saveEmployee(id: string | null, input: EmployeeInput, firstRateMinor: number | null, actorId: string): Promise<string> {
  if (input.leftOn && input.leftOn < input.hiredOn) throw new PayrollRefused("يوم الخروج قبل يوم المباشرة.");
  return db.transaction(async (t) => {
    if (input.bankBeneficiaryId) {
      const [other] = await t.select({ id: employees.id, name: employees.name }).from(employees)
        .where(eq(employees.bankBeneficiaryId, input.bankBeneficiaryId)).limit(1);
      if (other && other.id !== id) throw new PayrollRefused(`رقم المستفيد هذا مسجّل للموظف «${other.name}».`);
    }
    if (id) {
      const [before] = await t.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (!before) throw new PayrollRefused("الموظف غير موجود. حدّث الصفحة.");
      await t.update(employees).set({ ...input, updatedAt: new Date() }).where(eq(employees.id, id));
      const { checkinTokenHash: _hidden, ...shown } = before;
      void _hidden;
      await recordAudit({ actorId, action: "EMPLOYEE_SAVED", entityType: "employee", entityId: id, before: shown, after: input }, t);
      return id;
    }
    const [row] = await t.insert(employees).values({ ...input, createdById: actorId }).returning({ id: employees.id });
    if (firstRateMinor !== null) {
      await t.insert(employeeRates).values({ employeeId: row.id, fromMonth: input.hiredOn.slice(0, 7), amountMinor: firstRateMinor, createdById: actorId });
    }
    await recordAudit({ actorId, action: "EMPLOYEE_SAVED", entityType: "employee", entityId: row.id, before: null, after: { ...input, rateMinor: firstRateMinor } }, t);
    return row.id;
  });
}

/**
 * حذفُ موظّفٍ أُضيف خطأً — ما دام لا أثرَ له: لا حوالةٌ وُزّعت عليه، ولا بندٌ، ولا حضور. ومن له أثرٌ
 * لا يُحذف بل يُكتب يومُ خروجه، فيبقى ما دُفع له في سجلّه.
 */
export async function deleteEmployee(id: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const [before] = await t.select().from(employees).where(eq(employees.id, id)).for("update");
    if (!before) return false;
    const { rows } = await t.execute<{ n: number }>(sql`
      select (select count(*) from payroll_links where employee_id = ${id})
           + (select count(*) from payroll_adjustments where employee_id = ${id})
           + (select count(*) from payroll_attendance where employee_id = ${id})
           + (select count(*) from payroll_weeks where employee_id = ${id})
           + (select count(*) from payroll_violations where employee_id = ${id})
           + (select count(*) from attendance_checkins where employee_id = ${id}) as n`);
    if (Number(rows[0]?.n ?? 0) > 0) throw new PayrollRefused("له سجلّ (حوالات أو بنود أو حضور)، فلا يُحذف. اكتب يوم خروجه بدلاً من ذلك.");
    await t.delete(employees).where(eq(employees.id, id));
    const { checkinTokenHash: _hidden, ...shown } = before;
    void _hidden;
    await recordAudit({ actorId, action: "EMPLOYEE_DELETED", entityType: "employee", entityId: id, before: shown, after: null }, t);
    return true;
  });
}

/** «من سبتمبر ٣٥٠٠» — وإن كان للشهر نفسه راتبٌ استُبدل. */
export async function setRate(employeeId: string, fromMonth: string, amountMinor: number, actorId: string): Promise<void> {
  if (!(amountMinor > 0)) throw new PayrollRefused("اكتب الراتب رقماً أكبر من صفر.");
  await db.transaction(async (t) => {
    await assertEmployee(t, employeeId);
    const [before] = await t.select().from(employeeRates).where(and(eq(employeeRates.employeeId, employeeId), eq(employeeRates.fromMonth, fromMonth))).limit(1);
    if (before) await t.update(employeeRates).set({ amountMinor, createdById: actorId }).where(eq(employeeRates.id, before.id));
    else await t.insert(employeeRates).values({ employeeId, fromMonth, amountMinor, createdById: actorId });
    await recordAudit({ actorId, action: "EMPLOYEE_RATE_SET", entityType: "employee", entityId: employeeId, before: before ?? null, after: { fromMonth, amountMinor } }, t);
  });
}

export async function removeRate(rateId: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const gone = await t.delete(employeeRates).where(eq(employeeRates.id, rateId)).returning();
    if (gone.length === 0) return false;
    await recordAudit({ actorId, action: "EMPLOYEE_RATE_REMOVED", entityType: "employee", entityId: gone[0].employeeId, before: gone[0], after: null }, t);
    return true;
  });
}

async function assertEmployee(t: Conn, employeeId: string): Promise<{ id: string; kind: "MONTHLY" | "PART_TIME"; name: string }> {
  const [e] = await t.select({ id: employees.id, kind: employees.kind, name: employees.name }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!e) throw new PayrollRefused("الموظف غير موجود. حدّث الصفحة.");
  return e;
}

/* ─────────────────────────── الكتابة: بنود الشهر ─────────────────────────── */

export async function addAdjustment(input: { employeeId: string; month: string; kind: PayrollAdjustmentKind; amountMinor: number; note: string | null }, actorId: string): Promise<string> {
  if (!(input.amountMinor > 0)) throw new PayrollRefused("اكتب المبلغ رقماً أكبر من صفر.");
  return db.transaction(async (t) => {
    await assertEmployee(t, input.employeeId);
    if (input.kind === "LOAN_REPAYMENT") {
      const balance = (await loadLoanBalances(t)).get(input.employeeId) ?? 0;
      if (input.amountMinor > balance) throw new PayrollRefused(balance > 0 ? "القسط أكبر من رصيد سلفه." : "لا سلفة عليه لتُسدَّد. سجّل السلفة أولاً.");
    }
    /* حدودُ نظام العمل تُفرض عند الكتابة: قسطُ القرض ≤ ١٠٪ من الأجر (م ٩٢)، والتعويضُ ≤ أجر ٥ أيّام في الشهر (م ٩١) */
    if (input.kind === "LOAN_REPAYMENT" || input.kind === "FINE") {
      const rates = await t.select().from(employeeRates).where(eq(employeeRates.employeeId, input.employeeId));
      const wage = rateFor(rates, input.month);
      if (wage === null) throw new PayrollRefused("اكتب راتبه لهذا الشهر أولاً: الحد النظامي يُحسب منه.");
      const [{ total }] = await t.select({ total: sql<string>`coalesce(sum(${payrollAdjustments.amountMinor}), 0)` }).from(payrollAdjustments)
        .where(and(eq(payrollAdjustments.employeeId, input.employeeId), eq(payrollAdjustments.month, input.month), eq(payrollAdjustments.kind, input.kind), isNull(payrollAdjustments.voidedAt)));
      const cap = input.kind === "FINE" ? damageCapMinor(wage) : loanCapMinor(wage);
      const room = cap - Number(total);
      if (input.amountMinor > room) {
        const what = input.kind === "FINE" ? "لا يُحسم لتعويض الضرر في الشهر أكثر من أجر خمسة أيام (نظام العمل، م ٩١)" : "لا يزيد قسط السلفة على ١٠٪ من الراتب (نظام العمل، م ٩٢)";
        throw new PayrollRefused(`${what}: الحد ${formatRiyalsDisplay(cap)} ريال${Number(total) > 0 ? `، وسُجّل منه ${formatRiyalsDisplay(Number(total))}` : ""}. سجّل الباقي في الشهر القادم.`);
      }
    }
    const [row] = await t.insert(payrollAdjustments).values({ ...input, createdById: actorId }).returning({ id: payrollAdjustments.id });
    await recordAudit({ actorId, action: "PAYROLL_ADJUSTMENT_ADDED", entityType: "payroll_adjustment", entityId: row.id, before: null, after: input }, t);
    return row.id;
  });
}

export async function voidAdjustment(id: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const done = await t.update(payrollAdjustments).set({ voidedAt: new Date(), voidedById: actorId })
      .where(and(eq(payrollAdjustments.id, id), isNull(payrollAdjustments.voidedAt))).returning();
    if (done.length === 0) return false;
    /* سلفةٌ سُدّد منها لا تُسحب: يصير رصيدُه سالباً — اسحب الأقساط أوّلاً */
    if (done[0].kind === "LOAN_GIVEN" && ((await loadLoanBalances(t)).get(done[0].employeeId) ?? 0) < 0) {
      throw new PayrollRefused("سُدّد من هذه السلفة أقساط، فسحبها يجعل رصيده سالباً. اسحب الأقساط أولاً.");
    }
    await recordAudit({ actorId, action: "PAYROLL_ADJUSTMENT_VOIDED", entityType: "payroll_adjustment", entityId: id, before: done[0], after: null }, t);
    return true;
  });
}

const MINUTE_KINDS: ReadonlySet<AttendanceKind> = new Set(["LATE", "EARLY"]);

/**
 * يومُ تأخيرٍ أو انصرافٍ مبكّر أو غيابٍ أو إجازة — يستبدل ما سُجّل لليوم نفسه بالنوع نفسه.
 * والغيابُ والإجازةُ لا يجتمعان في يوم، ولا يجتمعان مع تأخير.
 */
export async function setAttendance(input: { employeeId: string; day: string; kind: AttendanceKind; minutes: number | null; note: string | null; disrupted?: boolean }, actorId: string | null, conn?: Conn): Promise<void> {
  const minutes = MINUTE_KINDS.has(input.kind) ? input.minutes : null;
  if (MINUTE_KINDS.has(input.kind) && !(minutes && minutes > 0)) throw new PayrollRefused("اكتب عدد الدقائق.");
  const run = async (t: Conn) => {
    await assertEmployee(t, input.employeeId);
    const clash: AttendanceKind[] = input.kind === "ABSENT" || input.kind === "LEAVE" ? ["LATE", "EARLY", "ABSENT", "LEAVE"] : [input.kind, "ABSENT", "LEAVE"];
    const before = await t.update(payrollAttendance).set({ voidedAt: new Date() })
      .where(and(eq(payrollAttendance.employeeId, input.employeeId), eq(payrollAttendance.day, input.day), inArray(payrollAttendance.kind, clash), isNull(payrollAttendance.voidedAt)))
      .returning();
    const [row] = await t.insert(payrollAttendance).values({ ...input, minutes, disrupted: input.kind === "LATE" && input.disrupted === true, source: "MANUAL", createdById: actorId }).returning({ id: payrollAttendance.id });
    await recordAudit({ actorId, action: "PAYROLL_ATTENDANCE_SET", entityType: "payroll_attendance", entityId: row.id, before: before.length > 0 ? before : null, after: { ...input, minutes } }, t);
  };
  if (conn) await run(conn);
  else await db.transaction(run);
}

export async function clearAttendance(id: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const done = await t.update(payrollAttendance).set({ voidedAt: new Date() })
      .where(and(eq(payrollAttendance.id, id), isNull(payrollAttendance.voidedAt))).returning();
    if (done.length === 0) return false;
    await recordAudit({ actorId, action: "PAYROLL_ATTENDANCE_CLEARED", entityType: "payroll_attendance", entityId: id, before: done[0], after: null }, t);
    return true;
  });
}

/**
 * أسبوعُ الجزئيّ: بالساعات (والأجرُ = الساعات × أجر الساعة النافذ في شهر الأسبوع) أو بمبلغٍ مكتوب.
 * يستبدل ما سُجّل للأسبوع نفسه.
 */
export async function setWeek(input: { employeeId: string; day: string; minutes: number | null; amountMinor: number | null; note: string | null }, actorId: string): Promise<number> {
  const weekStart = weekStartOf(input.day);
  return db.transaction(async (t) => {
    const e = await assertEmployee(t, input.employeeId);
    if (e.kind !== "PART_TIME") throw new PayrollRefused("الأسابيع للموظف الجزئي. الموظف الشهري يُحسب براتبه.");
    let amountMinor = input.amountMinor;
    if (amountMinor === null) {
      if (!input.minutes) throw new PayrollRefused("اكتب الساعات أو المبلغ.");
      const rates = await t.select().from(employeeRates).where(eq(employeeRates.employeeId, input.employeeId));
      const hourly = rateFor(rates, weekMonth(weekStart));
      if (hourly === null) throw new PayrollRefused("لم يُحدَّد أجر الساعة لهذا الموظف بعد. اكتب المبلغ، أو حدّد أجر الساعة من صفحته.");
      amountMinor = hoursPayMinor(input.minutes, hourly);
    }
    if (!(amountMinor > 0)) throw new PayrollRefused("المبلغ يجب أن يكون أكبر من صفر.");
    const before = await t.update(payrollWeeks).set({ voidedAt: new Date() })
      .where(and(eq(payrollWeeks.employeeId, input.employeeId), eq(payrollWeeks.weekStart, weekStart), isNull(payrollWeeks.voidedAt)))
      .returning();
    const [row] = await t.insert(payrollWeeks).values({ employeeId: input.employeeId, weekStart, minutes: input.minutes, amountMinor, note: input.note, createdById: actorId }).returning({ id: payrollWeeks.id });
    await recordAudit({ actorId, action: "PAYROLL_WEEK_SET", entityType: "payroll_week", entityId: row.id, before: before[0] ?? null, after: { weekStart, minutes: input.minutes, amountMinor } }, t);
    return amountMinor;
  });
}

export async function clearWeek(id: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const done = await t.update(payrollWeeks).set({ voidedAt: new Date() })
      .where(and(eq(payrollWeeks.id, id), isNull(payrollWeeks.voidedAt))).returning();
    if (done.length === 0) return false;
    await recordAudit({ actorId, action: "PAYROLL_WEEK_CLEARED", entityType: "payroll_week", entityId: id, before: done[0], after: null }, t);
    return true;
  });
}

/* ─────────────────────────── مخالفاتُ اللائحة ─────────────────────────── */

export async function addViolation(input: { employeeId: string; day: string; code: string; note: string | null }, actorId: string): Promise<string> {
  if (!isViolationCode(input.code) || input.code.startsWith("1/")) throw new PayrollRefused("بندٌ غير معروف. مخالفات المواعيد تُسجَّل من التأخير والغياب.");
  return db.transaction(async (t) => {
    await assertEmployee(t, input.employeeId);
    const [row] = await t.insert(payrollViolations).values({ ...input, createdById: actorId }).returning({ id: payrollViolations.id });
    await recordAudit({ actorId, action: "PAYROLL_VIOLATION_ADDED", entityType: "payroll_violation", entityId: row.id, before: null, after: input }, t);
    return row.id;
  });
}

export async function voidViolation(id: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const done = await t.update(payrollViolations).set({ voidedAt: new Date(), voidedById: actorId })
      .where(and(eq(payrollViolations.id, id), isNull(payrollViolations.voidedAt))).returning();
    if (done.length === 0) return false;
    await recordAudit({ actorId, action: "PAYROLL_VIOLATION_VOIDED", entityType: "payroll_violation", entityId: id, before: done[0], after: null }, t);
    return true;
  });
}

/** العفوُ عن جزاء مخالفةٍ أو سحبُه — من الحضور أو من المسجَّل بيده. أجرُ الوقت يبقى محسوماً. */
export async function setPenaltyWaived(id: string, waived: boolean, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const fromAttendance = await t.update(payrollAttendance).set({ penaltyWaived: waived })
      .where(and(eq(payrollAttendance.id, id), isNull(payrollAttendance.voidedAt))).returning({ id: payrollAttendance.id });
    const fromManual = fromAttendance.length > 0 ? [] : await t.update(payrollViolations).set({ waived })
      .where(and(eq(payrollViolations.id, id), isNull(payrollViolations.voidedAt))).returning({ id: payrollViolations.id });
    if (fromAttendance.length + fromManual.length === 0) return false;
    await recordAudit({ actorId, action: waived ? "PAYROLL_PENALTY_WAIVED" : "PAYROLL_PENALTY_RESTORED", entityType: fromAttendance.length > 0 ? "payroll_attendance" : "payroll_violation", entityId: id, before: { عفو: !waived }, after: { عفو: waived } }, t);
    return true;
  });
}

/* ─────────────────────────── الكتابة: الحوالات ─────────────────────────── */

/**
 * يوزّع حوالةً (أو جزءاً منها) على موظّفٍ بغرضها. المبلغُ إن لم يُكتب = ما بقي من الحوالة
 * غيرَ موزَّع. وشهرُ الحوالة المقفل يردّه الحارسُ هنا والمؤثِّرُ في القاعدة.
 */
export async function linkTransfer(input: { employeeId: string; month: string; purpose: PayrollLinkPurpose; bankTransactionId: string; amountMinor: number | null; note: string | null }, actorId: string): Promise<number> {
  return db.transaction(async (t) => {
    await assertEmployee(t, input.employeeId);
    const [emp] = await t.select({ name: employees.name, bankBeneficiaryId: employees.bankBeneficiaryId }).from(employees).where(eq(employees.id, input.employeeId)).limit(1);
    const tx = (await t.execute<{ amount_minor: number; direction: string; category: string; month: string; linked: string; description: string | null; beneficiary: string | null }>(sql`
      select bt.amount_minor, bt.direction::text as direction, bt.category::text as category,
             bt.description, bt.beneficiary_raw as beneficiary,
             to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM') as month,
             coalesce((select sum(pl.amount_minor) from payroll_links pl where pl.bank_transaction_id = bt.id and pl.voided_at is null), 0)::bigint as linked
        from bank_transactions bt where bt.id = ${input.bankTransactionId}
    `)).rows[0];
    if (!tx || tx.direction !== "DEBIT") throw new PayrollRefused("الحوالة غير موجودة أو ليست خارجة.");
    if (tx.category !== "SALARY" && tx.category !== "PERSONAL") throw new PayrollRefused("صنّف الحركة «راتب» أو «تحويل لحساب المالك» أولاً من «حركة البنك».");
    /*
      حوالةٌ إلى حساب شخصٍ لا تُنسب لغيره: حوالةُ صالح لا تُحسب راتباً للوليد. تحويلُ المالك لنفسه
      وحده يُقسم على من شاء — هو من دفع لهم.
    */
    if (tx.category !== "PERSONAL") {
      const ben = beneficiaryIdOf(tx.description, tx.beneficiary);
      if (ben && emp.bankBeneficiaryId && ben !== emp.bankBeneficiaryId) {
        const [owner] = await t.select({ name: employees.name }).from(employees).where(eq(employees.bankBeneficiaryId, ben)).limit(1);
        throw new PayrollRefused(`هذه الحوالة لحساب ${owner ? `«${owner.name}»` : `«${beneficiaryNameOf(tx.beneficiary, tx.description) ?? ben}»`} لا لحساب ${emp.name}.`);
      }
      if (ben) {
        const [owner] = await t.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.bankBeneficiaryId, ben)).limit(1);
        if (owner && owner.id !== input.employeeId) throw new PayrollRefused(`هذه الحوالة لحساب «${owner.name}» لا لحساب ${emp.name}.`);
      }
    }
    await assertMonthsOpen(t, [tx.month]);
    const free = tx.amount_minor - Number(tx.linked);
    if (free <= 0) throw new PayrollRefused("هذه الحوالة موزّعة كلها من قبل.");
    const amountMinor = input.amountMinor ?? free;
    if (!(amountMinor > 0)) throw new PayrollRefused("اكتب المبلغ رقماً أكبر من صفر.");
    if (amountMinor > free) throw new PayrollRefused("المبلغ أكبر مما بقي من الحوالة غير موزّع.");
    const [row] = await t.insert(payrollLinks).values({ ...input, amountMinor, createdById: actorId }).returning({ id: payrollLinks.id });
    await recordAudit({ actorId, action: "PAYROLL_LINKED", entityType: "payroll_link", entityId: row.id, before: null, after: { ...input, amountMinor } }, t);
    return amountMinor;
  });
}

/**
 * المقترحاتُ كلُّها بضغطة — حوالاتُ «راتب» إلى رقمِ مستفيدٍ معروف، راتباً لشهرها المقترح.
 * الخادمُ يعيد اشتقاقها، ولا يأخذ من المتصفّح إلّا معرّفاتها. وتحويلاتُ المالك لنفسه لا تُربط
 * جملةً: قسمتُها قرارُه.
 */
export async function linkSuggested(txIds: readonly string[], since: string, actorId: string): Promise<{ linked: number; skipped: number }> {
  const open = await loadOpenTransfers(since);
  const byId = new Map(open.map((o) => [o.id, o]));
  let linked = 0, skipped = 0;
  for (const id of txIds) {
    const o = byId.get(id);
    if (!o?.suggestion || o.viaOwner) { skipped++; continue; }
    try {
      await linkTransfer({ employeeId: o.suggestion.employeeId, month: o.suggestion.month, purpose: "SALARY", bankTransactionId: id, amountMinor: null, note: null }, actorId);
      linked++;
    } catch (e) {
      if (e instanceof PayrollRefused) { skipped++; continue; }
      throw e;
    }
  }
  return { linked, skipped };
}

export async function unlinkTransfer(id: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const [link] = await t.select().from(payrollLinks).where(and(eq(payrollLinks.id, id), isNull(payrollLinks.voidedAt))).limit(1);
    if (!link) return false;
    if (link.purpose === "LOAN") {
      const balance = (await loadLoanBalances(t)).get(link.employeeId) ?? 0;
      if (balance - link.amountMinor < 0) throw new PayrollRefused("سُدّد من هذه السلفة أقساط، فإلغاء ربطها يجعل رصيده سالباً. اسحب الأقساط أولاً.");
    }
    const tx = (await t.execute<{ month: string }>(sql`select to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') as month from bank_transactions where id = ${link.bankTransactionId}`)).rows[0];
    await assertMonthsOpen(t, [tx?.month]);
    await t.update(payrollLinks).set({ voidedAt: new Date(), voidedById: actorId }).where(eq(payrollLinks.id, id));
    await recordAudit({ actorId, action: "PAYROLL_UNLINKED", entityType: "payroll_link", entityId: id, before: link, after: null }, t);
    return true;
  });
}

/** أوّلُ يومٍ تُعرض منه الحوالاتُ المفتوحة: أوّلُ الشهر الذي قبل المعروض. */
export function transfersSince(month: string): string {
  return addDays(`${month}-01`, -1).slice(0, 7) + "-01";
}

/* ─────────────────────────── وثائقُ الموظّف ─────────────────────────── */

export async function loadEmployeeDocuments(employeeId: string, conn: Conn = db) {
  return conn.select().from(obligations).where(eq(obligations.employeeId, employeeId)).orderBy(obligations.expiresOn);
}

/* ─────────────────────────── الحضور ─────────────────────────── */

const PLACE_KEY = "attendance.place";
const NETWORK_KEY = "attendance.network";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{24,64}$/;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface AttendanceSettings {
  place: CafePlace | null;
  /** عنوانُ شبكة المقهى العامّ كما رآه الخادم حين ثبّته صاحبُه من الواي فاي. */
  networkIp: string | null;
}

function parsePlace(raw: string | undefined): CafePlace | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const p = v as Record<string, unknown>;
    if (Number.isInteger(p.latMicro) && Number.isInteger(p.lngMicro) && Number.isInteger(p.radiusM)) {
      return { latMicro: p.latMicro as number, lngMicro: p.lngMicro as number, radiusM: p.radiusM as number };
    }
  } catch { /* قيمةٌ تالفة = لم يُضبط */ }
  return null;
}

export async function loadAttendanceSettings(conn: Conn = db): Promise<AttendanceSettings> {
  const rows = await conn.select().from(appSettings).where(inArray(appSettings.key, [PLACE_KEY, NETWORK_KEY]));
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return { place: parsePlace(get(PLACE_KEY)), networkIp: get(NETWORK_KEY) ?? null };
}

async function saveSetting(key: string, value: string | null, actorId: string): Promise<void> {
  await db.transaction(async (t) => {
    const [before] = await t.select().from(appSettings).where(eq(appSettings.key, key)).for("update");
    if (value === null) await t.delete(appSettings).where(eq(appSettings.key, key));
    else await t.insert(appSettings).values({ key, value, updatedById: actorId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedById: actorId, updatedAt: new Date() } });
    await recordAudit({ actorId, action: "ATTENDANCE_SETTINGS_SET", entityType: "setting", entityId: key, before: before?.value ?? null, after: value }, t);
  });
}

export async function saveCafePlace(place: { latMicro: number; lngMicro: number; radiusM: number | null } | null, actorId: string): Promise<void> {
  if (place && (Math.abs(place.latMicro) > 90_000_000 || Math.abs(place.lngMicro) > 180_000_000)) throw new PayrollRefused("الإحداثيات غير صحيحة.");
  const radiusM = place?.radiusM ?? DEFAULT_RADIUS_M;
  if (place && (radiusM < 30 || radiusM > 1000)) throw new PayrollRefused("نصف القطر بين ٣٠ و١٠٠٠ متر.");
  await saveSetting(PLACE_KEY, place ? JSON.stringify({ latMicro: place.latMicro, lngMicro: place.lngMicro, radiusM }) : null, actorId);
}

export async function saveCafeNetwork(ip: string | null, actorId: string): Promise<void> {
  await saveSetting(NETWORK_KEY, ip, actorId);
}

/** رابطُ حضورٍ جديد — يُرجع الرمزَ مرّةً واحدة ويُلغي ما قبله. */
export async function issueCheckinLink(employeeId: string, actorId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.transaction(async (t) => {
    await assertEmployee(t, employeeId);
    await t.update(employees).set({ checkinTokenHash: hashToken(token), updatedAt: new Date() }).where(eq(employees.id, employeeId));
    await recordAudit({ actorId, action: "EMPLOYEE_CHECKIN_LINK_ISSUED", entityType: "employee", entityId: employeeId, before: null, after: { رابط: "جديد" } }, t);
  });
  return token;
}

export async function revokeCheckinLink(employeeId: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const done = await t.update(employees).set({ checkinTokenHash: null, updatedAt: new Date() })
      .where(and(eq(employees.id, employeeId), sql`${employees.checkinTokenHash} is not null`)).returning({ id: employees.id });
    if (done.length === 0) return false;
    await recordAudit({ actorId, action: "EMPLOYEE_CHECKIN_LINK_REVOKED", entityType: "employee", entityId: employeeId, before: { رابط: "قائم" }, after: null }, t);
    return true;
  });
}

export interface CheckinEmployee {
  id: string;
  name: string;
  shiftStart: string | null;
  shiftMinutes: number;
}

/** الموظّفُ لهذا الرمز — ما دام لم يخرج ورابطُه لم يُلغَ. */
export async function resolveCheckinToken(token: string | null | undefined): Promise<CheckinEmployee | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const [row] = await db.select().from(employees).where(eq(employees.checkinTokenHash, hashToken(token))).limit(1);
  if (!row) return null;
  if (row.leftOn && row.leftOn < riyadhDay(new Date())) return null;
  return { id: row.id, name: row.name, shiftStart: row.shiftStart, shiftMinutes: row.shiftMinutes };
}

export interface CheckinView {
  id: string;
  employeeId: string;
  kind: "IN" | "OUT";
  at: Date;
  day: string;
  verdict: CheckinVerdict;
  distanceM: number | null;
  accuracyM: number | null;
  review: "ACCEPTED" | "REJECTED" | null;
}

export async function recentCheckins(employeeId: string, limit = 6): Promise<CheckinView[]> {
  const rows = await db.select().from(attendanceCheckins).where(eq(attendanceCheckins.employeeId, employeeId)).orderBy(desc(attendanceCheckins.at)).limit(limit);
  return rows.map(toCheckinView);
}

function toCheckinView(r: typeof attendanceCheckins.$inferSelect): CheckinView {
  return { id: r.id, employeeId: r.employeeId, kind: r.kind, at: r.at, day: r.day, verdict: r.verdict, distanceM: r.distanceM, accuracyM: r.accuracyM, review: r.review };
}

export async function loadCheckins(fromDay: string, toDay: string, conn: Conn = db): Promise<CheckinView[]> {
  const rows = await conn.select().from(attendanceCheckins)
    .where(and(gte(attendanceCheckins.day, fromDay), lte(attendanceCheckins.day, toDay)))
    .orderBy(attendanceCheckins.at);
  return rows.map(toCheckinView);
}

/** تسجيلاتٌ بلا شاهدٍ (بعيدة أو بلا موقع) لم يُبَتّ فيها. */
export async function loadUnreviewedCheckins(conn: Conn = db): Promise<CheckinView[]> {
  const rows = await conn.select().from(attendanceCheckins)
    .where(and(inArray(attendanceCheckins.verdict, ["FAR", "NO_LOCATION"]), isNull(attendanceCheckins.review)))
    .orderBy(desc(attendanceCheckins.at)).limit(200);
  return rows.map(toCheckinView);
}

/** ضغطتان متتاليتان على الزرّ نفسه في هذه المدّة تسجيلٌ واحد. */
const DOUBLE_TAP_MS = 2 * 60 * 1000;

/**
 * تسجيلُ حضورٍ أو انصراف من رابط الموظّف. يُحفظ دائماً ويُحكم عليه، ثمّ يُحسب منه التأخيرُ
 * (أوّلُ حضورٍ في اليوم) أو الانصرافُ المبكّر (آخرُ انصراف) — ما لم يكتب صاحبُ المقهى اليومَ بيده.
 */
export async function recordCheckin(input: {
  employee: CheckinEmployee;
  kind: "IN" | "OUT";
  position: { latMicro: number; lngMicro: number; accuracyM: number | null } | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ id: string; at: Date; day: string; verdict: CheckinVerdict; lateMinutes: number; earlyMinutes: number; duplicate: boolean }> {
  const settings = await loadAttendanceSettings();
  const now = new Date();
  return db.transaction(async (t) => {
    /* قفلُ الموظّف: ضغطتان متزامنتان لا تكتبان تسجيلين */
    const [emp] = await t.select().from(employees).where(eq(employees.id, input.employee.id)).for("update");
    if (!emp) throw new PayrollRefused("الرابط لم يعد يعمل.");
    const [last] = await t.select().from(attendanceCheckins).where(eq(attendanceCheckins.employeeId, emp.id)).orderBy(desc(attendanceCheckins.at)).limit(1);
    if (last && last.kind === input.kind && now.getTime() - last.at.getTime() < DOUBLE_TAP_MS) {
      return { id: last.id, at: last.at, day: last.day, verdict: last.verdict, lateMinutes: 0, earlyMinutes: 0, duplicate: true };
    }
    let day = riyadhDay(now);
    if (input.kind === "OUT") {
      const [lastIn] = await t.select({ at: attendanceCheckins.at, day: attendanceCheckins.day }).from(attendanceCheckins)
        .where(and(eq(attendanceCheckins.employeeId, emp.id), eq(attendanceCheckins.kind, "IN"))).orderBy(desc(attendanceCheckins.at)).limit(1);
      day = dayForOut(now, lastIn ?? null);
    }
    const onNetwork = settings.networkIp !== null && input.ip !== null && input.ip === settings.networkIp;
    const { verdict, distanceM } = judgeCheckin({ place: settings.place, position: input.position, onNetwork });
    const [row] = await t.insert(attendanceCheckins).values({
      employeeId: emp.id, kind: input.kind, at: now, day,
      latMicro: input.position?.latMicro ?? null, lngMicro: input.position?.lngMicro ?? null, accuracyM: input.position?.accuracyM ?? null,
      distanceM, ip: input.ip, verdict, userAgent: input.userAgent?.slice(0, 300) ?? null,
    }).returning({ id: attendanceCheckins.id });

    let lateMinutes = 0, earlyMinutes = 0;
    if (emp.shiftStart && isWorkday(day, emp.daysOff) && emp.kind === "MONTHLY") {
      const manual = await t.select({ kind: payrollAttendance.kind }).from(payrollAttendance)
        .where(and(eq(payrollAttendance.employeeId, emp.id), eq(payrollAttendance.day, day), eq(payrollAttendance.source, "MANUAL"), isNull(payrollAttendance.voidedAt)));
      const manualKinds = new Set(manual.map((m) => m.kind));
      const handled = manualKinds.has("ABSENT") || manualKinds.has("LEAVE");
      if (input.kind === "IN") {
        const [earlier] = await t.select({ id: attendanceCheckins.id }).from(attendanceCheckins)
          .where(and(eq(attendanceCheckins.employeeId, emp.id), eq(attendanceCheckins.day, day), eq(attendanceCheckins.kind, "IN"), sql`${attendanceCheckins.id} <> ${row.id}`)).limit(1);
        lateMinutes = lateMinutesAt(now, day, emp.shiftStart);
        if (!earlier && !handled && !manualKinds.has("LATE") && lateMinutes > 0) {
          await writeDerived(t, emp.id, day, "LATE", lateMinutes);
        }
      } else {
        earlyMinutes = earlyMinutesAt(now, day, emp.shiftStart, emp.shiftMinutes);
        if (!handled && !manualKinds.has("EARLY")) {
          await t.update(payrollAttendance).set({ voidedAt: now })
            .where(and(eq(payrollAttendance.employeeId, emp.id), eq(payrollAttendance.day, day), eq(payrollAttendance.kind, "EARLY"), eq(payrollAttendance.source, "CHECKIN"), isNull(payrollAttendance.voidedAt)));
          if (earlyMinutes > 0) await writeDerived(t, emp.id, day, "EARLY", earlyMinutes);
        }
      }
    }
    return { id: row.id, at: now, day, verdict, lateMinutes, earlyMinutes, duplicate: false };
  });
}

async function writeDerived(t: Conn, employeeId: string, day: string, kind: "LATE" | "EARLY", minutes: number): Promise<void> {
  await t.update(payrollAttendance).set({ voidedAt: new Date() })
    .where(and(eq(payrollAttendance.employeeId, employeeId), eq(payrollAttendance.day, day), eq(payrollAttendance.kind, kind), eq(payrollAttendance.source, "CHECKIN"), isNull(payrollAttendance.voidedAt)));
  await t.insert(payrollAttendance).values({ employeeId, day, kind, minutes: Math.min(960, minutes), source: "CHECKIN", note: "من تسجيل الحضور" });
}

/**
 * قبولُ تسجيلٍ مشكوك أو ردُّه. المردودُ لا يُحسب في ساعات الجزئيّ، ويسقط ما حُسب منه (تأخيرٌ من حضورٍ
 * مردود، أو انصرافٌ مبكّر من انصرافٍ مردود) ما لم يبقَ في اليوم تسجيلٌ آخر من نوعه. و`manipulation`:
 * ردٌّ مع مخالفة «التلاعب في إثبات الحضور والانصراف» (البند ٢/٧).
 */
export async function reviewCheckin(id: string, decision: "ACCEPTED" | "REJECTED", actorId: string, manipulation = false): Promise<boolean> {
  return db.transaction(async (t) => {
    const done = await t.update(attendanceCheckins).set({ review: decision, reviewedById: actorId, reviewedAt: new Date() })
      .where(eq(attendanceCheckins.id, id)).returning({ employeeId: attendanceCheckins.employeeId, at: attendanceCheckins.at, verdict: attendanceCheckins.verdict, kind: attendanceCheckins.kind, day: attendanceCheckins.day });
    if (done.length === 0) return false;
    const c = done[0];
    if (decision === "REJECTED") {
      const [other] = await t.select({ id: attendanceCheckins.id }).from(attendanceCheckins)
        .where(and(eq(attendanceCheckins.employeeId, c.employeeId), eq(attendanceCheckins.day, c.day), eq(attendanceCheckins.kind, c.kind),
          sql`${attendanceCheckins.id} <> ${id}`, sql`coalesce(${attendanceCheckins.review}, '') <> 'REJECTED'`)).limit(1);
      if (!other) {
        await t.update(payrollAttendance).set({ voidedAt: new Date() })
          .where(and(eq(payrollAttendance.employeeId, c.employeeId), eq(payrollAttendance.day, c.day), eq(payrollAttendance.kind, c.kind === "IN" ? "LATE" : "EARLY"),
            eq(payrollAttendance.source, "CHECKIN"), isNull(payrollAttendance.voidedAt)));
      }
      if (manipulation) {
        const [v] = await t.insert(payrollViolations).values({ employeeId: c.employeeId, day: c.day, code: "2/7", note: "تسجيل حضور من خارج المقهى ردّه صاحب العمل", createdById: actorId }).returning({ id: payrollViolations.id });
        await recordAudit({ actorId, action: "PAYROLL_VIOLATION_ADDED", entityType: "payroll_violation", entityId: v.id, before: null, after: { code: "2/7", day: c.day } }, t);
      }
    }
    await recordAudit({ actorId, action: "ATTENDANCE_CHECKIN_REVIEWED", entityType: "attendance_checkin", entityId: id, before: { verdict: c.verdict }, after: { decision, manipulation } }, t);
    return true;
  });
}

/* ─────────────────────────── ما يحتاج قرارك ─────────────────────────── */

export interface PayrollAttentionFacts {
  /** حوالاتُ «راتب» إلى مستفيدٍ لم تُوزَّع — آخرُ ستّين يوماً. */
  unlinkedSalary: { count: number; amountMinor: number };
  /** تسجيلاتُ حضورٍ بلا شاهد لم يُبَتّ فيها. */
  unreviewedCheckins: number;
  /** موظّفون يعملون هذا الشهر بلا راتبٍ مكتوب. */
  missingRates: string[];
  /**
   * رواتبُ لم تُحوَّل كاملة: الشهرُ الماضي من أوّل الشهر، والجاري من يوم ٢٥ — موعدُ الرواتب.
   * `null`: لا شيء باقٍ.
   */
  owed: { month: string; remainingMinor: number; people: number } | null;
}

export async function loadPayrollAttentionFacts(today: string, conn: Conn = db): Promise<PayrollAttentionFacts> {
  try {
    const month = today.slice(0, 7);
    const [open, unreviewed, list] = await Promise.all([
      loadOpenTransfers(addDays(today, -60), conn, addDays(today, -60)),
      conn.execute<{ n: number }>(sql`select count(*)::int as n from attendance_checkins where verdict in ('FAR', 'NO_LOCATION') and review is null`),
      loadEmployees(conn),
    ]);
    const salary = open.filter((o) => !o.viaOwner);
    /* من يوم ٢٥ يُسأل عن رواتب الشهر الجاري، وقبله عن الماضي */
    const owedMonth = Number(today.slice(8, 10)) >= 25 ? month : addDays(`${month}-01`, -1).slice(0, 7);
    let owed: PayrollAttentionFacts["owed"] = null;
    if (list.some((e) => activeIn(e, owedMonth))) {
      const sheet = await loadPayrollMonth(owedMonth, conn);
      const left = sheet.rows.filter((r) => (r.slip.remainingMinor ?? 0) > 0);
      const remainingMinor = left.reduce((s, r) => s + (r.slip.remainingMinor ?? 0), 0);
      if (remainingMinor > 0) owed = { month: owedMonth, remainingMinor, people: left.length };
    }
    return {
      unlinkedSalary: { count: salary.length, amountMinor: salary.reduce((s, o) => s + o.freeMinor, 0) },
      unreviewedCheckins: unreviewed.rows[0]?.n ?? 0,
      missingRates: list.filter((e) => activeIn(e, month) && rateFor(e.rates, month) === null).map((e) => e.name),
      owed,
    };
  } catch (e) {
    /* جدولٌ لم تُطبَّق هجرتُه بعد لا يُسقط «يحتاج قرارك» */
    if (pgErrorCode(e) === "42P01") {
      return { unlinkedSalary: { count: 0, amountMinor: 0 }, unreviewedCheckins: 0, missingRates: [], owed: null };
    }
    throw e;
  }
}
