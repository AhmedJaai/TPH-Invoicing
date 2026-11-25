/**
 * نبضُ المقهى — ما بيع في يوم العمل حتى الآن، مقارَناً بيوم الأسبوع نفسه قبل أسبوع **حتى الساعة نفسها**.
 *
 * يومُ العمل يبدأ الخامسةَ فجراً: المقهى يفتح نحو الثامنة ويُغلق بعد الثانية ليلاً، فطلبُ الواحدة
 * ليلاً من يوم أمس (`business_date` في فودكس). والمقارنةُ بالساعة نفسها لا باليوم كلّه — يومٌ لم
 * ينتهِ يُقاس بما مضى من نظيره، وإلّا بدا كلُّ صباحٍ «−٨٠٪».
 *
 * دالّةٌ خالصة. المالُ هللاتٌ شاملةُ الضريبة (ما دفعه الزبائن)، والمجهولُ `null`.
 */

/** ساعةُ بدء يوم العمل بتوقيت الرياض. */
export const BUSINESS_DAY_START_HOUR = 5;

/** ترتيبُ الساعات في يوم العمل: ٥ … ٢٣ ثمّ ٠ … ٤. */
export const BUSINESS_HOURS: readonly number[] = Array.from({ length: 24 }, (_, i) => (i + BUSINESS_DAY_START_HOUR) % 24);

export interface HourSales { hour: number; paidMinor: number; orders: number }

export interface PulseInput {
  /** `YYYY-MM-DD` يومُ العمل الجاري. */
  businessDay: string;
  /** ساعةُ الآن بتوقيت الرياض (٠–٢٣). */
  nowHour: number;
  today: readonly HourSales[];
  /** اليومُ نفسه قبل أسبوع — كاملاً، للرسم. */
  lastWeek: readonly HourSales[];
  /** اليومُ نفسه قبل أسبوع حتى اللحظة نفسها — للمقارنة. */
  lastWeekToNow: { paidMinor: number; orders: number } | null;
  /** أمس كاملاً، ومتوسطُ أيّام الأسبوع نفسها قبله (حتى أربعة). */
  yesterday: { paidMinor: number; orders: number } | null;
  yesterdayUsualMinor: number | null;
  /** آخرُ مزامنةٍ ناجحة — ISO. */
  syncedAt: string | null;
}

export interface PulseView {
  businessDay: string;
  paidMinor: number;
  orders: number;
  avgOrderMinor: number | null;
  /** الفرقُ عن نظيره حتى الساعة نفسها، بنقاط الأساس (١٠٠ = ١٪) — `null` لا نظيرَ معروف. */
  vsLastWeekBp: number | null;
  lastWeekToNowMinor: number | null;
  /** أعمدةُ الساعات بترتيب يوم العمل، حتى آخر ساعةٍ فيها بيعٌ في أيٍّ من اليومين أو الآن. */
  hours: { hour: number; todayMinor: number | null; lastWeekMinor: number }[];
  peakMinor: number;
  yesterday: { paidMinor: number; orders: number; vsUsualBp: number | null } | null;
  syncedAt: string | null;
}

const bp = (now: number, before: number | null) => (before === null || before <= 0 ? null : Math.round(((now - before) * 10_000) / before));

export function buildPulse(i: PulseInput): PulseView {
  const paidMinor = i.today.reduce((s, h) => s + h.paidMinor, 0);
  const orders = i.today.reduce((s, h) => s + h.orders, 0);
  const todayBy = new Map(i.today.map((h) => [h.hour, h.paidMinor]));
  const weekBy = new Map(i.lastWeek.map((h) => [h.hour, h.paidMinor]));
  const nowIndex = BUSINESS_HOURS.indexOf(i.nowHour);
  /* الساعاتُ من أوّل بيعٍ في أيٍّ من اليومين إلى آخره — لا ساعاتُ الإغلاق الفارغة */
  const active = BUSINESS_HOURS.map((h, idx) => ({ h, idx })).filter(({ h }) => (todayBy.get(h) ?? 0) > 0 || (weekBy.get(h) ?? 0) > 0);
  const first = active.length ? active[0].idx : nowIndex;
  const last = Math.max(active.length ? active[active.length - 1].idx : nowIndex, nowIndex);
  const hours = BUSINESS_HOURS.slice(Math.min(first, nowIndex), last + 1).map((hour) => {
    const idx = BUSINESS_HOURS.indexOf(hour);
    return {
      hour,
      /* ساعةٌ لم تأتِ بعد ليست صفراً */
      todayMinor: idx > nowIndex ? null : todayBy.get(hour) ?? 0,
      lastWeekMinor: weekBy.get(hour) ?? 0,
    };
  });
  const peakMinor = hours.reduce((m, h) => Math.max(m, h.todayMinor ?? 0, h.lastWeekMinor), 0);
  return {
    businessDay: i.businessDay,
    paidMinor,
    orders,
    avgOrderMinor: orders > 0 ? Math.round(paidMinor / orders) : null,
    vsLastWeekBp: i.lastWeekToNow ? bp(paidMinor, i.lastWeekToNow.paidMinor) : null,
    lastWeekToNowMinor: i.lastWeekToNow?.paidMinor ?? null,
    hours,
    peakMinor,
    yesterday: i.yesterday ? { ...i.yesterday, vsUsualBp: bp(i.yesterday.paidMinor, i.yesterdayUsualMinor) } : null,
    syncedAt: i.syncedAt,
  };
}

/** يومُ العمل لساعةٍ ويومٍ بتوقيت الرياض: قبل الخامسة فجراً يومُ أمس. */
export function businessDayOf(riyadhDay: string, riyadhHour: number, addDays: (d: string, n: number) => string): string {
  return riyadhHour < BUSINESS_DAY_START_HOUR ? addDays(riyadhDay, -1) : riyadhDay;
}
