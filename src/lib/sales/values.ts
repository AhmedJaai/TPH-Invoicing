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

/**
 * كلفةُ المصدر — **إعلاميّةٌ لا يُقوَّم بها فرق**.
 *
 * ── ولماذا قارئٌ مستقلّ ──
 *
 * فودكس يكتب الكلفة بخمس منازل (`2.92246`)، و`parseRiyals` يردّ ما
 * جاوز منزلتين عن قصد: مبلغٌ لا يُمثَّل بالهللات حسمُه تخمين. وذلك
 * الحارسُ صحيحٌ في **مال الفواتير**، ولا يُضعَّف من أجل رقمٍ إعلاميّ.
 *
 * فالكلفةُ تُقرَّب هنا وتُحفَظ للمقارنة وحدها. **ولا يُبنى عليها تقييمُ
 * فرقٍ يُعرَض**: الغايةُ من النظام فحصُ حساب فودكس استقلالاً، فلو
 * قُوِّم الفرقُ بكلفته لصار الفحصُ دائريّاً.
 */
export function parseSourceCostMinor(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = normaliseNumeric(raw);
  if (text === "" || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Math.round(Number(text) * 100);
  return Number.isSafeInteger(value) ? value : null;
}

/*
  ── ولا قارئَ لعَلَمٍ منطقيّ ──

  كان هنا `parseFlag` يقرأ «نعم/لا» لأعمدةِ «ملغاة» و«مرتجَعة». وفحصُ
  التصدير الحقيقيّ أسقطه: فودكس لا يحمل أعلاماً منطقيّة أصلاً — يحمل
  **حالاً نصّيّة** في عمود `status` (`Done` · `Returned` · `Void`).
  فحُذف بدل أن يبقى صادراً لا يستدعيه شيء.
*/

/* ───────────────────────── التواريخ ───────────────────────── */

export type DateOrder = "ISO" | "DMY" | "MDY" | "AMBIGUOUS";

const ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
/**
 * صيغةُ الشرطة المائلة — والسنةُ خانتان أو أربع.
 *
 * تصديرُ فودكس الحقيقيّ يُصيَّر «9/19/26»: سنةٌ من خانتين. ومحلِّلٌ
 * يطلب أربعاً يردّ **كلّ صفٍّ في الملفّ** — وذلك يُقرأ «الملفّ غير
 * مفهوم» بينما هو مفهومٌ تماماً.
 */
const SLASH = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})/;
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
    /*
      سنةٌ من خانتين تُردّ إلى قرنها: ٦٩ فما دون ← ٢٠xx، وما فوقها ←
      ١٩xx. وهو اصطلاحُ إكسل نفسِه، فلا يُخترَع هنا اصطلاحٌ ثانٍ.
    */
    const rawYear = Number(slash[3]);
    const y = slash[3].length === 2 ? (rawYear <= 69 ? 2000 + rawYear : 1900 + rawYear) : rawYear;
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
