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
import { summariseVariance, type VarianceSummary } from "./variance-summary";
import type { DuplicateCandidate } from "./receipts";
import type { StoredUnit } from "@/lib/unit-conversion";
import { computeConsumption, type ConsumptionResult, type SoldLineInput } from "./consumption";
import { computeCoverage, type CoverageReport } from "./coverage";
import { stockVariance, type StockTerms } from "./equation";
import { indexRecipeVersions, type RecipeVersionInput } from "./recipe";
import {
  summarisePurchases, unitCostMilliMinor, varianceCostMinor,
  type PurchaseLineInput, type PurchaseSummary,
} from "./purchases";
import { sameUnitFamily } from "./units";
import { milliMinorToMinor } from "@/lib/money";

/**
 * بم قُوِّمت كلفةُ الفرق.
 *
 * **ولا تُقرأ تكلفةَ مبيعات**: هي تقديرُ أثرٍ ماليّ لفرقٍ لم يُفسَّر
 * بعد، ولا تدخل قائمةَ دخلٍ ولا قيداً محاسبيّاً.
 */
export type ValuationBasis = "PERIOD_WEIGHTED_AVERAGE" | "LATEST_KNOWN" | "CATALOG" | "UNKNOWN";

export const VALUATION_LABEL: Record<ValuationBasis, string> = {
  PERIOD_WEIGHTED_AVERAGE: "قُوِّم بمتوسّط شراء الفترة",
  LATEST_KNOWN: "قُوِّم بآخر كلفةٍ معروفة — لا شراءَ في الفترة",
  CATALOG: "قُوِّم بكلفة الكتالوج المعياريّة — لا فاتورةَ لهذا الصنف",
  UNKNOWN: "لا كلفةَ معروفة — لم يُقوَّم",
};

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
  | "RECIPE_UNIT_MISMATCH"
  | "OUT_OF_SCOPE"
  | "RECEIPT_POSSIBLE_DUPLICATE";

export const FLAG_LABEL: Record<LineFlag, string> = {
  OPENING_UNKNOWN: "الرصيد الافتتاحيّ غير معروف — لا جردَ سابقٌ ولا رصيدٌ مكتوب",
  PURCHASES_UNKNOWN: "مشترياتُ الفترة فيها بنودٌ لم تُعرَف كمّيّتُها",
  CONSUMPTION_UNKNOWN: "الاستهلاك المتوقَّع غير محسوب — لا وصفةَ تصل إلى هذا الصنف",
  COST_UNKNOWN: "كلفةُ الوحدة غير معروفة — فلا تُحسَب كلفةُ الفرق",
  NOT_COUNTED: "لم يُدخَل عدٌّ فعليّ بعد",
  UNIT_CONFLICT: "ذُكر في الوصفات بوحدتين من عائلتين مختلفتين",
  RECIPE_UNIT_MISMATCH: "وحدةُ الوصفة لا تُحوَّل إلى وحدة الصنف",
  OUT_OF_SCOPE: "خارج هذا الجرد باختيارك — وقائعُه محسوبة ولا فرقَ له",
  RECEIPT_POSSIBLE_DUPLICATE: "كمّيّةٌ مستلَمة قد تكون هي نفسَ بندِ فاتورة — فالمشتريات غير معروفة حتى تُحسَم",
};

/** مصدرُ الرصيد الافتتاحيّ — بترتيبٍ ثابت لا تتنافس فيه المصادر. */
export type OpeningSource = "MANUAL" | "PREVIOUS_COUNT" | "MOVEMENT" | "UNKNOWN";

export const OPENING_SOURCE_LABEL: Record<OpeningSource, string> = {
  MANUAL: "أُدخل يدوياً",
  PREVIOUS_COUNT: "من جرد الأسبوع السابق",
  MOVEMENT: "من رصيدٍ افتتاحيٍّ مسجَّل",
  UNKNOWN: "غير معروف",
};

