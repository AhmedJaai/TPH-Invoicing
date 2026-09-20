/**
 * قراءةُ قيم الخلايا — وما لا يُقرأ يُعلَن، لا يُقرأ صفراً.
 */
import { parseRiyals } from "@/lib/money";
import { decimalToMilli } from "@/lib/inventory/units";

/** الأرقام العربية‑الهندية إلى اللاتينية، وإسقاطُ فواصل الآلاف. */
export function normaliseNumeric(raw: string): string {
  return raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[,٬  \s]/g, "");
}

/** الكمّيّة بالمِلّي، أو `null` — «لم تُقرأ». */
export function parseQuantityMilli(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = normaliseNumeric(raw);
  if (text === "") return null;
  return decimalToMilli(text);
}

/** مبلغٌ بالهللات، أو `null`. والخانةُ الفارغة `null` لا صفر. */
export function parseMoneyMinor(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (text === "") return null;
  return parseRiyals(text);
}

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "نعم", "صح", "مرتجع", "ملغي", "ملغاة", "ملغى", "مجاني", "مجانية"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "", "-", "لا", "خطأ"]);

/**
 * عَلَمٌ منطقيّ.
 *
 * ويُرجع `null` لما لم يُفهَم — فيُقرأ «غير معروف» ولا يُقرأ «لا».
 * وقراءةُ المجهول «لا» في عمود «ملغاة» تُدخل بيعةً لم تقع.
 */
export function parseFlag(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const text = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  return null;
}

/* ───────────────────────── التواريخ ───────────────────────── */

export type DateOrder = "ISO" | "DMY" | "MDY" | "AMBIGUOUS";

const ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
const SLASH = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/;
/** يومُ إكسل الصفر: ٣٠ ديسمبر ١٨٩٩ — ونظامُ ١٩٠٠ فيه يومُ كبيسٍ وهميّ. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * ترتيبُ اليوم والشهر في الملفّ — يُستنتَج من الملفّ كلّه لا من صفّ.
 *
 * فصفٌّ واحد فيه `03/09` لا يقول شيئاً؛ وصفٌّ فيه `13/09` يقطع بأنّ
 * اليومَ أوّلاً. وإن لم يقطع شيءٌ فالحكمُ `AMBIGUOUS` — **ويُعلَن
 * الافتراض**، ولا يُبتلَع.
 */
export function detectDateOrder(samples: readonly string[]): DateOrder {
  let sawIso = false;
  let dayFirst = false;
  let monthFirst = false;

  for (const s of samples) {
    const text = normaliseNumeric(s).slice(0, 10);
    if (ISO.test(text)) { sawIso = true; continue; }
    const m = SLASH.exec(text);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) dayFirst = true;
    if (b > 12) monthFirst = true;
  }

  if (dayFirst && !monthFirst) return "DMY";
  if (monthFirst && !dayFirst) return "MDY";
  if (dayFirst && monthFirst) return "AMBIGUOUS";
  if (sawIso) return "ISO";
  return "AMBIGUOUS";
}

/**
 * يومُ العمل `YYYY-MM-DD`، أو `null`.
 *
 * ولا `new Date(text)` — تحليلُ المتصفّح للنصوص يتبع منطقةَ الجلسة،
 * فيصير «٢٠٢٦‑٠٩‑٠١» يومَ ٣١ أغسطس في منطقةٍ سالبة. الدرسُ مكتوبٌ في
 * `032` و`riyadh-time.ts`، ولا يُعاد هنا.
 */
export function parseBusinessDate(raw: string | undefined, order: DateOrder = "ISO"): string | null {
  if (raw === undefined) return null;
  const text = normaliseNumeric(raw);
  if (text === "") return null;

  const iso = ISO.exec(text);
  if (iso) {
    const [, y, m, d] = iso.map(Number) as unknown as [string, number, number, number];
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }

  const slash = SLASH.exec(text);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = Number(slash[3]);
    /* ما قطع به الملفّ يغلب الافتراض؛ وما جاوز ١٢ يقطع بنفسه */
    const dayFirst = a > 12 ? true : b > 12 ? false : order !== "MDY";
    const d = dayFirst ? a : b;
    const m = dayFirst ? b : a;
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }

  /* رقمُ إكسل التسلسليّ — يرد حين يُصدَّر العمود تاريخاً بلا تنسيق */
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20_000 && serial < 80_000) {
      return new Date(EXCEL_EPOCH + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
    }
  }

  return null;
}

/** وقتُ البيع إن ذُكر — وإلّا منتصفُ يوم العمل، فالترتيبُ يبقى مستقيماً. */
export function parseSoldAt(raw: string | undefined, businessDate: string): Date {
  const time = raw ? /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(normaliseNumeric(raw)) : null;
  const [y, m, d] = businessDate.split("-").map(Number);
  if (!time) return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Date(Date.UTC(y, m - 1, d, Number(time[1]), Number(time[2]), Number(time[3] ?? 0)));
}
