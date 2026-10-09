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
import { fromCanonical, MILLI, sameUnitFamily, toCanonical } from "./units";
import { ingredientForSale } from "./consumption";
import { DEFAULT_YIELD_MILLI } from "./recipe";
import type { StoredUnit } from "@/lib/unit-conversion";

/** بم سُعِّر المكوّن — يُعلَن مع الرقم، فلا يتغيّر الأساسُ صامتاً. */
export type CostBasis = "INVOICE" | "CATALOG";

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
  /** فاقدُ التجهيز بنقاط الأساس — يدخل الكلفةَ كما يدخل الاستهلاك. */
  prepLossBp?: number | null;
  /**
   * كلفةُ وحدة الأساس من **آخر فاتورة**، بمِلّي‑الهللة.
   *
   * الفاتورةُ واقعةٌ والكتالوجُ تقدير: بنٌّ ارتفع ١٥٪ في فاتورته لا يظهر في
   * كلفة اللاتيه ما دامت تُحسَب من رقمٍ كتبه المقهى في فودكس يوماً.
   */
  invoiceRateMilliMinor?: number | null;
}

export interface CostedLine {
  productId: string;
  name: string;
  costMilliMinor: number | null;
  /** أساسُ كلفة هذا السطر — و`null` حين لا كلفة. */
  basis: CostBasis | null;
  /** لماذا جُهلت كلفتُه — يُعرَض ولا يُدفَن. */
  reason: "NO_COST" | "UNIT_MISMATCH" | null;
}

export interface RecipeCost {
  /** مجموعُ الوصفة بمِلّي‑الهللة، و`null` إن جُهل مكوّنٌ واحد. */
  costMilliMinor: number | null;
  costMinor: number | null;
  /** أساسُ المجموع: فواتير، أو كتالوج، أو خليطٌ منهما. */
  basis: CostBasis | "MIXED" | null;
  lines: CostedLine[];
  /** ما جُهلت كلفتُه بأسمائه وأسبابه — «لماذا لا رقمَ هنا». */
  unknown: { name: string; reason: NonNullable<CostedLine["reason"]> }[];
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

export interface RecipeCostOptions {
  /** ناتجُ الوصفة عدداً ممّا يُباع، بالمِلّي — والافتراضُ وحدةٌ واحدة. */
  yieldMilli?: number;
  /** أتُقدَّم كلفةُ الفاتورة على الكتالوج؟ — والافتراضُ لا (حسابُ الكتالوج وحده). */
  preferInvoice?: boolean;
}

/**
 * كلفةُ **وحدةٍ مباعةٍ واحدة** من الوصفة.
 *
 * ── قاعدةٌ واحدة للكمّيّة لا اثنتان ──
 *
 * كان يُضرَب المكتوبُ في الوصفة في كلفة عبوته وحسب، بينما الاستهلاكُ يُحسَب
 * بفاقد التجهيز وناتج الوصفة (`ingredientForSale`). فوصفةٌ بفاقد ٨٪ تُسعَّر
 * أرخصَ ممّا يخرج من الرفّ فعلاً، ووصفةٌ ناتجُها أربعُ قطعٍ تُسعَّر بأربعة
 * أضعافها. فالكمّيّةُ هنا هي ما يحسبه المحرّكُ لبيعةٍ واحدة — بالدالّة نفسها.
 */
export function recipeCost(ingredients: readonly CostedIngredient[], options: RecipeCostOptions = {}): RecipeCost {
  const lines: CostedLine[] = [];
  const yieldMilli = options.yieldMilli && options.yieldMilli > 0 ? options.yieldMilli : DEFAULT_YIELD_MILLI;
  let total = 0;
  let known = true;

  for (const ing of ingredients) {
    if (!sameUnitFamily(ing.unit, ing.baseUnit)) {
      lines.push({ productId: ing.productId, name: ing.name, costMilliMinor: null, basis: null, reason: "UNIT_MISMATCH" });
      known = false;
      continue;
    }
    /* ما يخرج من الرفّ لبيعةٍ واحدة، بمِلّي وحدة الصنف */
    const inBase = fromCanonical(
      ingredientForSale(MILLI, ing.quantityMilli, yieldMilli, ing.prepLossBp ?? null, toCanonical(1, ing.unit)),
      ing.baseUnit,
    );

    const invoiceRate = options.preferInvoice ? ing.invoiceRateMilliMinor ?? null : null;
    if (invoiceRate !== null && invoiceRate > 0) {
      const cost = Math.round((inBase * invoiceRate) / MILLI);
      total += cost;
      lines.push({ productId: ing.productId, name: ing.name, costMilliMinor: cost, basis: "INVOICE", reason: null });
      continue;
    }
    if (ing.packMilli === null || ing.packCostMinor === null || ing.packMilli <= 0) {
      lines.push({ productId: ing.productId, name: ing.name, costMilliMinor: null, basis: null, reason: "NO_COST" });
      known = false;
      continue;
    }
    /* التقريبُ مرّةً لكلّ سطرٍ بالمِلّي، ثمّ مرّةً للمجموع — لا مرّةً لكلّ هللة */
    const cost = Math.round((inBase * ing.packCostMinor * MILLI_MINOR) / ing.packMilli);
    total += cost;
    lines.push({ productId: ing.productId, name: ing.name, costMilliMinor: cost, basis: "CATALOG", reason: null });
  }

  const bases = new Set(lines.map((l) => l.basis).filter((x): x is CostBasis => x !== null));
  return {
    costMilliMinor: known ? total : null,
    costMinor: known ? milliMinorToMinor(total) : null,
    basis: !known || bases.size === 0 ? null : bases.size > 1 ? "MIXED" : [...bases][0],
    lines,
    unknown: lines
      .filter((l) => l.reason !== null)
      .map((l) => ({ name: l.name, reason: l.reason! })),
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
