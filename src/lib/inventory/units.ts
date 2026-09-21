/**
 * الكمّيّة عددٌ صحيح — كما أنّ المال عددٌ صحيح.
 *
 * ── لماذا ──
 *
 * حسابُ الجرد يضرب ويجمع آلافَ المرّات: مئةُ صنفٍ في أسبوعٍ فيه ألفا
 * بيعة. والفاصلةُ العائمة تُنتج `0.1 + 0.2 = 0.30000000000000004`،
 * فيصير مجموعُ ألفِ سطرٍ مختلفاً عن مجموع الألفِ نفسِه بترتيبٍ آخر —
 * **ورقمٌ يتغيّر بترتيب جمعه ليس رقماً**. وهو الدرسُ نفسه الذي جعل
 * المال هللاتٍ صحيحة منذ اليوم الأوّل.
 *
 * ── الوحدة الداخليّة ──
 *
 * كلُّ كمّيّة تُحسَب بـ**المِلّي من أصغر وحدةٍ في عائلتها**:
 *
 *   الوزن  → مِلّي‑جرام   (١ كجم = ‏١٬٠٠٠٬٠٠٠)
 *   الحجم  → مِلّي‑مليلتر (١ لتر = ‏١٬٠٠٠٬٠٠٠)
 *   العدّ  → مِلّي‑حبّة   (١ حبّة = ‏١٬٠٠٠)
 *
 * فـ١٨ جراماً = ‏١٨٬٠٠٠، و١٠٠ مشروبٍ × ١٨ جراماً = ‏١٬٨٠٠٬٠٠٠ بالضبط،
 * لا «1.7999999». والمِلّي تكفي: أدقُّ ما يُكتب في وصفةٍ جزءٌ من ألف
 * من الجرام، وأثقلُ ما في مقهىً لا يبلغ طنّين (حدُّ العدد الصحيح
 * الآمن في جافاسكربت أبعدُ من ذلك بكثير).
 *
 * ── ولا جسر بين الوزن والحجم ──
 *
 * كما في `unit-conversion.ts` حرفاً بحرف: لترُ الحليب ليس كيلواً،
 * ولترُ الزيت أبعد. **والحبّةُ ليست عبوة** أيضاً: هما من عائلة العدّ
 * ولا معامِلَ بينهما بلا حجمِ عبوةٍ معلوم — فلكلٍّ منهما عائلتُه هنا،
 * وإلّا لصار «عشرون عبوة» و«عشرون حبّة» سواءً في المعادلة.
 */
import { type StoredUnit, storedUnitLabel } from "@/lib/unit-conversion";

/** كم مِلّي‑وحدةٍ صغرى في مِلّي‑واحدٍ من هذه الوحدة. */
const IN_SMALLEST: Record<StoredUnit, number> = {
  KG: 1000, G: 1,
  L: 1000, ML: 1,
  PIECE: 1, PACK: 1,
};

/**
 * عائلةُ الوحدة — وما اختلفت عائلتُه لا يُحوَّل ولا يُجمَع.
 *
 * والعدُّ يُفرَّق فيه بين الحبّة والعبوة (`COUNT:PIECE` و`COUNT:PACK`):
 * ‏`unit-conversion.convert` يردّ التحويلَ بينهما بـ`null` صراحةً،
 * فلو جُمعا هنا تحت عائلةٍ واحدة لتناقض الملفّان.
 */
export function unitFamily(unit: StoredUnit): string {
  if (unit === "KG" || unit === "G") return "MASS";
  if (unit === "L" || unit === "ML") return "VOLUME";
  return `COUNT:${unit}`;
}

export function sameUnitFamily(a: StoredUnit, b: StoredUnit): boolean {
  return unitFamily(a) === unitFamily(b);
}

/** ١ من الوحدة، بالمِلّي. */
export const MILLI = 1000;

/**
 * من مِلّي‑الوحدة المذكورة إلى مِلّي‑الوحدة الصغرى في عائلتها.
 *
 * ‏١٨٬٠٠٠ مِلّي‑جرام تبقى ‏١٨٬٠٠٠؛ و‏١٨٬٠٠٠ مِلّي‑كيلو تصير
 * ‏١٨٬٠٠٠٬٠٠٠ مِلّي‑جرام.
 */
export function toCanonical(quantityMilli: number, unit: StoredUnit): number {
  return quantityMilli * IN_SMALLEST[unit];
}

