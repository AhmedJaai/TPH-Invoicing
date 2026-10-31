/**
 * الخصمُ بلوائح السعوديّة — جدولُ المخالفات والجزاءات في **لائحة تنظيم العمل النموذجيّة** (وزارة
 * الموارد البشريّة)، وحدودُ الحسم في **نظام العمل** (المادّتان ٩١ و٩٢).
 *
 * أحمد (٢٣ أكتوبر ٢٠٢٦): «الخصم يكون بناءً على لوائح السعوديّة».
 *
 *   - الجزاءُ من الجدول بنوع المخالفة ومرّتها (أولى · ثانية · ثالثة · رابعة)، **والنسبةُ من الأجر
 *     اليوميّ** (الشهريّ ÷ ٣٠). ومع جزاء التأخير والانصراف والغياب يُحسم **أجرُ المدّة نفسها**.
 *   - لا يُشدَّد الجزاءُ في التكرار إن مضى على المخالفة السابقة أكثرُ من **١٨٠ يوماً** — تُحسب أولى.
 *   - لا تزيد الغرامةُ عن المخالفة الواحدة على **أجر خمسة أيّام**، ولا يُحسم للغرامات في الشهر
 *     الواحد أكثرُ من **أجر خمسة أيّام**.
 *   - تعويضُ ضررٍ تسبّب به العامل (ومنه مخالفةٌ بلديّة بخطئه): لا يزيد ما يُحسم له على **أجر خمسة
 *     أيّام في الشهر** (م ٩١).
 *   - استردادُ القرض: لا يزيد على **١٠٪ من الأجر** (م ٩٢/١-أ)، ومجموعُ الحسم كلّه لا يزيد على **نصف
 *     الأجر** (م ٩٢/٢).
 *
 * والجدولُ حدٌّ أعلى: لصاحب العمل أن يعفو (`waived`)، فلا يُحسم الجزاءُ ولا يُعدّ في التكرار.
 * نقيّ: المالُ هللاتٌ صحيحة.
 */
import { inDeductionPeriod } from "./period";
import type { AttendanceKind } from "@/db/schema";
import { isoDay } from "@/lib/riyadh-time";
import { isWorkday } from "./attendance";
import { divRound } from "./calc";

export const DAYS_IN_WAGE_MONTH = 30;
export const REPEAT_WINDOW_DAYS = 180;
export const MAX_PENALTY_DAYS = 5;
export const MAX_DAMAGE_DAYS_PER_MONTH = 5;
export const LOAN_MAX_BP = 1_000;
export const TOTAL_DEDUCTION_MAX_BP = 5_000;

export type Penalty =
  | { kind: "WARNING" }
  /** نسبةٌ من الأجر اليوميّ بنقاط الأساس (٥٪ = ٥٠٠). */
  | { kind: "PCT"; bp: number }
  | { kind: "DAYS"; days: number }
  | { kind: "DISMISSAL"; withGratuity: boolean };

export interface ViolationRule {
  code: string;
  label: string;
  /** الأولى فالرابعة. وما بعد الرابعة يبقى على الرابعة. */
  ladder: readonly Penalty[];
  /** يُحسم معه أجرُ المدّة (التأخير · الانصراف · الغياب). */
  plusTimeWage: boolean;
}

const W: Penalty = { kind: "WARNING" };
const P = (pct: number): Penalty => ({ kind: "PCT", bp: pct * 100 });
const D = (days: number): Penalty => ({ kind: "DAYS", days });
const FIRE: Penalty = { kind: "DISMISSAL", withGratuity: true };

