/**
 * مسيّرُ الرواتب — حسابُ الشهر لكلّ موظّف، وحاسبةُ التأخير والغياب.
 *
 *   الراتب (أو أجرُ الأسابيع للجزئيّ) + الإضافات − الخصومات = المستحقّ
 *   المستحقّ − السلف نقداً − ما رُبط من حوالات = الباقي للتحويل
 *
 * القاعدة: **الراتبُ المجهول ليس صفراً**. موظّفٌ لم يُكتب راتبُه لشهرٍ فمستحقُّه «غير معروف»
 * ولا يدخل مجموعاً يُقال إنّه كامل.
 *
 * أجرُ الوقت غير المعمول: الدقيقة = الراتب ÷ (٣٠ يوماً × دقائق الدوام)، واليومُ = الراتب ÷ ٣٠،
 * والقسمةُ في الآخر مرّةً واحدة. والسماحُ عتبة: تأخيرٌ في حدوده لا يُحسب، وما فوقه يُحسب كلُّه.
 * وجزاءاتُ المخالفات فوق ذلك من لائحة تنظيم العمل (`saudi-rules.ts`).
 *
 * نقيّ: المالُ هللاتٌ صحيحة، والوقتُ دقائقُ صحيحة.
 */
import type { AttendanceKind, PayrollAdjustmentKind, PayrollLinkPurpose } from "@/db/schema";
import { isoDay } from "@/lib/riyadh-time";

export const DAYS_PER_MONTH = 30;

export const ADJUSTMENT_LABEL: Record<PayrollAdjustmentKind, string> = {
  DEDUCTION: "خصم بموافقته الخطية",
  FINE: "تعويض ضرر أو مخالفة بلدية بخطئه",
  ADVANCE: "سلفة نقداً على راتب الشهر",
  LOAN_REPAYMENT: "قسط سلفة",
  BONUS: "مكافأة",
  OVERTIME: "عمل إضافي",
  ALLOWANCE: "بدل",
  LOAN_GIVEN: "سلفة نقداً تُسدَّد على أشهر",
  PAID_OUTSIDE: "دُفع له خارج الكشف",
};

export const ADJUSTMENT_HINT: Record<PayrollAdjustmentKind, string> = {
  DEDUCTION: "نظام العمل (م ٩٢) لا يجيز الحسم لحقٍّ خاص إلا بموافقة العامل الخطية. والجزاءات التأديبية تُسجَّل من «مخالفة من اللائحة»",
  FINE: "ما أتلفه أو مخالفة بلدية وقعت على المقهى بخطئه. لا يزيد ما يُحسم لها على أجر خمسة أيام في الشهر (م ٩١)",
  ADVANCE: "أخذه مقدماً نقداً من راتب هذا الشهر. إن حوّلته بالبنك فاربط الحوالة بغرض «سلفة على الراتب» بدلاً منه",
  LOAN_REPAYMENT: "قسطٌ يُخصم من راتب الشهر سداداً لسلفة سابقة، ولا يزيد على ١٠٪ من الراتب (م ٩٢)",
  BONUS: "مبلغٌ يُضاف فوق الراتب",
  OVERTIME: "ساعاتٌ زائدة على الدوام",
  ALLOWANCE: "بدل سكن أو مواصلات أو غيره",
  LOAN_GIVEN: "سلفة أعطيته إياها نقداً ويسددها أقساطاً. لا تنقص راتب هذا الشهر، وتدخل رصيد سلفه",
  PAID_OUTSIDE: "راتب دفعته نقداً أو من حسابك ولا حوالة له في كشف البنك. يُحسب مما دُفع له، ولا يظهر في قائمة الدخل لأن مصدره غير معروف. إن عرفت الحوالة فوزّعها بدلاً منه",
};

