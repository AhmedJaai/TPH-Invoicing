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

/** كم يوماً مضى على يومٍ (`YYYY-MM-DD`) حتى اليوم بتوقيت الرياض. */
export function daysSinceRiyadh(day: string, at: Date = new Date()): number {
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((t(todayInRiyadh(at)) - t(day)) / 86_400_000);
}

/** YYYY-MM بتوقيت الرياض. */
export function currentMonthRiyadh(at: Date = new Date()): string {
  return todayInRiyadh(at).slice(0, 7);
}

/** رقم اليوم من الشهر بتوقيت الرياض. */
export function dayOfMonthRiyadh(at: Date = new Date()): number {
  return Number(parts(at).day);
}

/*
 * التاريخ كما يُقرأ، لا كما يُخزَّن.
 *
 * كان `toISOString().slice(0, 10)` في اثنتي عشرة صفحة: صيغةٌ أبطأ قراءةً
 * على الجوّال، **وبتوقيت UTC**. فإقفالٌ يقع الواحدة والنصف فجراً بتوقيت
 * الرياض يُكتب بتاريخ اليوم السابق — في سجلٍّ مرجعُه الزمن.
 *
 * وتبقى قيم ISO في `value` و`href` كما هي: الترتيب والترشيح يُقرآن آلةً،
 * وهذه للعين وحدها.
 */
const DAY_FORMAT = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: RIYADH, day: "numeric", month: "short", year: "numeric",
});

const MONTH_NAME = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: RIYADH, month: "long", year: "numeric",
});

function asDate(value: Date | string): Date {
  /* سلسلةُ يومٍ بلا وقت تُقرأ UTC، وهو ما كُتبت به — فلا تُزاح يوماً */
  return value instanceof Date ? value : new Date(`${value}T12:00:00Z`);
}

/** «14 سبتمبر 2026» بتوقيت الرياض. */
export function formatDay(value: Date | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = asDate(value);
  return Number.isNaN(d.getTime()) ? String(value) : DAY_FORMAT.format(d);
}

/** «أغسطس 2026» من `YYYY-MM`. */
export function formatMonth(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  return MONTH_NAME.format(new Date(`${month}-15T12:00:00Z`));
}

/** «من … إلى …» — لا سهمان متعاكسان في صفحتين. */
export function formatRange(from: Date | string, to: Date | string): string {
  return `من ${formatDay(from)} إلى ${formatDay(to)}`;
}