export interface EngineInput {
  periodStart: string;
  periodEnd: string;
  /** الأصنافُ التي تُعَدّ — مرتَّبةٌ كما ستُعرَض. */
  products: readonly CountedProduct[];
  soldLines: readonly SoldLineInput[];
  recipeVersions: readonly RecipeVersionInput[];
  purchaseLines: readonly PurchaseLineInput[];
  /**
   * فواتيرُ تلي نهايةَ الفترة بأيّامٍ قليلة بلا تاريخ استلامٍ حقيقيّ.
   *
   * لا تُضمّ ولا تُسقَط — تُعرَض بندَ التباسٍ في التغطية، ويقرّر فيها
   * إنسان. وضمُّها بالحدس يُنقص الفرق، وإسقاطُها يزيده.
   */
  ambiguousReceipts?: readonly PurchaseLineInput[];
  /** الافتتاحيّ بالوحدة المعياريّة، و`null` «غير معروف». */
  openingByProduct: ReadonlyMap<string, number | null>;
  adjustmentsInByProduct: ReadonlyMap<string, number>;
  adjustmentsOutByProduct: ReadonlyMap<string, number>;
  wasteByProduct: ReadonlyMap<string, number>;
  /** العدُّ الفعليّ كما أدخله الإنسان، و`null` «لم يُعَدّ بعد». */
  actualByProduct: ReadonlyMap<string, number | null>;
  /**
   * آخرُ كلفةٍ معروفة خارج الفترة — **بمِلّي‑الهللة لوحدة الأساس**.
   *
   * تُستعمَل حين لا مشترياتٍ في الفترة. والمقياسُ مِلّي لأنّ معدَّل
   * الكلفة قد يكون كسراً: ‏٢٫١٢٥ هللة للمصّاصة.
   */
  fallbackCostByProduct: ReadonlyMap<string, number | null>;
  /**
   * كلفةُ الكتالوج المعياريّة — بمِلّي‑الهللة كذلك.
   *
   * وتأتي **بعد** الفاتورة لا قبلها: الفاتورةُ واقعةٌ والكتالوجُ
   * تقدير. وخيرٌ منها «لا كلفة»: صنفٌ لم تصل فاتورتُه هذا الشهر
   * يُقوَّم بتقديرٍ مُعلَن، لا يُترَك بلا رقم.
   */
  catalogCostByProduct?: ReadonlyMap<string, number | null>;
  /**
   * أصنافُ هذا الجرد — ومن ليس فيها فخارجَه باختيار إنسان.
   *
   * ── ويُحسَب ولا يُحذَف ──
   *
   * الخارجُ تُحسَب وقائعُه كما هي: افتتاحيُّه ومشترياتُه واستهلاكُه
   * المتوقَّع. والذي يسقط عنه **الفرقُ وحده** — لأنّ الفرق يقتضي عدّاً
   * على الرفّ، ولا عدّ. فلا يدخل المجاميع ولا «أكبر الفروق».
   *
   * ولو حُذف سطرُه بالكلّيّة لما عُرف حجمُ ما خرج من الحساب — وذاك
   * أوّلُ ما يُسأل عنه: «كم استبعدتُ، وكم يمثّل؟».
   *
   * وغيابُها يعني «الكلُّ داخل» — وهو سلوكُ النظام قبل أن يُخيَّر.
   */
  inScopeByProduct?: ReadonlySet<string>;
  /**
   * مصدرُ الافتتاحيّ لكلّ صنف ومرجعُه — يحسمه الخادم بترتيبٍ ثابت،
   * ويمرّ هنا ليُحفَظ مع الرقم. **المحرّكُ يتسلّم القيمةَ المحسومة**
   * ولا يختار بين مصادر.
   */
  openingSourceByProduct?: ReadonlyMap<string, { source: OpeningSource; ref: string | null }>;
  /**
   * استلاماتٌ يدويّة قد تكون هي نفسَ بندِ فاتورة — لم يُحسَم أمرُها.
   *
   * ولا تُدمَج ولا تُحذَف ولا تُحسَب مرّتين بصمت: **تصير مشترياتُ
   * الصنف غيرَ معروفة**، ويُعرَض بندٌ في التغطية بفعلَيه.
   */
  receiptDuplicates?: readonly DuplicateCandidate[];
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
  /** **الأساسيّة**: الفرق ÷ الاستهلاك المتوقَّع. */
  varianceConsumptionBp: number | null;
  /** وثانويّةٌ إلى المخزون الختاميّ المتوقَّع. */
  varianceBp: number | null;
  /** المعدَّلُ مقرَّباً — للعرض السريع وحده. */
  unitCostMinor: number | null;
  /**
   * والمعدَّلُ بدقّته: مِلّي‑هللةٍ لوحدة الأساس.
   *
   * ‏٨٨ ريالاً لكيلو البنّ = ‏٨٫٨ هللة للجرام. فالمقرَّبُ يقول «٩»
   * — زيادةُ ٢٫٣٪ في عمودٍ اسمُه الكلفة. وعلى هذا يقع الحساب والعرض.
   */
  unitCostMilliMinor: number | null;
  /** بم قُوِّم — يُعرَض مع الرقم، فلا يتغيّر المنهجُ صامتاً. */
  valuationBasis: ValuationBasis;
  varianceCostMinor: number | null;