export const ADDITIONS: ReadonlySet<PayrollAdjustmentKind> = new Set(["BONUS", "OVERTIME", "ALLOWANCE"]);
export const DEDUCTIONS: ReadonlySet<PayrollAdjustmentKind> = new Set(["DEDUCTION", "FINE", "LOAN_REPAYMENT"]);
export const ADJUSTMENT_KINDS: readonly PayrollAdjustmentKind[] = ["DEDUCTION", "FINE", "ADVANCE", "LOAN_REPAYMENT", "BONUS", "OVERTIME", "ALLOWANCE", "LOAN_GIVEN", "PAID_OUTSIDE"];

export function isAdjustmentKind(v: unknown): v is PayrollAdjustmentKind {
  return typeof v === "string" && ADJUSTMENT_KINDS.some((k) => k === v);
}

export const PURPOSE_LABEL: Record<PayrollLinkPurpose, string> = {
  SALARY: "راتب",
  ADVANCE: "سلفة على راتب الشهر",
  LOAN: "سلفة تُسدَّد أقساطاً",
  INVOICE: "لسداد فاتورة مورّد",
  EXPENSE: "مصروف للمقهى دفعه عنك",
  PERSONAL: "شخصي، لا شأن للمقهى به",
};

export const PURPOSE_HINT: Record<PayrollLinkPurpose, string> = {
  SALARY: "يُحسب مما حُوّل له من راتب الشهر، ويظهر في الرواتب في قائمة الدخل",
  ADVANCE: "يُحسب مما حُوّل له من راتب الشهر نفسه",
  LOAN: "يدخل رصيد سلفه ويُسدَّد بأقساط تُخصم من رواتبه القادمة",
  INVOICE: "حوّلته له ليدفع فاتورة مورّد مسجّلة في النظام. تخرج من مصروفات قائمة الدخل لأنها محسوبة في المشتريات",
  EXPENSE: "دفع به شيئاً للمقهى بلا فاتورة مسجّلة (مشتريات صغيرة، صيانة). يظهر في «مصروفات أخرى»",
  PERSONAL: "مالٌ شخصي منك له. يظهر في «تحويل لحساب المالك»",
};

export const PURPOSES: readonly PayrollLinkPurpose[] = ["SALARY", "ADVANCE", "LOAN", "INVOICE", "EXPENSE", "PERSONAL"];

export function isPurpose(v: unknown): v is PayrollLinkPurpose {
  return typeof v === "string" && PURPOSES.some((k) => k === v);
}

/** ما يُحسب من الحوالات مدفوعاً من راتب الشهر. */
export const PAYS_SALARY: ReadonlySet<PayrollLinkPurpose> = new Set(["SALARY", "ADVANCE"]);

/** قسمةٌ صحيحة تُقرَّب إلى الأقرب (النصفُ إلى الأعلى) — للموجب. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError("المقام صفر");
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** الراتبُ النافذ في شهر: آخرُ تغييرٍ بدأ فيه أو قبله. `null` إن لم يُكتب راتبٌ قبله. */
export function rateFor(rates: readonly { fromMonth: string; amountMinor: number }[], month: string): number | null {
  let best: { fromMonth: string; amountMinor: number } | null = null;
  for (const r of rates) {
    if (r.fromMonth <= month && (!best || r.fromMonth > best.fromMonth)) best = r;
  }
  return best?.amountMinor ?? null;
}

/** يعمل في الشهر: باشر قبل آخره ولم يخرج قبل أوّله. */
export function activeIn(e: { hiredOn: string; leftOn: string | null }, month: string): boolean {
  return e.hiredOn.slice(0, 7) <= month && (e.leftOn === null || month <= e.leftOn.slice(0, 7));
}

function daysOfMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * أيّامُ عمله في الشهر من أيّامه: مَن باشر في ١٥ أكتوبر عمل ١٧ يوماً من ٣١.
 * `null` لا يعمل فيه.
 */
