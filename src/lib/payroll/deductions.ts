/**
 * خصمُ كلّ يوم — ما يراه صاحبُ المقهى بجانب كلّ تأخيرٍ أو انصرافٍ مبكّر أو غياب، ليعدّله أو يلغيه
 * أو يعفو عن جزائه.
 *
 * القسيمةُ تجمع الدقائقَ ثمّ تقسم مرّةً واحدة (`payslip`)، فلو قُسم كلُّ يومٍ وحده لاختلف المجموعُ
 * عنها بهللة. فالقسمةُ هنا تراكميّة (`splitShares`): حصّةُ اليوم = قيمةُ ما تراكم حتّى آخره −
 * قيمةُ ما قبله، ومجموعُ الحصص يساوي ما في القسيمة هللةً بهللة.
 *
 * نقيّ: المالُ هللاتٌ صحيحة، والوقتُ دقائقُ صحيحة.
 */
import type { AttendanceKind } from "@/db/schema";
import { DAYS_PER_MONTH, divRound } from "./calc";
import { countsAsLate, penaltyLabel, type AssessedViolation } from "./saudi-rules";

/**
 * يقسم قيمةَ مجموعٍ على أجزائه بلا فرق تقريب: `valueOf(n)` قيمةُ n وحدةً مجتمعة (متزايدة).
 * الحصّةُ = valueOf(ما تراكم حتّى هذا الجزء) − valueOf(ما قبله).
 */
export function splitShares(units: readonly number[], valueOf: (cumulative: number) => number): number[] {
  let cumulative = 0, previous = valueOf(0);
  return units.map((u) => {
    cumulative += u;
    const value = valueOf(cumulative);
    const share = value - previous;
    previous = value;
    return share;
  });
}

export interface DeductionAttendance {
  id: string;
  day: string;
  kind: AttendanceKind;
  minutes: number | null;
  source: "MANUAL" | "CHECKIN";
  disrupted: boolean;
  penaltyWaived: boolean;
  note: string | null;
}

export interface DeductionPenalty {
  code: string;
  label: string;
  /** «٥٪ من أجر اليوم» · «إنذار كتابي». */
  rule: string;
  occurrence: number;
  /** قبل حدّ الشهر — `null` لما يجيز الفصل. صفرٌ إن عُفي عنه. */
  amountMinor: number | null;
  warning: boolean;
  waived: boolean;
}

export interface DeductionItem extends DeductionAttendance {
  /** تأخيرٌ في حدود السماح: لا يُحسم ولا يُعدّ مخالفة. */
  withinGrace: boolean;
  /** أجرُ الوقت أو اليوم الذي لم يُعمل. `null`: الراتبُ غير مكتوب فلا يُعرف. */
  wageMinor: number | null;
  /** جزاءُ لائحة تنظيم العمل فوقه — `null` لا جزاء (سماحٌ أو إجازة أو جزئيّ). */
  penalty: DeductionPenalty | null;
}

/**
 * بنودُ الحضور بمالها: أجرُ الوقت (الدقيقة = الراتب ÷ (٣٠ × دقائق الدوام)) أو اليوم (الراتب ÷ ٣٠)،
 * وجزاءُ اللائحة من `violations` بمعرّف البند. والجزئيُّ يُدفع بساعاته فلا يُحسم عليه شيء.
 */
export function deductionItems(input: {
  kind: "MONTHLY" | "PART_TIME";
  rateMinor: number | null;
  shiftMinutes: number;
  graceMinutes: number;
  attendance: readonly DeductionAttendance[];
  violations: readonly AssessedViolation[];
}): DeductionItem[] {
  const monthly = input.kind === "MONTHLY";
  const counted = (a: DeductionAttendance) =>
    (a.kind === "LATE" && a.minutes !== null && countsAsLate(a.minutes, input.graceMinutes)) || (a.kind === "EARLY" && a.minutes !== null);
  /* بترتيب الأيّام — والمجموعُ لا يتغيّر بالترتيب */
  const timed = input.attendance.filter(counted);
  const absent = input.attendance.filter((a) => a.kind === "ABSENT");
  const rate = input.rateMinor;
  const timeShares = rate === null ? null : splitShares(timed.map((a) => a.minutes ?? 0), (n) => (n === 0 ? 0 : divRound(rate * n, DAYS_PER_MONTH * input.shiftMinutes)));
  const dayShares = rate === null ? null : splitShares(absent.map(() => 1), (n) => (n === 0 ? 0 : divRound(rate * n, DAYS_PER_MONTH)));
  const byId = new Map(input.violations.map((v) => [v.id, v]));

  return input.attendance.map((a) => {
    const late = a.kind === "LATE" && a.minutes !== null;
    const withinGrace = late && !countsAsLate(a.minutes!, input.graceMinutes);
    let wageMinor: number | null = 0;
    if (monthly) {
      const t = timed.indexOf(a), d = absent.indexOf(a);
      if (t >= 0) wageMinor = timeShares === null ? null : timeShares[t];
      else if (d >= 0) wageMinor = dayShares === null ? null : dayShares[d];
    }
    const v = monthly ? byId.get(a.id) : undefined;
    const penalty: DeductionPenalty | null = v ? {
      code: v.code, label: v.label, rule: penaltyLabel(v.penalty), occurrence: v.occurrence,
      amountMinor: v.amountMinor, warning: v.penalty.kind === "WARNING", waived: v.waived,
    } : null;
    return { ...a, withinGrace, wageMinor, penalty };
  });
}

/** مجموعُ ما يُحسم من البنود — `null` إن جُهل أجرُ أحدها. (الجزاءُ قبل حدّ الشهر.) */
export function deductionTotal(items: readonly DeductionItem[]): number | null {
  let sum = 0;
  for (const i of items) {
    if (i.wageMinor === null) return null;
    sum += i.wageMinor + (i.penalty?.amountMinor ?? 0);
  }
  return sum;
}