/** جدولُ «مخالفات تتعلّق بمواعيد العمل» وما يكثر في المقهى من غيره — بأرقام بنوده في اللائحة. */
export const RULES: Readonly<Record<string, ViolationRule>> = {
  "1/1": { code: "1/1", label: "تأخر حتى 15 دقيقة دون تعطيل غيره", ladder: [W, P(5), P(10), P(20)], plusTimeWage: true },
  "1/2": { code: "1/2", label: "تأخر حتى 15 دقيقة وعطّل غيره", ladder: [W, P(15), P(25), P(50)], plusTimeWage: true },
  "1/3": { code: "1/3", label: "تأخر من 15 إلى 30 دقيقة دون تعطيل غيره", ladder: [P(10), P(15), P(25), P(50)], plusTimeWage: true },
  "1/4": { code: "1/4", label: "تأخر من 15 إلى 30 دقيقة وعطّل غيره", ladder: [P(25), P(50), P(75), D(1)], plusTimeWage: true },
  "1/5": { code: "1/5", label: "تأخر من 30 إلى 60 دقيقة دون تعطيل غيره", ladder: [P(25), P(50), P(75), D(1)], plusTimeWage: true },
  "1/6": { code: "1/6", label: "تأخر من 30 إلى 60 دقيقة وعطّل غيره", ladder: [P(30), P(50), D(1), D(2)], plusTimeWage: true },
  "1/7": { code: "1/7", label: "تأخر أكثر من ساعة", ladder: [W, D(1), D(2), D(3)], plusTimeWage: true },
  "1/8": { code: "1/8", label: "انصراف قبل الموعد حتى 15 دقيقة", ladder: [W, P(10), P(25), D(1)], plusTimeWage: true },
  "1/9": { code: "1/9", label: "انصراف قبل الموعد أكثر من 15 دقيقة", ladder: [P(10), P(25), P(50), D(1)], plusTimeWage: true },
  "1/11": { code: "1/11", label: "غياب دون إذن من يوم إلى ثلاثة أيام", ladder: [D(1), D(2), D(3), D(4)], plusTimeWage: true },
  "1/12": { code: "1/12", label: "غياب دون إذن من أربعة إلى ستة أيام", ladder: [D(2), D(3), D(4), FIRE], plusTimeWage: true },
  "1/13": { code: "1/13", label: "غياب دون إذن من سبعة إلى عشرة أيام", ladder: [D(4), D(5), FIRE], plusTimeWage: true },
  /* ما يكثر في المقهى من بقيّة الجدول — يُسجَّل بيد صاحبه */
  "2/3": { code: "2/3", label: "الأكل في مكان العمل أو في غير أوقات الراحة", ladder: [W, P(10), P(15), P(25)], plusTimeWage: false },
  "2/4": { code: "2/4", label: "النوم أثناء العمل", ladder: [W, P(10), P(25), P(50)], plusTimeWage: false },
  "2/6": { code: "2/6", label: "التسكع أو الوجود في غير مكان العمل أثناء الدوام", ladder: [P(10), P(25), P(50), D(1)], plusTimeWage: false },
  "2/7": { code: "2/7", label: "التلاعب في إثبات الحضور والانصراف", ladder: [P(25), P(50), D(1), D(2)], plusTimeWage: false },
  "2/8": { code: "2/8", label: "عدم إطاعة أوامر العمل أو التعليمات المعلّقة", ladder: [P(25), P(50), D(1), D(2)], plusTimeWage: false },
  "2/10": { code: "2/10", label: "التدخين في الأماكن المحظورة", ladder: [D(2), D(3), D(5), FIRE], plusTimeWage: false },
  "2/11": { code: "2/11", label: "الإهمال الذي قد يضر بالسلامة أو بالمواد والأجهزة", ladder: [D(2), D(3), D(5), FIRE], plusTimeWage: false },
  "2/12": { code: "2/12", label: "استعمال أدوات المنشأة لأغراض خاصة دون إذن", ladder: [W, P(10), P(25), P(50)], plusTimeWage: false },
  "2/15": { code: "2/15", label: "الإهمال في تنظيف الآلات وصيانتها", ladder: [P(50), D(1), D(2), D(3)], plusTimeWage: false },
  "3/1": { code: "3/1", label: "التشاجر مع الزملاء أو إحداث مشاغبات", ladder: [D(1), D(2), D(3), D(5)], plusTimeWage: false },
  "3/4": { code: "3/4", label: "مخالفة التعليمات الصحية المعلّقة في مكان العمل", ladder: [P(50), D(1), D(2), D(5)], plusTimeWage: false },
  "3/8": { code: "3/8", label: "عدم تسليم النقود المحصّلة في موعدها دون عذر", ladder: [D(2), D(3), D(5), FIRE], plusTimeWage: false },
  "3/9": { code: "3/9", label: "الامتناع عن ارتداء ملابس الوقاية والسلامة", ladder: [W, D(1), D(2), D(5)], plusTimeWage: false },
};