/**
 * والعكس — وقد يكون كسراً، فهو للعرض لا للحساب.
 *
 * ‏١٨٬٠٠٠ مِلّي‑جرام بوحدة الكيلو = ‏١٨ مِلّي‑كيلو = ‏٠٫٠١٨ كجم.
 */
export function fromCanonical(canonical: number, unit: StoredUnit): number {
  return canonical / IN_SMALLEST[unit];
}

/** الكمّيّة المعياريّة بوحدتها، رقماً عشرياً — **للعرض وحده**. */
export function canonicalToQuantity(canonical: number, unit: StoredUnit): number {
  return canonical / (IN_SMALLEST[unit] * MILLI);
}

/**
 * يحوّل بين وحدتين، ويُرجع `null` حين لا يصحّ.
 *
 * ولا يُرجع الكمّيّةَ كما هي عند العجز — وذاك بالضبط ما يجعل كرتوناً
 * يُقارَن بلتر.
 */
export function convertMilli(
  quantityMilli: number,
  from: StoredUnit,
  to: StoredUnit,
): number | null {
  if (!sameUnitFamily(from, to)) return null;
  return toCanonical(quantityMilli, from) / IN_SMALLEST[to];
}

/* ───────────────────── قراءةُ العدد العشريّ ───────────────────── */

const DECIMAL = /^\s*([+-]?)(\d*)(?:[.,](\d*))?\s*$/;

/**
 * نصٌّ عشريّ ← مِلّي، **بلا فاصلةٍ عائمة في الطريق**.
 *
 * ‏`Number("0.333") * 1000` يعطي `333.00000000000006`. والتقريبُ بعده
 * يصحّحه هنا ولا يصحّحه في كلّ مكان — والأسلمُ ألّا يمرّ العددُ
 * بالعائمة أصلاً: تُقرأ خاناتُ الكسر حروفاً وتُكمَل إلى ثلاث.
 *
 * وما زاد عن ثلاث خاناتٍ **يُقرَّب ولا يُقصّ**: القصُّ يُنقص دائماً،
 * فألفُ سطرٍ مقصوصٍ يعطي نقصاً حقيقياً في الجرد.
 *
 * ويُرجع `null` لما ليس عدداً — لا صفراً. فالصفرُ يُقرأ «لا شيء»
 * والمقصودُ «لم يُقرأ».
 */
export function decimalToMilli(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * MILLI);
  }

  const m = DECIMAL.exec(value);
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  if (whole === "" && frac === "") return null;

  const sig = sign === "-" ? -1 : 1;
  const intPart = whole === "" ? 0 : Number(whole);
  if (!Number.isSafeInteger(intPart)) return null;

  /* ثلاثُ خاناتٍ تُقرأ، والرابعةُ تُقرِّب ما قبلها */
  const padded = (frac + "0000").slice(0, 4);
  const milliFromFrac = Math.round(Number(padded) / 10);

  return sig * (intPart * MILLI + milliFromFrac);
}

/** ومِلّي ← نصٌّ عشريّ بثلاث خانات، لحفظه في عمود `numeric(…, 3)`. */
export function milliToDecimal(milliValue: number): string {
  const sign = milliValue < 0 ? "-" : "";
  const abs = Math.abs(Math.round(milliValue));
  return `${sign}${Math.floor(abs / MILLI)}.${String(abs % MILLI).padStart(3, "0")}`;
}

/* ───────────────────── العرض ───────────────────── */

/**
 * كمّيّةٌ معياريّة تُعرَض بوحدة صنفها.
 *
 * وتُقرَّب إلى ثلاث خاناتٍ ثمّ تُقصّ أصفارُها: «٢ كجم» لا «٢٫٠٠٠ كجم»،
 * و«٢٫٥ كجم» لا «٢٫٥٠٠».
 */
export function formatQuantity(canonical: number | null, unit: StoredUnit): string {
  if (canonical === null) return "غير معروف";
  const value = canonicalToQuantity(canonical, unit);
  const rounded = Math.round(value * 1000) / 1000;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${text} ${storedUnitLabel(unit)}`;
}

/** وبإشارةٍ صريحة — الفرقُ يُقرأ باتّجاهه قبل مقداره. */
export function formatSignedQuantity(canonical: number | null, unit: StoredUnit): string {
  if (canonical === null) return "غير معروف";
  const body = formatQuantity(Math.abs(canonical), unit);
  if (canonical === 0) return body;
  return `${canonical > 0 ? "+" : "−"}${body}`;
}
