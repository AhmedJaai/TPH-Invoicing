/**
 * التنبّؤُ الحيّ لليوم الجاري — ما بيع حتى الساعة + المتوقَّع لما بقي من ساعاته.
 *
 * جرّب الاختبارُ الرجوعيّ (٤٩ يوماً) أن يُصحَّح الباقي بنسبة ما ظهر صباحاً فخسر: مبيعاتُ
 * الصباح لا تنبئ بالليل هنا (٤٥٪ خطأً عند الظهر مقابل ١٢٪ بلا تصحيح). فالباقي يبقى كما
 * تُنبّئ به ساعاتُه، والخطأُ يضيق وحده كلّما مضت ساعة: ١٢٪ صباحاً ← ١٠٪ عند الثامنة ← ٧٪
 * عند العاشرة ليلاً.
 *
 * ويومُ العمل يومُ «نبض المقهى» نفسُه (`lib/pulse.ts`): يبدأ الخامسةَ فجراً، فالساعاتُ ٠–٤ آخرُه لا أوّلُه.
 * والمالُ هللاتٌ صحيحة.
 */

import { BUSINESS_HOURS } from "@/lib/pulse";

export { BUSINESS_HOURS };

export interface HourForecast {
  hour: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface Nowcast {
  /** ما بيع فعلاً في الساعات التي انتهت والساعة الجارية. */
  soldMinor: number;
  /** المتوقَّعُ لليوم كلّه بعد ما ظهر. */
  p10: number;
  p50: number;
  p90: number;
  /** نصيبُ ما مضى من اليوم في المتوقَّع (٠–١) — كم صار الرقمُ واقعاً لا تنبّؤاً. */
  elapsedShare: number;
}

/**
 * @param hours  تنبّؤُ ساعات اليوم (من المحرّك).
 * @param actual ما بيع في كلّ ساعة حتى الآن.
 * @param nowHour ساعةُ الرياض الآن (0–23).
 * @param day    مدى اليوم كلّه — مدى الباقي يُقاس به لا بمدى كلّ ساعة: حدودُ الساعة الواحدة
 *               تنزل إلى الصفر (ساعةٌ بلا بيع شائعة)، فمجموعُها مدىً أعرضُ من الحقيقة بكثير.
 */
export function nowcastDay(hours: readonly HourForecast[], actual: ReadonlyMap<number, number>, nowHour: number, day?: { p10: number; p50: number; p90: number }): Nowcast {
  const pos = BUSINESS_HOURS.indexOf(nowHour);
  const byHour = new Map(hours.map((h) => [h.hour, h]));
  let sold = 0;
  let restLo = 0;
  let restMid = 0;
  let restHi = 0;
  let total = 0;
  let elapsed = 0;
  BUSINESS_HOURS.forEach((h, i) => {
    const f = byHour.get(h);
    const a = actual.get(h) ?? 0;
    total += f?.p50 ?? 0;
    if (i < pos) {
      sold += a;
      elapsed += f?.p50 ?? 0;
    } else if (i === pos) {
      /* الساعةُ الجارية: ما بيع فيها حدٌّ أدنى، والمتوقَّعُ لها ما زال ممكناً */
      sold += a;
      const left = Math.max(0, (f?.p50 ?? 0) - a);
      restMid += left;
      restLo += Math.max(0, (f?.p10 ?? 0) - a);
      restHi += Math.max(0, (f?.p90 ?? 0) - a);
      elapsed += Math.min(a, f?.p50 ?? 0);
    } else {
      restLo += f?.p10 ?? 0;
      restMid += f?.p50 ?? 0;
      restHi += f?.p90 ?? 0;
    }
  });
  if (day && day.p50 > 0) {
    restLo = Math.round(restMid * Math.min(1, day.p10 / day.p50));
    restHi = Math.round(restMid * Math.max(1, day.p90 / day.p50));
  }
  return {
    soldMinor: sold,
    p10: sold + restLo,
    p50: sold + restMid,
    p90: sold + restHi,
    elapsedShare: total > 0 ? Math.min(1, elapsed / total) : 0,
  };
}

/** نسبةُ الخطأ المطلق بالنقطة الأساس — `null` إن لم يُبَع شيء (لا قسمة على صفر). */
export function errorBp(forecast: number, actual: number): number | null {
  if (actual <= 0) return null;
  return Math.round(((forecast - actual) / actual) * 10_000);
}