/** المخالفاتُ التي تُسجَّل بيد صاحب المقهى (ما سوى المواعيد). */
export const MANUAL_CODES: readonly string[] = Object.keys(RULES).filter((c) => !c.startsWith("1/"));

export function isViolationCode(v: unknown): v is string {
  return typeof v === "string" && Object.hasOwn(RULES, v);
}

export const ORDINAL = ["الأولى", "الثانية", "الثالثة", "الرابعة"] as const;

export function lateCode(minutes: number, disrupted: boolean): string {
  if (minutes > 60) return "1/7";
  if (minutes > 30) return disrupted ? "1/6" : "1/5";
  if (minutes > 15) return disrupted ? "1/4" : "1/3";
  return disrupted ? "1/2" : "1/1";
}

export function earlyCode(minutes: number): string {
  return minutes > 15 ? "1/9" : "1/8";
}

/** بندُ الغياب بطول نوبته. فوق عشرة أيّامٍ متّصلة: المادّة ٨٠ لا جزاءٌ ماليّ. */
export function absenceCode(days: number): string | "ART80" {
  if (days > 10) return "ART80";
  if (days >= 7) return "1/13";
  if (days >= 4) return "1/12";
  return "1/11";
}

export function dailyWageMinor(monthlyMinor: number): number {
  return divRound(monthlyMinor, DAYS_IN_WAGE_MONTH);
}

/** مبلغُ الجزاء — الإنذارُ صفر، والفصلُ ليس مبلغاً (`null`). */
export function penaltyMinor(p: Penalty, dailyMinor: number): number | null {
  switch (p.kind) {
    case "WARNING": return 0;
    case "PCT": return divRound(dailyMinor * p.bp, 10_000);
    case "DAYS": return dailyMinor * p.days;
    case "DISMISSAL": return null;
  }
}

export function penaltyLabel(p: Penalty): string {
  switch (p.kind) {
    case "WARNING": return "إنذار كتابي";
    case "PCT": return `${p.bp / 100}٪ من أجر يوم`;
    case "DAYS": return p.days === 1 ? "أجر يوم" : p.days === 2 ? "أجر يومين" : `أجر ${p.days} أيام`;
    case "DISMISSAL": return p.withGratuity ? "فصل مع المكافأة" : "فصل دون مكافأة";
  }
}

function dayNum(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;
}

export interface ViolationEvent {
  /** معرّفُ السجلّ — للإعفاء. */
  id: string;
  code: string;
  day: string;
  waived: boolean;
  /** ما يُعرض: «تأخر ٢٣ دقيقة» · «غاب ٣ أيام». */
  detail: string;
}

export interface AssessedViolation extends ViolationEvent {
  label: string;
  /** المرّة: ١ … (والرابعةُ فما بعدها على الرابعة). */
  occurrence: number;
  penalty: Penalty;
  /** قبل الحدّ. `null` للفصل. */
  amountMinor: number | null;
}

/**
 * يرتّب المخالفات ويعطي كلّاً مرّتَها: المعفى عنها لا تُعدّ، ومضيُّ أكثر من ١٨٠ يوماً على السابقة
 * من البند نفسه يعيد العدّ إلى الأولى.
 */
