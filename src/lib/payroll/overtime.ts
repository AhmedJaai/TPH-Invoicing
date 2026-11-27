/**
 * العملُ الإضافيّ من تسجيل الحضور — يقترحه التطبيق ويُقرّه المالك (أحمد، ٢٧ نوفمبر ٢٠٢٦).
 *
 * كان العملُ الإضافيّ لا يُحسب إلّا مبلغاً يكتبه المالك بيده، والتسجيلاتُ تقول غيرَ ذلك: صالح يعمل
 * ٦١٠ دقائق في المتوسّط على دوامٍ من ٥٤٠. فيُقاس من التسجيل ما بعد نهاية الدوام:
 *
 *   - **يومُ العمل**: من نهاية الدوام إلى آخر انصراف. والحضورُ المبكّر قبل الدوام لا يُعدّ إضافيّاً
 *     (لم يُطلب)، ولا يُقاصّ التأخيرُ بالبقاء بعده — قرارُ أحمد: التأخيرُ مخالفةٌ بذاتها.
 *   - **يومُ الراحة**: ما عمله كلُّه، من أوّل حضور إلى آخر انصراف.
 *   - أقلُّ من ربع ساعة لا يُقترح (تسليمُ الوردية وإغلاقُ الصندوق)، وأكثرُ من ستّ ساعات فوق الدوام
 *     «مشكوك» — نسي الانصراف أو الحضور (يومٌ قيس فيه ١٤٦٨ دقيقة).
 *
 * والأجرُ بالمادّة ١٠٧ من نظام العمل: أجرُ الساعة وفوقه نصفُه — الساعةُ = الراتب ÷ (٣٠ × ساعات الدوام).
 * والراتبُ في التطبيق واحدٌ لا أساسيٌّ وبدلات، فيُحسب الأجرُ كلُّه أساساً.
 *
 * نقيّ: المالُ هللاتٌ صحيحة، والوقتُ دقائقُ صحيحة.
 */
import { DAYS_PER_MONTH, divRound } from "./calc";
import { MAX_SHIFT_MINUTES, shiftStartAt, type DayShift } from "./attendance";

/** أقلُّ ما يُقترح عملاً إضافيّاً في اليوم. */
export const OVERTIME_MIN_MINUTES = 15;
/** فوقه يُعدّ اليومُ مشكوكاً — تسجيلٌ ناقص لا عملٌ حقيقيّ. */
export const OVERTIME_SUSPECT_MINUTES = 6 * 60;

export type OvertimeStatus =
  /** يُقترح للإقرار. */
  | "SUGGESTED"
  /** أقلُّ من ربع ساعة — يُعدّ ولا يُقترح. */
  | "BELOW_MIN"
  /** طويلٌ على غير العادة — يُعرض ولا يُقرّ إلّا بيده. */
  | "SUSPECT";

export interface OvertimeDay {
  day: string;
  restDay: boolean;
  firstIn: Date | null;
  lastOut: Date;
  /** نهايةُ الدوام — `null` ليوم الراحة. */
  shiftEnd: Date | null;
  minutes: number;
  status: OvertimeStatus;
}

export interface OvertimeCheckin {
  kind: "IN" | "OUT";
  at: Date;
  /** يومُ الدوام الذي يُنسب إليه (`dayForOut` للانصراف بعد منتصف الليل). */
  day: string;
  rejected?: boolean;
}

/**
 * أيّامُ العمل الإضافيّ بين يومين (شاملَين). يومٌ بلا انصراف لا يُقاس، ويومٌ بلا وقت دوامٍ مكتوب
 * لا يُعرف متى انتهى دوامُه فلا يُقاس.
 */
export function measureOvertime(input: {
  checkins: readonly OvertimeCheckin[];
  shiftFor: (day: string) => DayShift;
  fromDay: string;
  toDay: string;
}): OvertimeDay[] {
  const byDay = new Map<string, OvertimeCheckin[]>();
  for (const c of input.checkins) {
    if (c.rejected || c.day < input.fromDay || c.day > input.toDay) continue;
    const list = byDay.get(c.day) ?? [];
    list.push(c);
    byDay.set(c.day, list);
  }
  const out: OvertimeDay[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const list = byDay.get(day)!.sort((a, b) => a.at.getTime() - b.at.getTime());
    const firstIn = list.find((c) => c.kind === "IN")?.at ?? null;
    const outs = list.filter((c) => c.kind === "OUT" && (!firstIn || c.at > firstIn));
    if (outs.length === 0) continue;
    const lastOut = outs[outs.length - 1].at;
    const shift = input.shiftFor(day);
    let minutes: number;
    let shiftEnd: Date | null = null;
    let suspect = false;
    if (shift.off) {
      /* يومُ راحةٍ عمل فيه: يُحتاج الحضورُ والانصراف معاً */
      if (!firstIn) continue;
      minutes = Math.floor((lastOut.getTime() - firstIn.getTime()) / 60_000);
      suspect = minutes > MAX_SHIFT_MINUTES;
    } else {
      if (!shift.start) continue;
      shiftEnd = new Date(shiftStartAt(day, shift.start).getTime() + shift.minutes * 60_000);
      minutes = Math.floor((lastOut.getTime() - shiftEnd.getTime()) / 60_000);
      /* بلا حضورٍ في يومه لا يُعرف أنّه عمل الدوامَ أصلاً */
      suspect = minutes > OVERTIME_SUSPECT_MINUTES || firstIn === null;
    }
    if (minutes <= 0) continue;
    out.push({
      day, restDay: shift.off, firstIn, lastOut, shiftEnd, minutes,
      status: suspect ? "SUSPECT" : minutes < OVERTIME_MIN_MINUTES ? "BELOW_MIN" : "SUGGESTED",
    });
  }
  return out;
}

/** أجرُ دقائق إضافيّة بالمادّة ١٠٧: (الراتب ÷ (٣٠ × دقائق الدوام)) × الدقائق × ١٫٥ — قسمةٌ واحدة في الآخر. */
export function overtimeMinor(salaryMinor: number, shiftMinutes: number, minutes: number): number {
  if (shiftMinutes <= 0) throw new RangeError("طول الدوام صفر");
  return divRound(salaryMinor * minutes * 3, DAYS_PER_MONTH * shiftMinutes * 2);
}

/** أجرُ ساعةٍ إضافيّة — للعرض («الساعة ٣٢٫٤١»). */
export function overtimeHourMinor(salaryMinor: number, shiftMinutes: number): number {
  return overtimeMinor(salaryMinor, shiftMinutes, 60);
}