export function workedDays(e: { hiredOn: string; leftOn: string | null }, month: string): { worked: number; of: number } | null {
  if (!activeIn(e, month)) return null;
  const of = daysOfMonth(month);
  const from = e.hiredOn.slice(0, 7) === month ? Number(e.hiredOn.slice(8, 10)) : 1;
  const to = e.leftOn && e.leftOn.slice(0, 7) === month ? Number(e.leftOn.slice(8, 10)) : of;
  return { worked: Math.max(0, to - from + 1), of };
}

/** راتبُ الشهر بأيّامه — كاملٌ إن عمل الشهرَ كلَّه. */
export function proratedSalary(salaryMinor: number | null, days: { worked: number; of: number } | null): number | null {
  if (salaryMinor === null || days === null) return salaryMinor === null ? null : 0;
  return days.worked >= days.of ? salaryMinor : divRound(salaryMinor * days.worked, days.of);
}

export interface LatePolicy {
  shiftMinutes: number;
  graceMinutes: number;
}

export function absenceDeductionMinor(salaryMinor: number | null, days: number): number | null {
  if (days === 0) return 0;
  if (salaryMinor === null) return null;
  return divRound(salaryMinor * days, DAYS_PER_MONTH);
}

/** قيمةُ دقيقة التأخير وقيمةُ اليوم — للعرض في الحاسبة. */
export function unitValues(salaryMinor: number, shiftMinutes: number): { minuteMinor: number; hourMinor: number; dayMinor: number } {
  return {
    minuteMinor: divRound(salaryMinor, DAYS_PER_MONTH * shiftMinutes),
    hourMinor: divRound(salaryMinor * 60, DAYS_PER_MONTH * shiftMinutes),
    dayMinor: divRound(salaryMinor, DAYS_PER_MONTH),
  };
}

/** أجرُ أسبوعٍ من ساعاته وأجرِ الساعة. */
export function hoursPayMinor(minutes: number, hourlyMinor: number): number {
  return divRound(minutes * hourlyMinor, 60);
}

/**
 * «٧» · «7.5» · «٧:٣٠» → دقائق صحيحة، أو `null`. لا عددَ عشريّاً في الطريق:
 * الكسرُ يُقرأ نصّاً (منزلتان على الأكثر).
 */
export function parseHours(input: string): number | null {
  const s = input.trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".");
  let m = /^(\d{1,3}):([0-5]\d)$/.exec(s);
  if (m) {
    const total = Number(m[1]) * 60 + Number(m[2]);
    return total > 0 ? total : null;
  }
  m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ? divRound(Number(m[2].padEnd(2, "0")) * 60, 100) : 0;
  const total = Number(m[1]) * 60 + frac;
  return total > 0 ? total : null;
}

/** «7:30» من دقائق. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, "0")}`;
}

/* ─────────────── الأسابيع: من الأحد إلى السبت، والأسبوعُ لشهر سبته ─────────────── */

function utc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/* الأيّامُ هنا تقويميّةٌ بلا ساعة — يومُ UTC هو اليومُ نفسُه */
const iso = isoDay;

/** أحدُ الأسبوع الذي يقع فيه اليوم. */
export function weekStartOf(day: string): string {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return iso(d);
}

export function weekEndOf(weekStart: string): string {
  const d = utc(weekStart);
  d.setUTCDate(d.getUTCDate() + 6);
  return iso(d);
}

/** الأسبوعُ يُدفَع بعد آخره، فيُحسَب لشهر سبته. */
export function weekMonth(weekStart: string): string {
  return weekEndOf(weekStart).slice(0, 7);
}

/** آحادُ الأسابيع التي تنتهي في الشهر. */
export function weeksOfMonth(month: string): string[] {
  const out: string[] = [];
  let start = weekStartOf(`${month}-01`);
  for (let i = 0; i < 7; i++) {
    if (weekMonth(start) === month) out.push(start);
    else if (weekMonth(start) > month) break;
    const d = utc(start);
    d.setUTCDate(d.getUTCDate() + 7);
    start = iso(d);
  }
  return out;
}