export function assess(events: readonly ViolationEvent[], dailyMinor: number): AssessedViolation[] {
  const sorted = [...events].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  const last = new Map<string, { day: string; count: number }>();
  const out: AssessedViolation[] = [];
  for (const e of sorted) {
    const rule = RULES[e.code];
    if (!rule) continue;
    const prev = last.get(e.code);
    const occurrence = prev && dayNum(e.day) - dayNum(prev.day) <= REPEAT_WINDOW_DAYS ? prev.count + 1 : 1;
    const penalty = rule.ladder[Math.min(occurrence, rule.ladder.length) - 1];
    out.push({ ...e, label: rule.label, occurrence, penalty, amountMinor: e.waived ? 0 : penaltyMinor(penalty, dailyMinor) });
    if (!e.waived) last.set(e.code, { day: e.day, count: occurrence });
  }
  return out;
}

export interface CappedPenalties {
  /** ما يُحسم فعلاً للجزاءات في الشهر. */
  chargedMinor: number;
  /** ما زاد على الحدّ (٥ أيّام للمخالفة · ٥ أيّام في الشهر) فلا يجوز حسمُه. */
  droppedMinor: number;
  warnings: number;
  /** مخالفاتٌ بلغت الفصل في الجدول — قرارٌ لصاحب العمل لا مبلغ. */
  dismissals: AssessedViolation[];
}

/** حدّا الغرامات: المخالفةُ الواحدة ≤ أجر ٥ أيّام، ومجموعُ الشهر ≤ أجر ٥ أيّام. */
export function capPenalties(items: readonly AssessedViolation[], dailyMinor: number): CappedPenalties {
  const perViolation = dailyMinor * MAX_PENALTY_DAYS;
  const perMonth = dailyMinor * MAX_PENALTY_DAYS;
  let charged = 0, dropped = 0, warnings = 0;
  const dismissals: AssessedViolation[] = [];
  for (const v of items) {
    if (v.waived) continue;
    if (v.penalty.kind === "WARNING") { warnings++; continue; }
    if (v.amountMinor === null) { dismissals.push(v); continue; }
    const one = Math.min(v.amountMinor, perViolation);
    const room = Math.max(0, perMonth - charged);
    const take = Math.min(one, room);
    charged += take;
    dropped += v.amountMinor - take;
  }
  return { chargedMinor: charged, droppedMinor: dropped, warnings, dismissals };
}

/** حدُّ تعويض الضرر في الشهر (م ٩١). */
export function damageCapMinor(monthlyMinor: number): number {
  return dailyWageMinor(monthlyMinor) * MAX_DAMAGE_DAYS_PER_MONTH;
}

/** حدُّ قسط القرض في الشهر (م ٩٢/١-أ): ١٠٪ من الأجر. */
export function loanCapMinor(monthlyMinor: number): number {
  return divRound(monthlyMinor * LOAN_MAX_BP, 10_000);
}

/** حدُّ الحسم كلّه (م ٩٢/٢): نصفُ الأجر. */
export function totalCapMinor(monthlyMinor: number): number {
  return divRound(monthlyMinor * TOTAL_DEDUCTION_MAX_BP, 10_000);
}

/**
 * نوباتُ الغياب: أيّامٌ متتالية تُعدّ نوبةً واحدة، وأيّامُ الراحة بينها لا تقطعها.
 * والنوبةُ تُنسب إلى يومها الأوّل.
 */
export function absenceSpells(days: readonly { id: string; day: string }[], isWorkday: (day: string) => boolean): { id: string; start: string; days: number }[] {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const out: { id: string; start: string; days: number }[] = [];
  let cur: { id: string; start: string; days: number; last: string } | null = null;
  for (const d of sorted) {
    if (cur && bridged(cur.last, d.day, isWorkday)) {
      cur.days++;
      cur.last = d.day;
      continue;
    }
    if (cur) out.push({ id: cur.id, start: cur.start, days: cur.days });
    cur = { id: d.id, start: d.day, days: 1, last: d.day };
  }
  if (cur) out.push({ id: cur.id, start: cur.start, days: cur.days });
  return out;
}

