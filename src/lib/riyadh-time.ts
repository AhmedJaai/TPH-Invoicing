/**
 * «اليوم» و«الشهر الجاري» بتوقيت الرياض — لا بتوقيت الخادم.
 *
 * كان يُكتب `new Date().toISOString().slice(0, 7)` وهو شهر UTC. فمن
 * منتصف ليل أوّل الشهر حتى الثالثة فجراً بتوقيت الرياض يُختار الشهر
 * الخطأ: «دفعة أوّل الشهر» تعرض شهراً قبل المقصود، و«الإقفال» يقترح
 * الشهر السابق للسابق، والمقارنة تعود «▼ ٩٨٪».
 */
const RIYADH = "Asia/Riyadh";

function parts(at: Date): { year: string; month: string; day: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** YYYY-MM-DD بتوقيت الرياض. */
export function todayInRiyadh(at: Date = new Date()): string {
  const { year, month, day } = parts(at);
  return `${year}-${month}-${day}`;
}

/** YYYY-MM بتوقيت الرياض. */
export function currentMonthRiyadh(at: Date = new Date()): string {
  return todayInRiyadh(at).slice(0, 7);
}

/** رقم اليوم من الشهر بتوقيت الرياض. */
export function dayOfMonthRiyadh(at: Date = new Date()): number {
  return Number(parts(at).day);
}
