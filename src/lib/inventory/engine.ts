/**
 * محرّكُ تسوية المخزون — دالّةٌ نقيّة، مدخلاتُها معطاة ومخرجُها محسوب.
 *
 * ── لماذا نقيّة ──
 *
 * هذا هو الموضع الذي يُنتِج الرقمَ الذي يُحاسَب عليه أحد. فيجب أن
 * يُختبَر بلا قاعدةٍ ولا شبكة، وأن يُعطي **النتيجةَ نفسها** لكلّ مدخلٍ
 * نفسِه مهما تغيّر ما حوله. والقراءةُ من القاعدة في الخدمة، والحسابُ
 * هنا.
 *
 * ── ونسخةُ المحرّك مكتوبة ──
 *
 * تُحفَظ في اللقطة مع كلّ جردٍ مقفَل. فمن قرأ تقريراً بعد سنةٍ عرف
 * بأيّ منطقٍ حُسب — ولو تغيّر المنطقُ بعده لم يتغيّر التقرير.
 */
import type { StoredUnit } from "@/lib/unit-conversion";
import { computeConsumption, type ConsumptionResult, type SoldLineInput } from "./consumption";
import { computeCoverage, type CoverageReport } from "./coverage";
import { stockVariance, type StockTerms } from "./equation";
import { indexRecipeVersions, type RecipeVersionInput } from "./recipe";
import {
  summarisePurchases, unitCostMinor, varianceCostMinor,
  type PurchaseLineInput, type PurchaseSummary,
} from "./purchases";
import { sameUnitFamily } from "./units";

/**
 * نسخةُ المحرّك.
 *
 * تُرفَع كلّما تغيّر **معنى** رقمٍ يُحسَب هنا — لا كلّما عُدّل سطر.
 * وهي جزءٌ من أصول التقرير: «حُسب بالنسخة الأولى» خبرٌ يُقرأ.
 */
export const ENGINE_VERSION = "inventory-1";

export interface CountedProduct {
  id: string;
  nameAr: string;
  category: string;
  baseUnit: StoredUnit;
}

/** عَلَمٌ على سطرٍ بعينه — يقول لماذا جُهل ما جُهل فيه. */
export type LineFlag =
  | "OPENING_UNKNOWN"
  | "PURCHASES_UNKNOWN"
  | "CONSUMPTION_UNKNOWN"
  | "COST_UNKNOWN"
  | "NOT_COUNTED"
  | "UNIT_CONFLICT"
  | "RECIPE_UNIT_MISMATCH";

export const FLAG_LABEL: Record<LineFlag, string> = {
  OPENING_UNKNOWN: "الرصيد الافتتاحيّ غير معروف — لا جردَ سابقٌ ولا رصيدٌ مكتوب",
  PURCHASES_UNKNOWN: "مشترياتُ الفترة فيها بنودٌ لم تُعرَف كمّيّتُها",
  CONSUMPTION_UNKNOWN: "الاستهلاك المتوقَّع غير محسوب — لا وصفةَ تصل إلى هذا الصنف",
  COST_UNKNOWN: "كلفةُ الوحدة غير معروفة — فلا تُحسَب كلفةُ الفرق",
  NOT_COUNTED: "لم يُدخَل عدٌّ فعليّ بعد",
  UNIT_CONFLICT: "ذُكر في الوصفات بوحدتين من عائلتين مختلفتين",
  RECIPE_UNIT_MISMATCH: "وحدةُ الوصفة لا تُحوَّل إلى وحدة الصنف",
};

export interface EngineInput {
  periodStart: string;
  periodEnd: string;
  /** الأصنافُ التي تُعَدّ — مرتَّبةٌ كما ستُعرَض. */
  products: readonly CountedProduct[];
  soldLines: readonly SoldLineInput[];
  recipeVersions: readonly RecipeVersionInput[];
  purchaseLines: readonly PurchaseLineInput[];
  /** الافتتاحيّ بالوحدة المعياريّة، و`null` «غير معروف». */
  openingByProduct: ReadonlyMap<string, number | null>;
  adjustmentsInByProduct: ReadonlyMap<string, number>;
  adjustmentsOutByProduct: ReadonlyMap<string, number>;
  wasteByProduct: ReadonlyMap<string, number>;
  /** العدُّ الفعليّ كما أدخله الإنسان، و`null` «لم يُعَدّ بعد». */
  actualByProduct: ReadonlyMap<string, number | null>;
  /** آخرُ كلفةٍ معروفة خارج الفترة — تُستعمَل حين لا مشترياتٍ فيها. */
  fallbackCostByProduct: ReadonlyMap<string, number | null>;
}