/* ─────────────── الحوالات ─────────────── */

/** رقمُ المستفيد كما يكتبه البنك في وصف الحوالة: «… BEN ID:1129311518». */
export function beneficiaryIdOf(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = t ? /BEN\s*ID\s*:?\s*(\d{4,20})/i.exec(t) : null;
    if (m) return m[1];
  }
  return null;
}

/** اسمُ المستفيد من وصف الحوالة — ما قبل «BEN ID». */
export function beneficiaryNameOf(beneficiary: string | null | undefined, description: string | null | undefined): string | null {
  const b = beneficiary?.trim();
  if (b) return b;
  const m = description ? /^(.*?)\s*BEN\s*ID/i.exec(description) : null;
  return m?.[1].trim() || null;
}

/**
 * عن أيّ شهرٍ دُفعت الحوالة؟ الرواتبُ تُحوَّل آخرَ الشهر (٢٧–٣١) أو أوّلَ الذي بعده.
 * فما وقع في الأيّام العشرة الأولى يُقترح للشهر السابق. اقتراحٌ يغيّره صاحبُه.
 */
export function suggestedPayMonth(day: string): string {
  const month = day.slice(0, 7);
  if (Number(day.slice(8, 10)) > 10) return month;
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/* ─────────────── الشهر ─────────────── */

export interface PayslipInput {
  kind: "MONTHLY" | "PART_TIME";
  /** للشهريّ: راتبُ الشهر النافذ (`null` لم يُكتب) — للجزئيّ يُهمَل. */
  salaryMinor: number | null;
  /** أيّامُ عمله من أيّام الشهر — مباشرةٌ أو خروجٌ في منتصفه. `null` يعمل الشهرَ كلَّه. */
  days: { worked: number; of: number } | null;
  /** للجزئيّ: أجورُ أسابيع الشهر. */
  weeksMinor: readonly number[];
  policy: LatePolicy;
  adjustments: readonly { kind: PayrollAdjustmentKind; amountMinor: number }[];
  attendance: readonly { kind: AttendanceKind; minutes: number | null }[];
  /** جزاءاتُ لائحة تنظيم العمل بعد حدودها (`saudi-rules.ts` · `monthViolations`). */
  penalties?: { chargedMinor: number; droppedMinor: number; warnings: number };
  /** ما رُبط من حوالات بغرض «راتب» أو «سلفة على الراتب» لهذا الشهر. */
  paidMinor: number;
}

export interface Payslip {
  /** ما دُفع خارج الكشف (داخلٌ في `paidMinor`). */
  paidOutsideMinor: number;
  /** راتبُ الشهر كاملاً كما كُتب — للعرض. */
  fullSalaryMinor: number | null;
  /** الراتبُ بأيّامه، أو مجموعُ الأسابيع للجزئيّ. `null` لم يُعرف. */
  baseMinor: number | null;
  days: { worked: number; of: number } | null;
  additionsMinor: number;
  /** خصمٌ بموافقته ومخالفةٌ بخطئه وقسطُ سلفة كما كُتبت. */
  manualDeductionsMinor: number;
  /** دقائقُ التأخير فوق السماح، والانصرافُ المبكّر. */
  lateMinutes: number;
  earlyMinutes: number;
  /** أجرُ دقائق التأخير والانصراف — ليس جزاءً، بل أجرُ وقتٍ لم يُعمل. */
  lateMinor: number | null;
  absentDays: number;
  leaveDays: number;
  /** أجرُ أيّام الغياب. */
  absenceMinor: number | null;
  /** جزاءاتُ اللائحة المحسومة، وما زاد على حدّها فلم يُحسم، وعددُ الإنذارات. */
  penaltiesMinor: number;
  penaltiesDroppedMinor: number;
  warnings: number;
  /** ما زاد على نصف الأجر (م ٩٢) فلم يُحسم. */
  overHalfMinor: number;
  /** كلُّ ما يُنقص الراتب (بلا السلف). */
  deductionsMinor: number | null;
  /** الراتب + الإضافات − الخصومات. */
  earnedMinor: number | null;
  advancesMinor: number;
  /** المستحقّ − السلف نقداً: ما يجب أن يُحوَّل له عن الشهر كلّه. */
  dueMinor: number | null;
  paidMinor: number;
  /** الباقي للتحويل. سالبُه: حُوِّل أكثر من المستحقّ. */
  remainingMinor: number | null;
}

const sumOf = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

export function payslip(input: PayslipInput): Payslip {
  const monthly = input.kind === "MONTHLY";
  const baseMinor = monthly ? proratedSalary(input.salaryMinor, input.days ?? { worked: 1, of: 1 }) : sumOf(input.weeksMinor);
  const pick = (pred: (k: PayrollAdjustmentKind) => boolean) =>
    sumOf(input.adjustments.filter((a) => pred(a.kind)).map((a) => a.amountMinor));
  const additionsMinor = pick((k) => ADDITIONS.has(k));
  const manualDeductionsMinor = pick((k) => DEDUCTIONS.has(k));
  const advancesMinor = pick((k) => k === "ADVANCE");
  const paidOutsideMinor = pick((k) => k === "PAID_OUTSIDE");
  const paidMinor = input.paidMinor + paidOutsideMinor;
  /* السماحُ عتبة: ما دونه لا يُحسب أصلاً، وما فوقه يُحسب كلُّه (اللائحةُ تعدّ التأخير من أوّل دقيقة) */
  const lateMinutes = sumOf(input.attendance.filter((a) => a.kind === "LATE" && (a.minutes ?? 0) > input.policy.graceMinutes).map((a) => a.minutes ?? 0));
  const earlyMinutes = sumOf(input.attendance.filter((a) => a.kind === "EARLY").map((a) => a.minutes ?? 0));
  const absentDays = input.attendance.filter((a) => a.kind === "ABSENT").length;
  const leaveDays = input.attendance.filter((a) => a.kind === "LEAVE").length;
  /* أجرُ الوقت الذي لم يُعمل يُقاس على راتب الشهر كاملاً — والجزئيُّ يُدفع بساعاته فلا يُحسم عليه */
  const rate = monthly ? input.salaryMinor : 0;
  const lateMinor = !monthly || lateMinutes + earlyMinutes === 0 ? 0
    : rate === null ? null : divRound(rate * (lateMinutes + earlyMinutes), DAYS_PER_MONTH * input.policy.shiftMinutes);
  const absenceMinor = monthly ? absenceDeductionMinor(rate, absentDays) : 0;
  const pen = monthly ? input.penalties ?? { chargedMinor: 0, droppedMinor: 0, warnings: 0 } : { chargedMinor: 0, droppedMinor: 0, warnings: 0 };
  /* م ٩٢/٢: الحسمُ كلُّه لا يزيد على نصف الأجر — وأجرُ الوقت غير المعمول ليس حسماً من أجرٍ استُحقّ */
  const halfCap = rate ? divRound(rate, 2) : null;
  const charges = manualDeductionsMinor + pen.chargedMinor;
  const overHalfMinor = halfCap !== null && charges > halfCap ? charges - halfCap : 0;
  const deductionsMinor = lateMinor === null || absenceMinor === null ? null : charges - overHalfMinor + lateMinor + absenceMinor;
  const earnedMinor = baseMinor === null || deductionsMinor === null ? null : baseMinor + additionsMinor - deductionsMinor;
  const dueMinor = earnedMinor === null ? null : earnedMinor - advancesMinor;
  return {
    fullSalaryMinor: monthly ? input.salaryMinor : null,
    baseMinor, days: monthly ? input.days : null, additionsMinor, manualDeductionsMinor,
    lateMinutes, earlyMinutes, lateMinor, absentDays, leaveDays, absenceMinor,
    penaltiesMinor: pen.chargedMinor, penaltiesDroppedMinor: pen.droppedMinor, warnings: pen.warnings, overHalfMinor,
    deductionsMinor, earnedMinor, advancesMinor, dueMinor,
    paidMinor, paidOutsideMinor,
    remainingMinor: dueMinor === null ? null : dueMinor - paidMinor,
  };
}

/** مجموعُ المسيّر — وما لم يُعرف يُعدّ ويُقال، ولا يُجمع صفراً. */
export function payrollTotals(slips: readonly Payslip[]): { dueMinor: number; paidMinor: number; remainingMinor: number; overpaidMinor: number; unknown: number } {
  let dueMinor = 0, paidMinor = 0, remainingMinor = 0, overpaidMinor = 0, unknown = 0;
  for (const s of slips) {
    paidMinor += s.paidMinor;
    if (s.dueMinor === null || s.remainingMinor === null) { unknown++; continue; }
    dueMinor += s.dueMinor;
    if (s.remainingMinor > 0) remainingMinor += s.remainingMinor;
    else overpaidMinor -= s.remainingMinor;
  }
  return { dueMinor, paidMinor, remainingMinor, overpaidMinor, unknown };
}

/* ─────────────── السلف ─────────────── */

/** رصيدُ السلف: ما أُعطي (حوالةً أو نقداً) − ما سُدّد أقساطاً. */
export function loanBalance(input: { loanLinksMinor: number; loanGivenMinor: number; repaidMinor: number }): number {
  return input.loanLinksMinor + input.loanGivenMinor - input.repaidMinor;
}

/* ─────────────── مكافأة نهاية الخدمة (نظام العمل، المادّتان ٨٤ و٨٥) ─────────────── */

const FIVE_YEARS_DAYS = 5 * 365;

/**
 * نصفُ أجر شهرٍ عن كلّ سنةٍ من الخمس الأولى، وأجرُ شهرٍ عن كلّ سنةٍ بعدها، وأجزاءُ السنة
 * بنسبتها. وفي الاستقالة: لا شيءَ قبل سنتين، وثلثُها إلى خمس، وثلثاها إلى عشر، وكاملةٌ بعدها.
 * تقديرٌ للعلم لا حكمٌ نظاميّ — يُبنى على آخر راتب.
 */
export function endOfService(salaryMinor: number, serviceDays: number): { fullMinor: number; resignationMinor: number; years: number } {
  const d = Math.max(0, serviceDays);
  const fullMinor = divRound(salaryMinor * (Math.min(d, FIVE_YEARS_DAYS) + 2 * Math.max(0, d - FIVE_YEARS_DAYS)), 2 * 365);
  const years = d / 365;
  const resignationMinor = years < 2 ? 0 : years < 5 ? divRound(fullMinor, 3) : years < 10 ? divRound(fullMinor * 2, 3) : fullMinor;
  return { fullMinor, resignationMinor, years: Math.floor(years) };
}

/* ─────────────── أثرُ الربط في قائمة الدخل ─────────────── */

export type ReclassTarget = "SALARY" | "OTHER" | "PERSONAL" | "EXCLUDED";

/**
 * إلى أين يذهب جزءُ الحوالة في قائمة الدخل بغرضه — `null` يبقى حيث هو.
 * الراتبُ والسلفُ رواتب، والمصروفُ «أخرى»، والشخصيُّ تحويلٌ للمالك، وسدادُ الفاتورة يخرج
 * (محسوبٌ في المشتريات حين قُيِّدت الفاتورة).
 */
export function reclassTarget(txCategory: "SALARY" | "PERSONAL", purpose: PayrollLinkPurpose): ReclassTarget | null {
  const target: ReclassTarget = purpose === "SALARY" || purpose === "ADVANCE" || purpose === "LOAN" ? "SALARY"
    : purpose === "EXPENSE" ? "OTHER" : purpose === "PERSONAL" ? "PERSONAL" : "EXCLUDED";
  return target === txCategory ? null : target;
}
