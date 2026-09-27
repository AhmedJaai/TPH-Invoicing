/**
 * بندُ الفاتورة وصنفُ الجرد — اسمان مختلفان لشيءٍ واحد.
 *
 * طلبه أحمد (٢٧ سبتمبر ٢٠٢٦): «أسماء المنتجات في الوصفات غيرُ أسمائها في
 * فواتير الشراء». فالفاتورة تقول «1 كيلو اوغندا اميولو مقطرة اكياس بيضاء»،
 * والوصفةُ تقول «بنّ إسبريسو». والجردُ يحسب المشتريات من البند **إن** رُبط
 * صنفُ المورّد بصنف الجرد (`supplier_products.product_id`) **وعُرف ما في
 * الوحدة الواحدة** (`pack_size × content_quantity content_unit`) — وبلا الثاني
 * يبقى البندُ «مواصفةُ عبوة المورّد غير معروفة» ولو رُبط.
 *
 * وهذا الملفّ **يقترح** ولا يقرّر: تخمينُ ما في الوحدة من نصّ البند، وأقربُ
 * أصناف الجرد اسماً. والإنسانُ يؤكّد (درس «العنب»: الاسمُ المتشابه ليس هويّة).
 */
import type { StoredUnit } from "@/lib/unit-conversion";

export interface PackGuess {
  /** كم عبوةً صغرى في الوحدة الواحدة من الفاتورة — «12» في «12 × 1 لتر». */
  packSize: string;
  /** كم في العبوة الصغرى — «1». */
  contentQuantity: string;
  contentUnit: StoredUnit;
}

const UNIT_WORDS: { re: RegExp; unit: StoredUnit }[] = [
  { re: /^(كيلو(جرام|غرام)?|كجم|كغ|kg|kgs|kilo)$/i, unit: "KG" },
  { re: /^(جرام|غرام|جم|غ|gm|gr|g|grams?)$/i, unit: "G" },
  { re: /^(لتر|ل|l|ltr|liters?|litres?)$/i, unit: "L" },
  { re: /^(مل|مليلتر|ملي|ml)$/i, unit: "ML" },
];

const toAsciiDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[٫]/g, ".").replace(/[×xX*]/g, " × ");

function unitOf(word: string): StoredUnit | null {
  const w = word.replace(/[.,،]/g, "");
  return UNIT_WORDS.find((u) => u.re.test(w))?.unit ?? null;
}

/**
 * يخمّن ما في الوحدة الواحدة من نصّ البند — أو `null` إن لم يتبيّن.
 *
 *   «12 × 1 لتر حليب»  → 12 × 1 L
 *   «1 كيلو اوغندا»     → 1 × 1 KG
 *   «حليب 500 مل»       → 1 × 500 ML
 *   «24x250ml»          → 24 × 250 ML
 */
export function guessPackSpec(description: string): PackGuess | null {
  const text = toAsciiDigits(description)
    .replace(/(\d)([^\d\s.×])/g, "$1 $2")
    .replace(/([^\d\s.×])(\d)/g, "$1 $2");
  const tokens = text.split(/\s+/).filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    /* «12 × 1 لتر» */
    if (/^\d+(\.\d+)?$/.test(tokens[i]) && tokens[i + 1] === "×" && /^\d+(\.\d+)?$/.test(tokens[i + 2] ?? "")) {
      const unit = unitOf(tokens[i + 3] ?? "");
      if (unit) return { packSize: tokens[i], contentQuantity: tokens[i + 2], contentUnit: unit };
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    /* «1 كيلو» · «500 مل» */
    if (/^\d+(\.\d+)?$/.test(tokens[i])) {
      const unit = unitOf(tokens[i + 1] ?? "");
      if (unit && Number(tokens[i]) > 0) return { packSize: "1", contentQuantity: tokens[i], contentUnit: unit };
    }
  }
  return null;
}

/** الاسمُ للمقارنة: بلا تشكيلٍ ولا أرقامٍ ولا وحداتٍ ولا كلماتِ تعبئة. */
const NOISE = new Set([
  "كيس", "اكياس", "أكياس", "علبه", "علبة", "كرتون", "حبه", "حبة", "عبوه", "عبوة", "بيضاء", "ابيض", "اضافه", "إضافة", "استيكرات",
  "مقطره", "مقطرة", "و", "مع", "من", "في", "الى", "على",
]);

function tokensOf(s: string): string[] {
  return toAsciiDigits(s)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .split(/[^\p{L}]+/u)
    .map((w) => w.replace(/^ال/, ""))
    .filter((w) => w.length >= 2 && !NOISE.has(w) && !unitOf(w));
}

export interface StockOption {
  id: string;
  nameAr: string;
  nameEn?: string | null;
}

/**
 * أقربُ أصناف الجرد إلى نصّ البند — بالكلمات المشتركة، والأطولُ أثقل.
 * اقتراحٌ يُعرض أوّلاً في القائمة، لا ربطٌ يقع.
 */
export function suggestStockItem<T extends StockOption>(description: string, options: readonly T[]): T | null {
  const words = new Set(tokensOf(description));
  if (words.size === 0) return null;
  let best: { o: T; score: number } | null = null;
  for (const o of options) {
    const own = tokensOf(`${o.nameAr} ${o.nameEn ?? ""}`);
    const score = own.filter((w) => words.has(w)).reduce((s, w) => s + w.length, 0);
    if (score >= 3 && (!best || score > best.score)) best = { o, score };
  }
  return best?.o ?? null;
}