export interface ReportLine {
  productId: string;
  productName: string;
  category: string;
  baseUnit: StoredUnit;

  openingMilli: number | null;
  purchasesMilli: number | null;
  adjustmentsInMilli: number;
  adjustmentsOutMilli: number;
  theoreticalConsumptionMilli: number | null;
  recordedWasteMilli: number;
  theoreticalClosingMilli: number | null;
  actualMilli: number | null;
  varianceMilli: number | null;
  varianceBp: number | null;
  unitCostMinor: number | null;
  varianceCostMinor: number | null;

  flags: LineFlag[];
  /** أصلُ الاستهلاك: أيّ نسخِ وصفاتٍ أسهمت فيه. */
  recipeVersionIds: string[];
  /** وأيّ أسطرِ فواتيرَ بُنيت عليها المشتريات. */
  invoiceLineIds: string[];
}

export interface EngineReport {
  engineVersion: string;
  periodStart: string;
  periodEnd: string;
  lines: ReportLine[];
  coverage: CoverageReport;
  totals: {
    /**
     * مجموعُ كلفةِ الفروق — **لما عُرفت كلفتُه وحده**.
     *
     * ويُعرَض معه عددُ ما لم يدخله، فالمجموعُ الذي لا يقول ما سقط منه
     * يُقرأ كأنّه الكلّ.
     */
    varianceCostMinor: number;
    linesWithKnownCost: number;
    linesCounted: number;
    linesWithVariance: number;
    salesTotalMinor: number;
    purchasesTotalMinor: number;
  };
  consumption: ConsumptionResult;
  purchases: PurchaseSummary;
}

/**
 * يحسب الجرد كلَّه.
 *
 * والترتيب مقصود: يُحسَب الاستهلاكُ والمشترياتُ أوّلاً (وهما ما يخرج
 * منهما ما لا يُعرَف)، ثمّ يُبنى سطرُ كلّ صنف، ثمّ تُحسَب التغطية على
 * ما وقع فعلاً — لا على ما يُظنّ.
 */
