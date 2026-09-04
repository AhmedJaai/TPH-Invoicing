/**
 * الصنف المعياري: الاقتراح والتحقّق.
 *
 * الاسم لا يجمع ولا يفرّق. «حليب كامل الدسم ٢ لتر» و«Full Cream Milk 2L»
 * شيء واحد باسمين، و«عنب» عند المحمصة كيلو بنّ وعند لافا زجاجة كمبوتشا
 * شيئان باسم واحد. فأيّ ربط آليّ على الاسم وحده يُخطئ في الاتجاهين.
 *
 * لذلك هذا الملف **يقترح ولا يقرّر**. ويُرفق مع كل اقتراح ما يُضعفه، كي
 * يرى الإنسان سبب الشكّ قبل أن يؤكّد.
 */

export interface SupplierItem {
  supplierId: string;
  supplierName: string;
  normalized: string;
  displayName: string;
  /** آخر سعر وحدة مدفوع — يُقاس به معقولية الجمع */
  lastUnitPriceMinor: number;
  orderCount: number;
}

export type SuggestionStrength = "STRONG" | "WEAK";

export interface MergeSuggestion {
  normalized: string;
  items: SupplierItem[];
  strength: SuggestionStrength;
  /** ما يُضعف الاقتراح — يُعرض مع الاقتراح لا بعده */
  caveats: string[];
  /** أعلى سعر ÷ أدنى سعر */
  priceRatio: number;
}

/**
 * أقصى تفاوت سعري يُحتمل أن يكون للصنف الواحد.
 *
 * ثلاثة أضعاف تسامحٌ واسع عمداً: العبوات تختلف والجودة تختلف. وما تجاوزه
 * فالأرجح أنّهما صنفان — كالعنب: مئة وخمسة وخمسون مقابل ثلاثة عشر، أي
 * أحد عشر ضعفاً.
 */
const PLAUSIBLE_PRICE_RATIO = 3;

/**
 * يقترح جمع أصناف مورّدين تحت صنف معياري واحد.
 * الاسم المطبَّع هو المدخل، وسعر الوحدة هو ما يُضعف الاقتراح أو يقوّيه.
 */
export function suggestMerges(items: readonly SupplierItem[]): MergeSuggestion[] {
  const byName = new Map<string, SupplierItem[]>();
  for (const i of items) {
    if (!i.normalized) continue;
    const list = byName.get(i.normalized) ?? [];
    list.push(i);
    byName.set(i.normalized, list);
  }

  const out: MergeSuggestion[] = [];

  for (const [normalized, list] of byName) {
    const suppliers = new Set(list.map((i) => i.supplierId));
    if (suppliers.size < 2) continue;

    const prices = list.map((i) => i.lastUnitPriceMinor).filter((p) => p > 0);
    /*
     * بلا أسعار مسجَّلة لا دليل في الاتجاهين.
     * النسبة واحدٌ لا لأنّ السعرين متساويان بل لأنّه لا سعر يُقارَن —
     * والفرق يُقال في التحفّظات لا يُبتلَع في رقم.
     */
    const hasPrices = prices.length >= 2;
    const min = hasPrices ? Math.min(...prices) : 0;
    const max = hasPrices ? Math.max(...prices) : 0;
    const priceRatio = hasPrices && min > 0 ? max / min : 1;

    const caveats: string[] = [];
    if (!hasPrices) caveats.push("لا أسعار مسجّلة للمقارنة");
    if (priceRatio > PLAUSIBLE_PRICE_RATIO) {
      caveats.push(
        `فارق السعر ${priceRatio.toFixed(1)} ضعفاً — الأرجح أنّهما صنفان مختلفان يحملان الاسم نفسه`,
      );
    }
    if (list.some((i) => i.orderCount === 1)) {
      caveats.push("أحدهما طُلب مرّة واحدة — الاسم قد يكون مؤقّتاً");
    }
    if (normalized.split(" ").length === 1) {
      caveats.push("الاسم كلمة واحدة — يحتمل معانيَ كثيرة");
    }

    out.push({
      normalized,
      items: [...list].sort((a, b) => a.lastUnitPriceMinor - b.lastUnitPriceMinor),
      strength: caveats.length === 0 ? "STRONG" : "WEAK",
      caveats,
      priceRatio,
    });
  }

  // الأقوى أوّلاً، ثم الأكثر طلباً — ليبدأ الإنسان بما هو أوضح وأنفع
  return out.sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === "STRONG" ? -1 : 1;
    const ordersA = a.items.reduce((s, i) => s + i.orderCount, 0);
    const ordersB = b.items.reduce((s, i) => s + i.orderCount, 0);
    return ordersB - ordersA;
  });
}

/** اسم معياري مقترح: أوفى الأسماء وصفاً بين المتشابهات. */
export function suggestCanonicalName(items: readonly SupplierItem[]): string {
  return items.reduce(
    (best, i) => (i.displayName.length > best.length ? i.displayName : best),
    items[0]?.displayName ?? "",
  );
}

export type ProductCategory =
  | "COFFEE" | "DAIRY" | "BAKERY" | "FOOD" | "BEVERAGE"
  | "PACKAGING" | "CLEANING" | "EQUIPMENT" | "OTHER";

export const CATEGORY_LABEL: Record<ProductCategory, string> = {
  COFFEE: "بنّ ومشروبات ساخنة",
  DAIRY: "ألبان",
  BAKERY: "مخبوزات",
  FOOD: "أغذية",
  BEVERAGE: "مشروبات",
  PACKAGING: "تغليف",
  CLEANING: "نظافة",
  EQUIPMENT: "معدّات",
  OTHER: "أخرى",
};

const CATEGORY_HINTS: { category: ProductCategory; words: string[] }[] = [
  { category: "COFFEE", words: ["بن", "قهوه", "اسبريسو", "espresso", "coffee", "roast", "blend", "arabica", "محمص"] },
  { category: "DAIRY", words: ["حليب", "لبن", "جبن", "قشطه", "زبده", "milk", "cheese", "cream", "butter", "يوغرت"] },
  { category: "BAKERY", words: ["كرواسون", "خبز", "كيك", "براوني", "معجنات", "croissant", "cake", "bread", "بسكويت"] },
  { category: "PACKAGING", words: ["كاسات", "كوب", "غطاء", "كيس", "علبه", "نابكن", "cup", "lid", "bag", "box", "حامل"] },
  { category: "CLEANING", words: ["مطهر", "منظف", "صابون", "موب", "قفاز", "clean", "soap", "sanit"] },
  { category: "BEVERAGE", words: ["كمبوتشا", "عصير", "مياه", "ماء", "شراب", "سيرب", "juice", "water", "syrup", "kombucha"] },
  { category: "EQUIPMENT", words: ["مطحنه", "الة", "جهاز", "معده", "grinder", "machine"] },
];

/** تصنيف مقترح من اسم الصنف — اقتراحٌ يُعرض لا حكمٌ يُنفَّذ. */
export function suggestCategory(name: string): ProductCategory {
  const t = name.toLowerCase();
  for (const h of CATEGORY_HINTS) {
    if (h.words.some((w) => t.includes(w))) return h.category;
  }
  return "OTHER";
}
