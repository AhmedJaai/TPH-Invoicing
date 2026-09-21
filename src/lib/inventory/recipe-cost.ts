/**
 * كم تكلّف الوصفة؟ — جمعُ مكوّناتها بكلفةِ كلٍّ منها.
 *
 * ── والمجهولُ يُنشر ولا يُبتَلع ──
 *
 * مكوّنٌ لا كلفةَ له يجعل **كلفةَ الوصفة كلِّها مجهولة**، لا ناقصة.
 * فوصفةٌ من ستّة مكوّناتٍ عُرف خمسةٌ منها تُعطي رقماً يبدو دقيقاً وهو
 * أقلُّ من الحقّ — ثمّ يُبنى عليه هامشٌ يبدو مريحاً. والمجهولُ يُعلَن
 * ومعه **اسمُ المكوّن** الذي أسقطه، فيُصلَح.
 *
 * ── والمقارنةُ بالكلفة المعلَنة تكشف ما لا يظهر ──
 *
 * فودكس يحمل لبعض الأصناف كلفةً يكتبها المقهى. فإن باعدت مجموعَ
 * الوصفة مباعدةً كبيرة فذلك خبرٌ: في كتالوج المقهى **ستّةُ أصنافٍ
 * وصفتُها تغليفٌ فقط** — «تشيز مدريد» وصفتُه شوكةٌ وعلبةٌ بـ٠٫٧٦
 * ريالاً، والكلفةُ المعلَنة ٩٫١٧، **والكعكةُ نفسُها ليست في وصفتها**.
 * فكلُّ قطعةٍ تُباع لا تُخصَم من المخزون، ويظهر ما اشتُري منها كلُّه
 * «فرقاً».
 */
import { MILLI_MINOR, milliMinorToMinor } from "@/lib/money";
import { convertMilli, MILLI } from "./units";
import type { StoredUnit } from "@/lib/unit-conversion";

/** مكوّنٌ في نسخةٍ سارية، ومعه عبوةُ صنفه وكلفتُها. */
export interface CostedIngredient {
  productId: string;
  name: string;
  quantityMilli: number;
  unit: StoredUnit;
  baseUnit: StoredUnit;
  /** كم وحدةَ أساسٍ في العبوة، بالمِلّي — و`null` حين لا عبوةَ معروفة. */
  packMilli: number | null;
  packCostMinor: number | null;
}

export interface CostedLine {
  productId: string;
  name: string;
  costMilliMinor: number | null;
  /** لماذا جُهلت كلفتُه — يُعرَض ولا يُدفَن. */
  reason: "NO_COST" | "UNIT_MISMATCH" | null;
}

export interface RecipeCost {
  /** مجموعُ الوصفة بمِلّي‑الهللة، و`null` إن جُهل مكوّنٌ واحد. */
  costMilliMinor: number | null;
  costMinor: number | null;
  lines: CostedLine[];
  /** أسماءُ ما جُهلت كلفتُه — «لماذا لا رقمَ هنا». */
  unknown: string[];
}

export const COST_REASON_LABEL: Record<NonNullable<CostedLine["reason"]>, string> = {
  NO_COST: "لا عبوةَ ولا كلفةَ معروفة لهذا المكوّن",
  UNIT_MISMATCH: "وحدةُ الوصفة لا تُحوَّل إلى وحدة الصنف",
};

/** كلفةُ وحدةِ أساسٍ واحدة من الصنف، بمِلّي‑الهللة. */
export function packUnitCostMilliMinor(
  packMilli: number | null,
  packCostMinor: number | null,
): number | null {
  if (packMilli === null || packCostMinor === null || packMilli <= 0) return null;
  return Math.round((MILLI * packCostMinor * MILLI_MINOR) / packMilli);
}

export function recipeCost(ingredients: readonly CostedIngredient[]): RecipeCost {
  const lines: CostedLine[] = [];
  let total = 0;
  let known = true;

  for (const ing of ingredients) {
    const inBase = convertMilli(ing.quantityMilli, ing.unit, ing.baseUnit);
    if (inBase === null) {
      lines.push({ productId: ing.productId, name: ing.name, costMilliMinor: null, reason: "UNIT_MISMATCH" });
      known = false;
      continue;
    }
    if (ing.packMilli === null || ing.packCostMinor === null || ing.packMilli <= 0) {
      lines.push({ productId: ing.productId, name: ing.name, costMilliMinor: null, reason: "NO_COST" });
      known = false;
      continue;
    }
    /* التقريبُ مرّةً لكلّ سطرٍ بالمِلّي، ثمّ مرّةً للمجموع — لا مرّةً لكلّ هللة */
    const cost = Math.round((inBase * ing.packCostMinor * MILLI_MINOR) / ing.packMilli);
    total += cost;
    lines.push({ productId: ing.productId, name: ing.name, costMilliMinor: cost, reason: null });
  }

  return {
    costMilliMinor: known ? total : null,
    costMinor: known ? milliMinorToMinor(total) : null,
    lines,
    unknown: lines.filter((l) => l.reason !== null).map((l) => l.name),
  };
}

/**
 * أتخالف الكلفةُ المعلَنة مجموعَ الوصفة مخالفةً تستحقّ النظر؟
 *
 * والحدُّ نسبةٌ لا مبلغ: ريالٌ في وصفةٍ بريالين خبر، وريالٌ في وصفةٍ
 * بأربعين تقريبُ مورّد. وهو **كشفٌ يُعرَض لا حكمٌ يُصحَّح** — قد
 * تكون الوصفةُ ناقصةً، وقد تكون الكلفةُ المعلَنة قديمة.
 */
export const DECLARED_COST_GAP_BP = 2_500;

export function declaredCostDisagrees(
  recipeCostMinor: number | null,
  declaredMinor: number | null,
): boolean {
  if (recipeCostMinor === null || declaredMinor === null || declaredMinor <= 0) return false;
  const gap = Math.abs(declaredMinor - recipeCostMinor);
  return Math.round((gap * 10_000) / declaredMinor) >= DECLARED_COST_GAP_BP;
}
