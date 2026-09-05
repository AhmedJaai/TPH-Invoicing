/**
 * تحويل الوحدات — الجسر بين ما يبيعه المورّد وما يُقاس به الصنف.
 *
 * المورّد يبيع «كرتون ١٢ × ١ لتر»، والمقهى يقيس باللتر. وبلا تحويلٍ
 * صريح يُقارَن سعرُ الكرتون بسعر اللتر فيبدو أنّ السعر ارتفع اثني عشر
 * ضعفاً — أو أنّ مورّداً أرخص من آخر بأربعة أضعاف وهما سواء.
 *
 * وهذه ليست ميزةَ مخزون: هي **شرطُ صحّة أيّ مقارنةِ سعر**. وقد وقع
 * مثالُها فعلاً في «العنب»: صنفان مختلفان دُمجا فأنتجا «توفيراً» وهمياً
 * بألفين ومئة واثنين وعشرين ريالاً. والدمج بالوحدة الخاطئة يفعل الشيء
 * نفسه بلا أن يُدمَج شيء.
 *
 * **والمجهول لا يُحوَّل.** صنفٌ لا يُعرف حجم عبوته يُعرَض «غير معروف»
 * ولا يُفترَض واحداً. وافتراضُ الواحد هنا يعني أنّ كرتوناً بمئة ريال
 * يُقارَن بلترٍ بثمانية — فيُعلَن ارتفاعٌ لم يقع، أو يُخفى ارتفاعٌ وقع.
 */

/** الوحدات الأساس — ما يُقاس به الصنف مهما اختلفت عبوات مورّديه. */
export type BaseUnit = "PIECE" | "KG" | "GRAM" | "LITER" | "ML" | "PACK";

export const UNIT_LABEL: Record<BaseUnit, string> = {
  PIECE: "حبّة", KG: "كيلو", GRAM: "جرام",
  LITER: "لتر", ML: "مليلتر", PACK: "عبوة",
};

/**
 * التحويلات **داخل العائلة الواحدة** فقط.
 *
 * ولا جسر بين الوزن والحجم: لترُ الحليب ليس كيلواً، ولترُ الزيت أبعد.
 * والكثافة تختلف بالصنف، فوضعُ معامِلٍ عامّ هنا يُنتج أرقاماً تبدو
 * دقيقة وهي مخترَعة.
 */
const FAMILY: Record<BaseUnit, string> = {
  KG: "MASS", GRAM: "MASS",
  LITER: "VOLUME", ML: "VOLUME",
  PIECE: "COUNT", PACK: "COUNT",
};

/** كم من الوحدة الصغرى في هذه الوحدة. */
const IN_SMALLEST: Record<BaseUnit, number> = {
  KG: 1000, GRAM: 1,
  LITER: 1000, ML: 1,
  PIECE: 1, PACK: 1,
};

export function sameFamily(a: BaseUnit, b: BaseUnit): boolean {
  return FAMILY[a] === FAMILY[b];
}

/**
 * يحوّل كمّيةً من وحدةٍ إلى أخرى.
 *
 * ويُرجع `null` حين لا يصحّ التحويل — لا صفراً ولا الكمّيةَ كما هي.
 * فإرجاعُ الكمّية كما هي عند العجز هو بالضبط ما يُنتج مقارنةَ كرتونٍ
 * بلتر.
 */
export function convert(quantity: number, from: BaseUnit, to: BaseUnit): number | null {
  if (from === to) return quantity;
  if (!sameFamily(from, to)) return null;
  /* الحبّة والعبوة من عائلةٍ واحدة عدّاً، ولا تحويل بينهما بلا حجم عبوة */
  if (FAMILY[from] === "COUNT") return null;

  return (quantity * IN_SMALLEST[from]) / IN_SMALLEST[to];
}

export interface PackSpec {
  /** ما يبيعه المورّد: «كرتون» — عدداً من العبوات. */
  packSize: number | null;
  /** ووحدةُ ما بداخله. */
  contentUnit: BaseUnit | null;
  /** وكمّيةُ الواحدة بداخله: ١ لتر. */
  contentQuantity: number | null;
}

export interface ConversionResult {
  /** الكمّية بالوحدة الأساس. */
  baseQuantity: number;
  baseUnit: BaseUnit;
  /** سعر الوحدة الأساس بالهللات — عددٌ صحيح دائماً. */
  unitPriceMinor: number;
  explanation: string;
}

/**
 * سعرُ الوحدة الأساس من سعر العبوة.
 *
 * والقسمة تُقرَّب إلى أقرب هللة — لا تُترَك كسراً. فالكسر العشريّ في
 * المال يتراكم: ألفُ سطرٍ بكسرٍ يعطي فرقاً حقيقياً في التقرير.
 */
export function unitPriceFromPack(
  packPriceMinor: number,
  spec: PackSpec,
  targetUnit: BaseUnit,
): ConversionResult | null {
  if (spec.packSize === null || spec.contentUnit === null || spec.contentQuantity === null) {
    return null;  // المجهول لا يُحوَّل ولا يُفترَض واحداً
  }
  if (spec.packSize <= 0 || spec.contentQuantity <= 0) return null;

  const totalInContentUnit = spec.packSize * spec.contentQuantity;
  const totalInTarget = convert(totalInContentUnit, spec.contentUnit, targetUnit);
  if (totalInTarget === null || totalInTarget <= 0) return null;

  return {
    baseQuantity: totalInTarget,
    baseUnit: targetUnit,
    unitPriceMinor: Math.round(packPriceMinor / totalInTarget),
    explanation:
      `${spec.packSize} × ${spec.contentQuantity} ${UNIT_LABEL[spec.contentUnit]}` +
      ` = ${totalInTarget} ${UNIT_LABEL[targetUnit]}`,
  };
}

/**
 * هل يصحّ أن يُقارَن هذان السعران؟
 *
 * وهذا هو السؤال الذي كان يُتجاوَز صامتاً. والجواب «لا» ليس عجزاً —
 * هو منعُ رقمٍ كاذب.
 */
export interface Comparable {
  supplierProductId: string;
  unitPriceMinor: number | null;
  baseUnit: BaseUnit | null;
}

export interface ComparisonVerdict {
  comparable: boolean;
  reason: string;
}

export function canCompare(a: Comparable, b: Comparable): ComparisonVerdict {
  if (a.unitPriceMinor === null || b.unitPriceMinor === null) {
    return { comparable: false, reason: "سعر الوحدة غير معروف لأحدهما — ولا يُفترَض" };
  }
  if (a.baseUnit === null || b.baseUnit === null) {
    return { comparable: false, reason: "وحدة القياس غير معروفة لأحدهما" };
  }
  if (a.baseUnit !== b.baseUnit && !sameFamily(a.baseUnit, b.baseUnit)) {
    return {
      comparable: false,
      reason: `${UNIT_LABEL[a.baseUnit]} لا يُقارَن بـ${UNIT_LABEL[b.baseUnit]} — عائلتان مختلفتان`,
    };
  }
  return { comparable: true, reason: "الوحدتان من عائلةٍ واحدة" };
}