function bridged(from: string, to: string, isWorkday: (day: string) => boolean): boolean {
  const gap = dayNum(to) - dayNum(from);
  if (gap <= 0 || gap > 8) return gap === 1;
  for (let i = 1; i < gap; i++) {
    const d = isoDay(new Date((dayNum(from) + i) * 86_400_000));
    if (isWorkday(d)) return false;
  }
  return true;
}

/* ─────────────── مخالفاتُ الشهر من الحضور ─────────────── */

export interface AttendanceRecord {
  id: string;
  day: string;
  kind: AttendanceKind;
  minutes: number | null;
  disrupted: boolean;
  penaltyWaived: boolean;
}

export interface ManualViolation {
  id: string;
  day: string;
  code: string;
  waived: boolean;
  note: string | null;
}

/** التأخيرُ في حدود السماح لا يُعدّ مخالفةً ولا يُحسم أجرُه — سماحُ صاحب العمل فوق اللائحة. */
export function countsAsLate(minutes: number, graceMinutes: number): boolean {
  return minutes > graceMinutes;
}

/**
 * مخالفاتُ الشهر وجزاؤها: من سجلّ الحضور (تأخير · انصراف · غياب) ومن المسجَّل بيده، والتاريخُ
 * كلُّه (١٨٠ يوماً قبل الشهر على الأقلّ) لعدّ المرّات. يُرجع ما وقع في فترة خصم الشهر وحدها بعد الحدود.
 */
export function monthViolations(input: {
  month: string;
  monthlyMinor: number;
  graceMinutes: number;
  daysOff: string;
  history: readonly AttendanceRecord[];
  manual: readonly ManualViolation[];
}): { items: AssessedViolation[]; capped: CappedPenalties; article80: { start: string; days: number }[] } {
  const daily = dailyWageMinor(input.monthlyMinor);
  const events: ViolationEvent[] = [];
  for (const a of input.history) {
    if (a.kind === "LATE" && a.minutes !== null && countsAsLate(a.minutes, input.graceMinutes)) {
      events.push({ id: a.id, code: lateCode(a.minutes, a.disrupted), day: a.day, waived: a.penaltyWaived, detail: `تأخر ${a.minutes} دقيقة` });
    } else if (a.kind === "EARLY" && a.minutes !== null) {
      events.push({ id: a.id, code: earlyCode(a.minutes), day: a.day, waived: a.penaltyWaived, detail: `انصرف قبل الموعد بـ${a.minutes} دقيقة` });
    }
  }
  const absences = input.history.filter((a) => a.kind === "ABSENT");
  const waivedById = new Map(absences.map((a) => [a.id, a.penaltyWaived]));
  const article80: { start: string; days: number }[] = [];
  for (const spell of absenceSpells(absences, (d) => isWorkday(d, input.daysOff))) {
    const code = absenceCode(spell.days);
    if (code === "ART80") { if (inDeductionPeriod(spell.start, input.month)) article80.push({ start: spell.start, days: spell.days }); continue; }
    events.push({ id: spell.id, code, day: spell.start, waived: waivedById.get(spell.id) ?? false, detail: spell.days === 1 ? "غاب يوماً" : spell.days === 2 ? "غاب يومين متتاليين" : `غاب ${spell.days} أيام متتالية` });
  }
  for (const m of input.manual) events.push({ id: m.id, code: m.code, day: m.day, waived: m.waived, detail: m.note ?? RULES[m.code]?.label ?? m.code });
  /* ما وقع في فترة خصم الشهر (٢٧ السابق → ٢٦ منه) — `period.ts` */
  const items = assess(events, daily).filter((v) => inDeductionPeriod(v.day, input.month));
  return { items, capped: capPenalties(items, daily), article80 };
}