export function reconcile(input: EngineInput): EngineReport {
  const versionIndex = indexRecipeVersions(input.recipeVersions);
  const consumption = computeConsumption(input.soldLines, versionIndex);

  const baseUnitById = new Map(input.products.map((p) => [p.id, p.baseUnit] as const));
  const purchases = summarisePurchases(input.purchaseLines, (id) => baseUnitById.get(id) ?? null);

  const unitConflicts: string[] = [];
  const lines: ReportLine[] = [];

  let varianceCostTotal = 0;
  let linesWithKnownCost = 0;
  let linesCounted = 0;
  let linesWithVariance = 0;
  let purchasesTotalMinor = 0;

  for (const product of input.products) {
    const flags: LineFlag[] = [];
    const used = consumption.byIngredient.get(product.id);
    const bought = purchases.byProduct.get(product.id);

    /*
      وحدةُ الوصفة ووحدةُ الصنف من عائلةٍ واحدة أو لا يُجمَعان.
      و«لا يُجمَعان» تعني أنّ الاستهلاك **مجهول** لا صفر: لو قُرئ صفراً
      لصار المتوقَّعُ هو الافتتاحيَّ زائدَ المشتريات كلِّها، فيُعلَن
      فرقٌ هائل سببُه خطأٌ في وحدةٍ لا في مخزون.
    */
    let consumptionMilli: number | null = null;
    if (used) {
      if (used.unitConflict !== null) {
        flags.push("UNIT_CONFLICT");
        unitConflicts.push(product.nameAr);
      } else if (!sameUnitFamily(used.unit, product.baseUnit)) {
        flags.push("RECIPE_UNIT_MISMATCH");
      } else {
        consumptionMilli = used.canonicalMilli;
      }
    }
    if (consumptionMilli === null) flags.push("CONSUMPTION_UNKNOWN");

    const openingMilli = input.openingByProduct.get(product.id) ?? null;
    if (openingMilli === null) flags.push("OPENING_UNKNOWN");

    /*
      مشترياتُ صنفٍ لم يُشترَ في الفترة **صفرٌ حقيقيّ** لا مجهول: قرأنا
      الفواتير كلَّها ولم نجد له بنداً. أمّا الذي له بنودٌ لم تُعرَف
      كمّيّتُها فمشترياتُه مجهولة — وإلّا حُسب ناقصاً وأُعلن فرقٌ سببُه
      شراءٌ وقع ولم يُقَس.
    */
    const hasUnknownPurchase = purchases.gaps.some((g) => g.productId === product.id);
    let purchasesMilli: number | null = bought?.canonicalMilli ?? 0;
    if (hasUnknownPurchase) {
      purchasesMilli = null;
      flags.push("PURCHASES_UNKNOWN");
    }
    purchasesTotalMinor += bought?.knownCostMinor ?? 0;

    const terms: StockTerms = {
      openingMilli,
      purchasesMilli,
      adjustmentsInMilli: input.adjustmentsInByProduct.get(product.id) ?? 0,
      adjustmentsOutMilli: input.adjustmentsOutByProduct.get(product.id) ?? 0,
      theoreticalConsumptionMilli: consumptionMilli,
      recordedWasteMilli: input.wasteByProduct.get(product.id) ?? 0,
    };

    const actualMilli = input.actualByProduct.get(product.id) ?? null;
    if (actualMilli === null) flags.push("NOT_COUNTED");
    else linesCounted++;

    const result = stockVariance(terms, actualMilli);
    if (result.varianceMilli !== null) linesWithVariance++;

    const cost = unitCostMinor(bought, product.baseUnit, input.fallbackCostByProduct.get(product.id) ?? null);
    if (cost === null) flags.push("COST_UNKNOWN");

    const varianceCost = varianceCostMinor(result.varianceMilli, cost, product.baseUnit);
    if (varianceCost !== null) {
      varianceCostTotal += varianceCost;
      linesWithKnownCost++;
    }

    lines.push({
      productId: product.id,
      productName: product.nameAr,
      category: product.category,
      baseUnit: product.baseUnit,
      openingMilli,
      purchasesMilli,
      adjustmentsInMilli: terms.adjustmentsInMilli,
      adjustmentsOutMilli: terms.adjustmentsOutMilli,
      theoreticalConsumptionMilli: consumptionMilli,
      recordedWasteMilli: terms.recordedWasteMilli,
      theoreticalClosingMilli: result.theoreticalClosingMilli,
      actualMilli,
      varianceMilli: result.varianceMilli,
      varianceBp: result.varianceBp,
      unitCostMinor: cost,
      varianceCostMinor: varianceCost,
      flags,
      recipeVersionIds: used?.recipeVersionIds ?? [],
      invoiceLineIds: bought?.invoiceLineIds ?? [],
    });
  }

  const coverage = computeCoverage({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    salesBusinessDates: input.soldLines.map((l) => l.businessDate),
    consumption,
    purchases,
    itemsCounted: linesCounted,
    itemsWithKnownOpening: lines.filter((l) => l.openingMilli !== null).length,
    itemsWithKnownCost: lines.filter((l) => l.unitCostMinor !== null).length,
    unitConflicts,
    unitlessItems: [],
  });

  return {
    engineVersion: ENGINE_VERSION,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    lines,
    coverage,
    totals: {
      varianceCostMinor: varianceCostTotal,
      linesWithKnownCost,
      linesCounted,
      linesWithVariance,
      salesTotalMinor: consumption.included.totalMinor + consumption.excludedTotals.totalMinor,
      purchasesTotalMinor,
    },
    consumption,
    purchases,
  };
}

/**
 * أكبرُ الفروق — بكلفتها حين تُعرَف، وبنسبتها حين لا تُعرَف.
 *
 * والترتيبُ بالكلفة لا بالكمّيّة: ‏٢٫٥ كجم بنّ أثقلُ من ‏٢٫٦ لتر حليب
 * بأربعة أضعاف، والعينُ لا تقرأ ذلك من الكمّيّتين.
 */
export function topVariances(report: EngineReport, limit = 5): ReportLine[] {
  return report.lines
    .filter((l) => l.varianceMilli !== null && l.varianceMilli !== 0)
    .sort((a, b) => {
      const ac = a.varianceCostMinor === null ? -1 : Math.abs(a.varianceCostMinor);
      const bc = b.varianceCostMinor === null ? -1 : Math.abs(b.varianceCostMinor);
      if (ac !== bc) return bc - ac;
      return Math.abs(b.varianceBp ?? 0) - Math.abs(a.varianceBp ?? 0);
    })
    .slice(0, limit);
}
