/**
 * نافذةُ الجرد لكلّ شهر — من عدٍّ إلى عدّ.
 *
 * معادلةُ «افتتاحيّ + مشترى − مستهلَك − هدر − ختاميّ» لا تصحّ إلّا بين عدَّين. والعدُّ
 * أسبوعيٌّ ليلةَ السبت لا ليلةَ آخر الشهر؛ فنافذةُ الشهر تبدأ غداةَ أقرب عدٍّ لعشيّته
 * وتنتهي يومَ أقرب عدٍّ لآخره — وتُعرَض بتاريخَيها. والأشهرُ المتتالية تتلاصق: حدُّ
 * نهاية شهرٍ هو حدُّ بداية الذي يليه، فلا يومَ يُحسَب مرّتين ولا يسقط.
 *
 * وشهرٌ لا عدَّ قرب أحد طرفيه **لا نافذةَ له** — يُحسَب بأيّامه ويُقال «لا جرد يفصل
 * المخزون عن الفاقد».
 */
import { addDays, daysBetween, monthEndDay } from "@/lib/riyadh-time";

/** أبعدُ ما يُقبَل بين العدّ وطرف الشهر. أسبوعيٌّ فأقصاه نصفُ أسبوع. */
export const BOUNDARY_REACH_DAYS = 4;

/** أقربُ يومِ عدٍّ إلى `target` داخل المدى — وعند التساوي الأسبق. `null` لا عدَّ قريب. */
export function nearestCountDay(countDays: readonly string[], target: string): string | null {
  let best: string | null = null;
  let bestGap = BOUNDARY_REACH_DAYS + 1;
  for (const day of [...countDays].sort()) {
    const gap = Math.abs(daysBetween(target, day));
    if (gap < bestGap) { best = day; bestGap = gap; }
  }
  return best;
}

export interface StockWindow {
  month: string;
  /** أوّلُ يومٍ وآخرُ يومٍ يدخلان الحساب. */
  from: string;
  to: string;
  /** يومُ العدّ الافتتاحيّ (عشيّةَ `from`) والختاميّ (`to`) — `null` لا عدَّ هناك. */
  openingCountDay: string | null;
  closingCountDay: string | null;
}

/** الشهرُ السابق لـ`YYYY-MM`. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * نافذةُ الشهر. طرفٌ بلا عدٍّ يبقى على حدّ التقويم ويُعلَّم `null`؛ والشهرُ الجاري
 * ينتهي عند `lastDay` (آخر يومٍ فيه بيع) إن لم يبلغ آخرَه.
 */
export function stockWindow(month: string, countDays: readonly string[], lastDay: string | null = null): StockWindow {
  const calendarFrom = `${month}-01`;
  const calendarTo = monthEndDay(month);
  const openingCountDay = nearestCountDay(countDays, monthEndDay(previousMonth(month)));
  let closingCountDay = nearestCountDay(countDays, calendarTo);
  /* عدٌّ واحد لا يكون طرفَي الشهر معاً */
  if (closingCountDay !== null && closingCountDay === openingCountDay) closingCountDay = null;
  const from = openingCountDay ? addDays(openingCountDay, 1) : calendarFrom;
  let to = closingCountDay ?? calendarTo;
  if (closingCountDay === null && lastDay !== null && lastDay < to) to = lastDay;
  return { month, from, to, openingCountDay, closingCountDay };
}
