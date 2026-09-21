/**
 * أسبوعُ الجرد: من الأحد إلى السبت.
 *
 * ── لماذا يُفرَض ولا يُترَك اختياراً ──
 *
 * الجردُ يُقفَل ليلةَ السبت، وفعليُّ الأسبوع هو افتتاحيُّ الذي يليه.
 * فلو بدأ أحدُهما الأربعاء وانتهى الثلاثاء لانقطعت السلسلة: يومان لا
 * يدخلان جرداً، أو يومان يدخلان جردين. والمعادلةُ نفسُها تنهار —
 * «افتتاحيّ + مشتريات − استهلاك − هدر = المتوقَّع» تفترض أنّ افتتاحيَّ
 * الفترة هو ختاميُّ سابقتها بلا فجوة.
 *
 * ومؤثِّرُ `037` يمنع **التداخل**، وهذا يمنع **الفجوة** — والاثنان
 * وجهان لسلسلةٍ متّصلة.
 *
 * ── والحسابُ بتوقيت الرياض ──
 *
 * `new Date().getDay()` يقرأ يومَ الخادم. وخادمُ فيرسل بتوقيت UTC،
 * فمن منتصف ليل الأحد حتى الثالثة فجراً يقول «السبت» — فيُقترَح
 * أسبوعٌ كامل قبل المقصود. وتاريخُ البيعة `business_date` مكتوبٌ
 * بيوم العمل أصلاً، فيلتقيان.
 */
import { todayInRiyadh } from "@/lib/riyadh-time";

/** الفترةُ بيومَيها، شاملةً الطرفين. */
export interface Week {
  /** الأحد — YYYY-MM-DD. */
  start: string;
  /** السبت — YYYY-MM-DD. */
  end: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** يومُ الأسبوع بلا `Date` محلّيّة: ٠ الأحد … ٦ السبت. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** يزيح تاريخاً أيّاماً — نصّاً إلى نصّ. */
export function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** الأسبوعُ الذي يقع فيه هذا اليوم: أحدُه وسبتُه. */
export function weekOf(date: string): Week {
  if (!DATE.test(date)) throw new Error("التاريخ يُكتب YYYY-MM-DD");
  const start = shiftDays(date, -dayOfWeek(date));
  return { start, end: shiftDays(start, 6) };
}

/**
 * آخرُ أسبوعٍ **اكتمل** — لا الأسبوع الجاري.
 *
 * فالجردُ يقع بعد تقفيلة السبت، ويُعَدّ على أسبوعٍ انتهى. ولو اقتُرح
 * الجاري لخرج فرقٌ سببُه أنّ الأيّام لم تمضِ بعد، لا أنّ شيئاً ضاع.
 * ويوم السبت نفسُه أسبوعُه لم ينتهِ حتّى تقفيلته — فيبقى المقترَح
 * السابقَ إلى أن يبدأ الأحد.
 */
export function lastCompleteWeek(today: string = todayInRiyadh()): Week {
  return weekOf(shiftDays(weekOf(today).start, -1));
}

/** أهذه الفترةُ أسبوعٌ كامل من أحدٍ إلى سبت؟ */
export function isInventoryWeek(start: string, end: string): boolean {
  if (!DATE.test(start) || !DATE.test(end)) return false;
  return dayOfWeek(start) === 0 && dayOfWeek(end) === 6 && shiftDays(start, 6) === end;
}

/** الأسبوعُ الذي يلي هذا — لتسلسلٍ بلا فجوة. */
export function nextWeek(week: Week): Week {
  return weekOf(shiftDays(week.end, 1));
}

/** «أسبوع ١٣–١٩ سبتمبر» — تسميةٌ تُقرأ في قائمةٍ من الجردات. */
export function weekLabel(week: Week): string {
  return `الأحد ${week.start} — السبت ${week.end}`;
}
