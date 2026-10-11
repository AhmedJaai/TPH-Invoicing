/**
 * «العادة» — كم يُباع عادةً من كلّ صنفٍ في كلّ يومٍ من الأسبوع.
 *
 * **ليست تنبّؤاً**: التنبّؤُ بالمبيعات غيرُ مبنيٍّ عمداً، ولا يُمدّ هنا خطٌّ إلى المستقبل.
 * هي وسيطُ ما بيع فعلاً في آخر ثمانية أسابيع مستورَدة، ومعه أدناه وأعلاه — ما يحتاجه
 * التحضيرُ والطلب: «الخميسُ عادةً ٤٢ لاتيه، بين ٣٥ و٥١».
 *
 * ولا تُقال عادةٌ على تاريخٍ ناقص: أسبوعٌ فيه أقلّ من ستّة أيّامٍ بمبيعات لا يُحسب،
 * ودون ستّة أسابيع صالحة تُحجب كلُّها ويُقال كم ينقص. ويومٌ بلا أيّ بيعة **غيرُ معروف**
 * (مغلقٌ أو ملفٌّ ناقص) لا صفر؛ أمّا يومٌ بيع فيه غيرُ هذا الصنف فصفرُه حقيقيّ.
 * والكمّيّاتُ أعدادٌ صحيحة بالمِلّي.
 */
import { dayOfWeek } from "../inventory/week";
import { addDays } from "@/lib/riyadh-time";

export const HABIT_WEEKS = 8;
export const HABIT_MIN_WEEKS = 6;
/** أقلُّ أيّامٍ بمبيعاتٍ في الأسبوع ليُحسب — يومُ إغلاقٍ واحد لا يُسقطه. */
export const HABIT_MIN_DAYS_PER_WEEK = 6;

export interface DaySale {
  /** `YYYY-MM-DD` */
  day: string;
  itemId: string;
  itemName: string;
  /** الكمّيّةُ المباعة بالمِلّي (٣ أكواب = 3000). */
  quantityMilli: number;
}

export interface WeekdayStat {
  /** وسيطُ الكمّيّة بالمِلّي — `null` لا يومَ صالحاً لهذا اليوم من الأسبوع. */
  medianMilli: number | null;
  minMilli: number | null;
  maxMilli: number | null;
  /** كم يوماً بُني عليه. */
  samples: number;
}

export interface ItemHabit {
  itemId: string;
  itemName: string;
  /** سبعةٌ من الأحد (0) إلى السبت (6). */
  byWeekday: WeekdayStat[];
  /** مجموعُ ما بيع في الأسابيع الصالحة — للترتيب. */
  totalMilli: number;
}

export interface WeekdayHabit {
  /** الأسابيعُ الصالحة التي بُنيت عليها العادة (بدايةُ كلٍّ، الأحد). */
  usableWeeks: string[];
  /** أسابيعُ النافذة التي أُسقطت لنقص أيّامها. */
  droppedWeeks: string[];
  /** `false` دون ستّة أسابيع صالحة — و`items` فارغة. */
  ready: boolean;
  items: ItemHabit[];
}


/** 0 الأحد … 6 السبت. */
export const weekdayOf = dayOfWeek;

/** وسيطُ أعدادٍ صحيحة — وسطُ الاثنين الأوسطين مقرَّباً إلى المِلّي. */
export function medianInt(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * @param lastWeekStart بدايةُ آخر أسبوعٍ اكتمل (أحد) — النافذةُ ثمانيةُ أسابيع تنتهي به.
 */
export function buildWeekdayHabit(sales: readonly DaySale[], lastWeekStart: string): WeekdayHabit {
  const weekStarts = Array.from({ length: HABIT_WEEKS }, (_, i) => addDays(lastWeekStart, -7 * (HABIT_WEEKS - 1 - i)));
  const windowStart = weekStarts[0];
  const windowEnd = addDays(lastWeekStart, 6);
  const inWindow = sales.filter((s) => s.day >= windowStart && s.day <= windowEnd);

  const soldDays = new Set(inWindow.map((s) => s.day));
  const usableWeeks: string[] = [];
  const droppedWeeks: string[] = [];
  for (const start of weekStarts) {
    const covered = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => soldDays.has(d)).length;
    (covered >= HABIT_MIN_DAYS_PER_WEEK ? usableWeeks : droppedWeeks).push(start);
  }
  if (usableWeeks.length < HABIT_MIN_WEEKS) return { usableWeeks, droppedWeeks, ready: false, items: [] };

  /* الأيّامُ الصالحة: يومٌ فيه بيعٌ ما، داخل أسبوعٍ صالح */
  const usableDays = usableWeeks.flatMap((start) => Array.from({ length: 7 }, (_, i) => addDays(start, i))).filter((d) => soldDays.has(d));
  const usable = new Set(usableDays);

  const names = new Map<string, string>();
  const perItemDay = new Map<string, Map<string, number>>();
  for (const s of inWindow) {
    if (!usable.has(s.day)) continue;
    names.set(s.itemId, s.itemName);
    const days = perItemDay.get(s.itemId) ?? new Map<string, number>();
    days.set(s.day, (days.get(s.day) ?? 0) + s.quantityMilli);
    perItemDay.set(s.itemId, days);
  }

  const items: ItemHabit[] = [...perItemDay].map(([itemId, days]) => {
    const byWeekday: WeekdayStat[] = Array.from({ length: 7 }, (_, wd) => {
      /* يومٌ صالح لم يُبع فيه هذا الصنف: صفرٌ حقيقيّ يدخل الوسيط */
      const values = usableDays.filter((d) => weekdayOf(d) === wd).map((d) => days.get(d) ?? 0);
      return values.length === 0
        ? { medianMilli: null, minMilli: null, maxMilli: null, samples: 0 }
        : { medianMilli: medianInt(values), minMilli: Math.min(...values), maxMilli: Math.max(...values), samples: values.length };
    });
    return { itemId, itemName: names.get(itemId) ?? itemId, byWeekday, totalMilli: [...days.values()].reduce((s, v) => s + v, 0) };
  }).sort((a, b) => b.totalMilli - a.totalMilli || a.itemId.localeCompare(b.itemId));

  return { usableWeeks, droppedWeeks, ready: true, items };
}

export const WEEKDAY_LABEL: readonly string[] = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** الكمّيّةُ من المِلّي عدداً يُقرأ: «42» أو «41.5» — بحسابٍ صحيح، خانةٌ عشريّة على الأكثر. */
export function unitsText(milli: number): string {
  const tenths = Math.round(milli / 100);
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
}