  /**
   * أهو داخلُ هذا الجرد؟
   *
   * والخارجُ سطرٌ كامل بوقائعه، بلا فرقٍ ولا كلفةِ فرق — يُعرَض
   * معلَناً أنّه خارج، لا يُحذَف فيُظنّ أنّه عُدّ.
   */
  inScope: boolean;
  /** من أين جاء الافتتاحيّ — يُعرَض مع الرقم. */
  openingSource: OpeningSource;
  openingRef: string | null;
  /** ما دخل من المشتريات بإدخالٍ يدويّ — والباقي من الفواتير. */
  manualReceiptsMilli: number;

  flags: LineFlag[];
  /** أصلُ الاستهلاك: أيّ نسخِ وصفاتٍ أسهمت فيه. */
  recipeVersionIds: string[];
  /** وأيّ أسطرِ فواتيرَ بُنيت عليها المشتريات. */
  invoiceLineIds: string[];
  /** وأيّ استلاماتٍ يدويّة. */
  receiptIds: string[];
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
    /** النقصُ والزيادةُ وحجمُهما — لا يتقاصّان (`variance-summary.ts`). */
    summary: VarianceSummary;
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
  const duplicateProducts = new Set((input.receiptDuplicates ?? []).map((d) => d.productId));
  const hasSales = input.soldLines.length > 0;
  /* مكوّناتُ كلّ نسخةٍ ساريةٍ تتقاطع مع الفترة — وبها يُعرَف أنّ الصفرَ صفر */
  const inActiveRecipe = new Set(
    input.recipeVersions
      .filter((v) => v.status === "ACTIVE"
        && v.effectiveFrom <= input.periodEnd
        && (v.effectiveTo === null || v.effectiveTo >= input.periodStart))
      .flatMap((v) => v.ingredients.map((i) => i.productId)),
  );

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
    } else if (hasSales && inActiveRecipe.has(product.id)) {
      /*
        ── لم يُبَع ما يستهلكه — صفرٌ بدليل ──

        الصنفُ مكوّنٌ في وصفةٍ سارية، ومبيعاتُ الفترة مستورَدة، ولم يُبَع
        شيءٌ يصل إليه. فاستهلاكُه **صفرٌ حقيقيّ** كما أنّ مشترياتِ صنفٍ لم
        يُشترَ صفرٌ حقيقيّ. وكان يُقرأ «غير معروف» — فلا يُحسَب لأبطأ
        الأصناف دوراناً فرقٌ أبداً، وهي أحوجُها إلى العدّ.

        والدليلُ شرطان معاً: وصفةٌ تصل إليه (وإلّا فالمجهولُ صادق: لا
        نعرف ما يستهلكه)، ومبيعاتٌ في الفترة (وإلّا فالصفرُ غيابُ ملفّ لا
        غيابُ بيع). وما بِيع ولم يُربَط يُعلَن في التغطية كما كان.
      */
      consumptionMilli = 0;
    }
    if (consumptionMilli === null) flags.push("CONSUMPTION_UNKNOWN");

    const openingMilli = input.openingByProduct.get(product.id) ?? null;
    if (openingMilli === null) flags.push("OPENING_UNKNOWN");
    const openingFrom = input.openingSourceByProduct?.get(product.id);
    const openingSource: OpeningSource = openingMilli === null ? "UNKNOWN" : openingFrom?.source ?? "MOVEMENT";

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
    /*
      ── استلامٌ لم يُحسَم أهو فاتورةٌ أم شحنةٌ أخرى ──

      فالمشترياتُ عشرون أو أربعون — ولا نعرف أيّهما. وقولُ أحدهما دعوى:
      الأربعون تُخفي نقصاً، والعشرون قد تُسقط شحنةً وصلت فعلاً.
    */
    if (duplicateProducts.has(product.id)) {
      purchasesMilli = null;
      flags.push("RECEIPT_POSSIBLE_DUPLICATE");
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

    /*
      ── الخارجُ عن الجرد لا يُحسَب له فرق ──

      والفرقُ يقتضي عدّاً على الرفّ. فصنفٌ لم يُعَدّ عمداً لا يُقال
      عنه «فرقُه صفر» ولا «فرقُه كذا»: يُقال إنّه خارج هذا الجرد.
      ولذلك يُمرَّر إليه `null` مكانَ العدّ ولو كان مكتوباً — **وما
      كُتب يبقى في القاعدة** فيعود متى أُعيد الصنف إلى الجرد.
    */
    const inScope = input.inScopeByProduct?.has(product.id) ?? true;
    const storedActual = input.actualByProduct.get(product.id) ?? null;
    const actualMilli = inScope ? storedActual : null;

    if (!inScope) flags.push("OUT_OF_SCOPE");
    else if (actualMilli === null) flags.push("NOT_COUNTED");
    else linesCounted++;

    const result = stockVariance(terms, actualMilli);
    if (result.varianceMilli !== null) linesWithVariance++;

    /*
      ── ترتيبُ التقييم: الواقعُ قبل التقدير ──

      متوسّطُ شراء الفترة، ثمّ آخرُ كلفةٍ من فاتورةٍ سابقة، ثمّ كلفةُ
      الكتالوج. والأخيرةُ معياريّةٌ يكتبها المقهى في نقاط البيع لا
      ثمنٌ دُفع — فلا تُقدَّم على فاتورة، ولا تُكتَم حين لا فاتورة.
    */
    const fallback = input.fallbackCostByProduct.get(product.id) ?? null;
    const catalog = input.catalogCostByProduct?.get(product.id) ?? null;
    const periodRate = unitCostMilliMinor(bought, product.baseUnit, null);
    const rate = periodRate ?? fallback ?? catalog;
    const valuationBasis: ValuationBasis =
      periodRate !== null ? "PERIOD_WEIGHTED_AVERAGE"
        : fallback !== null ? "LATEST_KNOWN"
          : catalog !== null ? "CATALOG" : "UNKNOWN";
    if (rate === null) flags.push("COST_UNKNOWN");

    const varianceCost = varianceCostMinor(result.varianceMilli, rate, product.baseUnit);
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
      varianceConsumptionBp: result.varianceConsumptionBp,
      varianceBp: result.varianceBp,
      /* ويُعرَض المعدَّلُ مقرَّباً — والحسابُ أعلاه جرى بالمِلّي */
      unitCostMinor: rate === null ? null : milliMinorToMinor(rate),
      unitCostMilliMinor: rate,
      valuationBasis,
      varianceCostMinor: varianceCost,
      inScope,
      openingSource,
      openingRef: openingMilli === null ? null : openingFrom?.ref ?? null,
      manualReceiptsMilli: bought?.manualMilli ?? 0,
      flags,
      recipeVersionIds: used?.recipeVersionIds ?? [],
      invoiceLineIds: bought?.invoiceLineIds ?? [],
      receiptIds: bought?.receiptIds ?? [],
    });
  }

  const coverage = computeCoverage({
    ambiguousReceipts: input.ambiguousReceipts ?? [],
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
    scope: {
      included: lines.filter((l) => l.inScope).length,
      excluded: lines.filter((l) => !l.inScope).map((l) => l.productName),
    },
    receiptDuplicates: (input.receiptDuplicates ?? []).map((d) => ({
      productName: input.products.find((p) => p.id === d.productId)?.nameAr ?? d.productId,
      invoiceNumber: d.invoiceNumber,
      supplierName: d.supplierName,
    })),
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
      summary: summariseVariance(lines),
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
    .filter((l) => l.inScope && l.varianceMilli !== null && l.varianceMilli !== 0)
    .sort((a, b) => {
      const ac = a.varianceCostMinor === null ? -1 : Math.abs(a.varianceCostMinor);
      const bc = b.varianceCostMinor === null ? -1 : Math.abs(b.varianceCostMinor);
      if (ac !== bc) return bc - ac;
      return Math.abs(b.varianceBp ?? 0) - Math.abs(a.varianceBp ?? 0);
    })
    .slice(0, limit);
}
