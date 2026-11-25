import { businessHourOrder } from "./performance";

/**
 * خريطةُ الأسبوع: كم يُباع في المتوسّط في كلّ ساعةٍ من كلّ يوم.
 *
 * «متى يُباع بالساعة» و«حسب أيام الأسبوع» كانا عمودين منفصلين، فلا يُعرف منهما
 * أنّ ذروةَ الخميس العاشرةُ ليلاً وذروةَ الأحد الثامنة — وهذا ما يُبنى عليه
 * جدولُ الدوام وعددُ الباريستا في كلّ ساعة.
 *
 * الخليّةُ متوسّطُ اليوم الواحد لا مجموعُ الشهر: الخميسُ في شهرٍ فيه خمسةُ أيام خميس
 * لا يُقارن بمجموع السبت في شهرٍ فيه أربعة. والمقسومُ عليه عددُ أيّام ذلك اليوم
 * التي بيع فيها، لا عددُ الخلايا التي بيع فيها: ساعةٌ لم يُبع فيها في يومٍ ما
 * تُحسب صفراً في ذلك اليوم، وإلّا انتفخ متوسّطُ الساعات الهادئة.
 *
 * يومُ العمل يبدأ قبل الفجر ويمتدّ بعد منتصف الليل، فالواحدةُ فجراً من يوم الخميس
 * تُنسب إلى الخميس (`business_date`) والأعمدةُ بترتيب يوم العمل.
 */

export interface HeatCell {
  hour: number;
  /** ٠ الأحد … ٦ السبت، من تاريخ يوم العمل. */
  weekday: number;
  paidMinor: number;
  orders: number;
}

export interface HeatmapView {
  /** الساعاتُ التي بيع فيها شيءٌ في الشهر، بترتيب يوم العمل. */
  hours: number[];
  /** الأيّامُ التي بيع فيها، والسبتُ أوّلُ الأسبوع. */
  rows: {
    weekday: number;
    days: number;
    cells: { hour: number; avgMinor: number; avgOrders: number; level: number }[];
  }[];
  peak: { weekday: number; hour: number; avgMinor: number } | null;
  /** أعلى متوسّطٍ في الخريطة — به تُقاس درجاتُ اللون. */
  maxAvgMinor: number;
}

/** عددُ درجات اللون؛ الصفرُ لما لم يُبع فيه شيء. */
export const HEAT_LEVELS = 5;

const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

export function buildHeatmap(cells: readonly HeatCell[], daysByWeekday: ReadonlyMap<number, number>): HeatmapView {
  const hours = [...new Set(cells.filter((c) => c.paidMinor > 0).map((c) => c.hour))].sort(
    (a, b) => businessHourOrder(a) - businessHourOrder(b),
  );
  const at = new Map<string, HeatCell>();
  for (const c of cells) at.set(`${c.weekday}:${c.hour}`, c);

  let maxAvgMinor = 0;
  let peak: HeatmapView["peak"] = null;
  const raw = WEEK_ORDER.filter((w) => (daysByWeekday.get(w) ?? 0) > 0).map((weekday) => {
    const days = daysByWeekday.get(weekday) ?? 0;
    const row = hours.map((hour) => {
      const c = at.get(`${weekday}:${hour}`);
      const avgMinor = c ? Math.round(c.paidMinor / days) : 0;
      const avgOrders = c ? c.orders / days : 0;
      if (avgMinor > maxAvgMinor) maxAvgMinor = avgMinor;
      if (avgMinor > 0 && (peak === null || avgMinor > peak.avgMinor)) peak = { weekday, hour, avgMinor };
      return { hour, avgMinor, avgOrders };
    });
    return { weekday, days, row };
  });

  return {
    hours,
    rows: raw.map(({ weekday, days, row }) => ({
      weekday,
      days,
      cells: row.map((c) => ({ ...c, level: heatLevel(c.avgMinor, maxAvgMinor) })),
    })),
    peak,
    maxAvgMinor,
  };
}

/** درجةُ اللون من ١ إلى `HEAT_LEVELS`، والصفرُ لما لم يُبع فيه. */
export function heatLevel(avgMinor: number, maxAvgMinor: number): number {
  if (avgMinor <= 0 || maxAvgMinor <= 0) return 0;
  return Math.max(1, Math.ceil((avgMinor / maxAvgMinor) * HEAT_LEVELS));
}

/** «٨ ص» و«١٠ م» — ساعةٌ بنظام الاثنتي عشرة كما يقولها أهلُ المقهى. */
export const hourLabel = (h: number) => (h === 0 ? "12 ص" : h < 12 ? `${h} ص` : h === 12 ? "12 م" : `${h - 12} م`);
