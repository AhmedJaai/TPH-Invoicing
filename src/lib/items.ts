/**
 * تطبيع أسماء الأصناف.
 *
 * المورّد يكتب الصنف نفسه بصيغ مختلفة بين فاتورة وأخرى: «حليب طازج ٢ لتر»
 * و«حليب طازج 2ل» و«Fresh Milk 2L». وبلا توحيدها لا يوجد تتبّع سعر ولا
 * تحليل استهلاك — تصير كل صيغة صنفاً مستقلاً.
 *
 * التطبيع محافظ عمداً: يوحّد الشكل ولا يحذف معنى. «حليب كامل الدسم» و«حليب
 * خالي الدسم» يبقيان صنفين مختلفين، لأنّ دمجهما يفسد تحليل الاستهلاك.
 */

/** وحدات القياس الشائعة في فواتير المقهى وصيغها المختلفة. */
const UNIT_FORMS: Record<string, string> = {
  كجم: "kg", كيلو: "kg", كيلوجرام: "kg", كغم: "kg", kg: "kg", kilo: "kg",
  جم: "g", جرام: "g", غرام: "g", g: "g", gm: "g",
  لتر: "l", ل: "l", liter: "l", litre: "l", l: "l", ltr: "l",
  مل: "ml", ml: "ml",
  حبة: "pc", حبه: "pc", قطعة: "pc", قطعه: "pc", pc: "pc", pcs: "pc", piece: "pc",
  كرتون: "ctn", كرتونة: "ctn", كرتونه: "ctn", ctn: "ctn", carton: "ctn", box: "ctn", علبة: "ctn", علبه: "ctn",
  كيس: "bag", bag: "bag",
  عبوة: "pack", عبوه: "pack", pack: "pack", pkt: "pack",
};

/** يحوّل الأرقام العربية الهندية إلى لاتينية. */
function latinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * يطبّع وصف الصنف: حروف صغيرة، بلا تشكيل، همزات موحّدة، أرقام لاتينية،
 * وحدات موحّدة، ورموز محذوفة.
 */
export function normalizeItem(description: string): string {
  const base = latinDigits(description)
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "") // التشكيل
    .replace(/ـ/g, "") // التطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  // يفصل الرقم عن الوحدة الملتصقة به: "2l" ← "2 l"
  const spaced = base.replace(/(\d)\s*([\p{L}]+)/gu, "$1 $2");

  const words = spaced.split(/\s+/).filter(Boolean).map((w) => UNIT_FORMS[w] ?? w);
  return words.join(" ");
}

/** مفتاح تتبّع السعر: الصنف عند مورّد بعينه. السعر يُقارَن داخل المورّد لا عبره. */
export function priceKey(supplierId: string, description: string): string {
  return `${supplierId}::${normalizeItem(description)}`;
}

export interface PricePoint {
  date: Date;
  unitPriceMinor: number;
  invoiceNumber?: string | null;
}

export interface PriceChange {
  /** آخر سعر مسجّل */
  currentMinor: number;
  /** السعر السابق له */
  previousMinor: number;
  deltaMinor: number;
  /** نسبة التغيّر: 0.15 تعني ارتفاعاً بخمسة عشر بالمئة */
  deltaRatio: number;
  direction: "up" | "down";
  currentDate: Date;
  previousDate: Date;
}

/**
 * يقارن آخر سعرين مختلفين فعلاً.
 *
 * تجاهل التكرارات مقصود: عشر فواتير بالسعر نفسه ثم ارتفاع يجب أن تُظهر
 * الارتفاع، لا أن تقارن آخر فاتورتين متطابقتين وتقول «لا تغيير».
 */
export function detectPriceChange(history: readonly PricePoint[]): PriceChange | null {
  if (history.length < 2) return null;

  const sorted = [...history].sort((a, b) => b.date.getTime() - a.date.getTime());
  const current = sorted[0];

  const previous = sorted.slice(1).find((p) => p.unitPriceMinor !== current.unitPriceMinor);
  if (!previous) return null;

  const deltaMinor = current.unitPriceMinor - previous.unitPriceMinor;
  return {
    currentMinor: current.unitPriceMinor,
    previousMinor: previous.unitPriceMinor,
    deltaMinor,
    deltaRatio: previous.unitPriceMinor === 0 ? 0 : deltaMinor / previous.unitPriceMinor,
    direction: deltaMinor > 0 ? "up" : "down",
    currentDate: current.date,
    previousDate: previous.date,
  };
}

/** الأثر السنوي المقدَّر لتغيّر السعر، بناءً على الكمية المشتراة فعلاً. */
export function annualImpactMinor(change: PriceChange, quantityPerYear: number): number {
  return Math.round(change.deltaMinor * quantityPerYear);
}
