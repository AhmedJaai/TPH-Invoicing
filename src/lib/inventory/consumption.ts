/**
 * الاستهلاك المتوقَّع — «كم كان ينبغي أن يُصرَف؟»
 *
 * وهذا هو قلبُ النظام: يُحسَب **استقلالاً** عن جرد نقاط البيع، من
 * المبيعات الفعليّة ووصفاتها. فإن قال فودكس شيئاً وقال هذا شيئاً
 * فالسؤالُ مفتوحٌ لا محسوم — ولهذا وُجد النظام أصلاً.
 *
 * ── الحالاتُ الثلاث التي تُفرَّق ولا تُجمَع ──
 *
 *   **الملغى**   يُستبعَد كلّه — لم يُصنَع أصلاً، فلا شيءَ خرج من الرفّ.
 *   **المرتجَع** نوعان (أحمد، ٢٤ أكتوبر ٢٠٢٦؛ والحَكَمُ جوابُ الكاشير منذ ٣١ أكتوبر):
 *                — **ما حُضِّر** (وصفتُه فيها مكوّنٌ يوزَن أو يُكال): صُنع ثمّ رُدّ،
 *                  فمكوّناتُه **استُهلكت وهُدرت** — لا يُنقص الاستهلاكَ (بيعتُه الأصليّة
 *                  حسبته)، ويُعَدّ هدراً بسبب «مرتجع بعد التحضير» (`fromReturnedWasteMilli`).
 *                — **الجاهزُ** (مكوّناتُه كلُّها بالحبّة: قارورةٌ، قطعةٌ مغلّفة): يعود إلى
 *                  الرفّ فيُنقص الاستهلاك كما كان.
 *   **المجانيّ** يُحسَب استهلاكاً — صُنع فعلاً وخرجت مكوّناتُه — **ويُعرَض
 *                على حدة**، فهو يفسّر جزءاً من الفرق بلا أن يكون فاقداً.
 *
 * ومن جمع الثلاثةَ في رقمٍ واحد أخطأ في ثلاثة.
 */
import type { StoredUnit } from "@/lib/unit-conversion";
import { sameUnitFamily, toCanonical } from "./units";
import {
  DEFAULT_YIELD_MILLI,
  effectiveVersion,
  type RecipeVersionInput,
} from "./recipe";

/** سطرُ بيعةٍ كما يصل المحرّك — محايدٌ عن مصدره: إكسل أو واجهة. */
export interface SoldLineInput {
  saleId: string;
  lineId: string;
  /** YYYY-MM-DD بتوقيت عمل المقهى. */
  businessDate: string;
  /** اسمُ صنف نقاط البيع — يُعرَض حين لا يكون مربوطاً. */
  posProductName: string;
  posProductExternalId: string | null;
  /** صنفُ القائمة بعد الربط، أو `null` — «غير مربوط». */
  menuProductId: string | null;
  /** الكمّيّة المباعة بالمِلّي (١٠٠ مشروبٍ = ‏١٠٠٬٠٠٠). */
  quantityMilli: number;
  lineTotalMinor: number;
  isRefund: boolean;
  /**
   * جوابُ الكاشير عند الردّ: أهُدرت المكوّنات؟ (`is_ingredients_wasted` في فودكس، ٠٩٣) — `null`
   * لا جوابَ له (مرتجعٌ لم يُقرأ من الواجهة). وهو الحَكَم لا الوصفة (أحمد، ٣١ أكتوبر ٢٠٢٦).
   */
  ingredientsWasted?: boolean | null;
  isVoid: boolean;
  isComplimentary: boolean;
  /**
   * رموزُ الخيارات على هذا البند كما وردت من المصدر.
   *
   * تُحفَظ دائماً، **ولا تزيد مكوّناً** إلّا إذا رُبط بها مكوّنٌ صراحةً.
   */
  modifierExternalIds?: readonly string[];
}

/** سببُ خروج سطرٍ من الحساب — يُعرَض، ولا يُدفَن. */
export type ExclusionReason =
  | "VOID"
  | "UNMAPPED_POS_PRODUCT"
  | "NO_RECIPE"
  | "NO_EFFECTIVE_VERSION"
  | "EMPTY_RECIPE"
  | "UNSUPPORTED_YIELD_UNIT";

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  VOID: "عملية بيع ملغاة، فلم يُحضَّر المنتج",
  UNMAPPED_POS_PRODUCT: "منتج فودكس غير مربوط بصنف في نظامنا",
  NO_RECIPE: "لا وصفة لهذا الصنف",
  NO_EFFECTIVE_VERSION: "لا نسخة وصفة سارية في تاريخ البيع",
  EMPTY_RECIPE: "وصفة بلا مكوّنات",
  UNSUPPORTED_YIELD_UNIT: "وحدة ناتج الوصفة لا يمكن تحويلها إلى عدد المباع",
};

export interface IngredientConsumption {
  productId: string;
  /** بالمِلّي من الوحدة الصغرى في عائلة المكوّن. */
  canonicalMilli: number;
  /** وحدةُ المكوّن كما كُتبت في الوصفة — تحدّد عائلةَ الرقم أعلاه. */
  unit: StoredUnit;
  /** وممّا تكوّن: بيعاتٌ عاديّة، ومجانيّة، ومرتجَعة. */
  fromSalesMilli: number;
  fromComplimentaryMilli: number;
  fromRefundsMilli: number;
  /**
   * مرتجعٌ بعد التحضير — ما خرج في مشروبٍ صُنع ثمّ رُدّ. **داخلٌ في الاستهلاك**
   * (حسبته بيعتُه الأصليّة) ويُعرَض هدراً على حدة، فلا يُضاف إلى `canonicalMilli`.
   */
  fromReturnedWasteMilli: number;
  /** نسخُ الوصفات التي أسهمت — أصلُ الرقم، ويُحفَظ في اللقطة. */
  recipeVersionIds: string[];
  /**
   * وصفتان تذكران المكوّن نفسه بعائلتين مختلفتين — جراماً هنا ومليلتراً هناك.
   *
   * ولا يُجمَعان: لترُ الحليب ليس كيلواً. فيُعلَن التضارب ويُستبعَد
   * المكوّن، ولا يُخترَع معامِلُ كثافة.
   */
  unitConflict: StoredUnit | null;
}

export interface ExcludedLine {
  lineId: string;
  posProductName: string;
  posProductExternalId: string | null;
  menuProductId: string | null;
  businessDate: string;
  quantityMilli: number;
  lineTotalMinor: number;
  reason: ExclusionReason;
}

export interface ConsumptionResult {
  /** بمفتاح `productId` للمكوّن. */
  byIngredient: Map<string, IngredientConsumption>;
  /** المرتجعُ بعد التحضير: كم سطراً وكم وحدة — يُعرَض هدراً، والاستهلاكُ حسبه. */
  returnedAfterPrep: { lines: number; unitsMilli: number };
  included: {
    lines: number;
    unitsMilli: number;
    totalMinor: number;
  };
  excluded: ExcludedLine[];
  excludedTotals: {
    lines: number;
    unitsMilli: number;
    totalMinor: number;
  };
}

/**
 * كم من المكوّن يخرج لبيع كمّيّةٍ من صنفِ قائمة؟
 *
 * ```
 *   المكوّن = (الكمّيّة المباعة × كمّيّة المكوّن) ÷ ناتج الوصفة
 * ```
 *
 * والكلُّ بالمِلّي: ‏١٠٠ مشروب = ‏١٠٠٬٠٠٠، و١٨ جراماً = ‏١٨٬٠٠٠،
 * والناتجُ الافتراضيّ ‏١٬٠٠٠ (وحدةٌ واحدة). فالحاصل ‏١٬٨٠٠٬٠٠٠
 * مِلّي‑جرام = ‏١٫٨ كجم بالضبط.
 *
 * ثمّ **فاقدُ التجهيز** إن عُرف: ما يُوزَن ٢٠ جراماً في الكيس قد يصل
 * الكوبَ منه ١٩ — فالمصروفُ من الرفّ أكبرُ من المكتوب في الوصفة.
 * ‏`q ÷ (1 − loss)` لا `q × (1 + loss)`: الفاقدُ نسبةٌ من **المصروف**
 * لا من الواصل.
 */
/**
 * أقصى فاقدِ تجهيزٍ يُحسَب به — دون المئة بالمئة.
 *
 * القسمةُ على `(1 − الفاقد)`: مئةٌ بالمئة قسمةٌ على صفر (∞)، وما فوقها
 * استهلاكٌ **سالب** — وكلاهما كان يُكتب في سطر الجرد. وذاك خطأٌ حسابيٌّ يقينيّ
 * فيُردّ عند الحفظ؛ وما دونه يُقبَل كما كتبه صاحبُه ولو كبُر.
 */
export const MAX_PREP_LOSS_BP = 9_999;

export function ingredientForSale(
  soldQuantityMilli: number,
  ingredientQuantityMilli: number,
  yieldMilli: number,
  prepLossBp: number | null,
  /**
   * يُضرب قبل التقريب — لا بعده. وصفةٌ بالكيلو و٠٫٤ جرام للبيعة كانت تُقرَّب
   * في وحدتها (٠٫٤ مِلّي‑كيلو ← صفر) ثمّ تُحوَّل، فيضيع المكوّنُ من كلّ سطر.
   * فيُمرَّر عاملُ الوحدة الأصغر (`toCanonical(1, unit)`) ويُقرَّب مرّةً واحدة.
   */
  scale = 1,
): number {
  const base = (soldQuantityMilli * ingredientQuantityMilli * scale) / yieldMilli;
  if (prepLossBp === null || prepLossBp <= 0) return Math.round(base);
  return Math.round((base * 10_000) / (10_000 - Math.min(prepLossBp, MAX_PREP_LOSS_BP)));
}

/**
 * أحُضِّرت هذه الوصفة؟ — فيها مكوّنٌ يوزَن أو يُكال (بنّ، حليب، شراب).
 * والجاهزُ مكوّناتُه كلُّها بالحبّة أو العبوة (قارورة ماء، قطعةُ كيكٍ وعلبتُها)
 * فيعود المرتجَعُ منه إلى الرفّ.
 */
export function isPreparedRecipe(version: Pick<RecipeVersionInput, "ingredients">): boolean {
  return version.ingredients.some((i) => i.unit !== "PIECE" && i.unit !== "PACK");
}

/**
 * الاستهلاك المتوقَّع لكلّ مكوّن، ومعه **ما لم يُحسَب ولماذا**.
 *
 * والثاني ليس أقلّ أهمّيّةً من الأوّل: تقريرٌ يقول «الفرق ٢٫٥ كجم»
 * وقد أسقط ثلث المبيعات صامتاً أسوأُ من تقريرٍ لا يوجد.
 */
export function computeConsumption(
  lines: readonly SoldLineInput[],
  versionIndex: Map<string, RecipeVersionInput[]>,
): ConsumptionResult {
  const byIngredient = new Map<string, IngredientConsumption>();
  const excluded: ExcludedLine[] = [];

  let includedLines = 0;
  let includedUnits = 0;
  let includedTotal = 0;
  let returnedLines = 0;
  let returnedUnits = 0;

  const exclude = (line: SoldLineInput, reason: ExclusionReason) => {
    excluded.push({
      lineId: line.lineId,
      posProductName: line.posProductName,
      posProductExternalId: line.posProductExternalId,
      menuProductId: line.menuProductId,
      businessDate: line.businessDate,
      quantityMilli: line.quantityMilli,
      lineTotalMinor: line.lineTotalMinor,
      reason,
    });
  };

  for (const line of lines) {
    /* الملغى لم يُصنَع — ولا يُعَدّ فجوةَ تغطية، فهو مستثنىً بحقّ */
    if (line.isVoid) {
      exclude(line, "VOID");
      continue;
    }
    if (!line.menuProductId) {
      exclude(line, "UNMAPPED_POS_PRODUCT");
      continue;
    }

    const version = effectiveVersion(versionIndex, line.menuProductId, line.businessDate);
    if (!version) {
      exclude(line, versionIndex.has(line.menuProductId) ? "NO_EFFECTIVE_VERSION" : "NO_RECIPE");
      continue;
    }
    if (version.ingredients.length === 0) {
      exclude(line, "EMPTY_RECIPE");
      continue;
    }

    /*
      ناتجُ الوصفة عدداً ممّا يُباع — والحبّة وحدها تُترجَم إليه.
      ودفعةُ شرابٍ ناتجُها «٢ لتر» وصفةٌ فرعيّة لا وصفةُ صنفٍ يُباع،
      ولا تُحوَّل لترٌ إلى «عددِ أكواب» بلا حجمِ كوبٍ معلوم. فتُستبعَد
      وتُعلَن، ولا يُفترَض لها ناتجٌ واحد.
    */
    let yieldMilli = DEFAULT_YIELD_MILLI;
    if (version.yieldQuantityMilli !== null && version.yieldUnit !== null) {
      if (version.yieldUnit !== "PIECE") {
        exclude(line, "UNSUPPORTED_YIELD_UNIT");
        continue;
      }
      yieldMilli = version.yieldQuantityMilli;
    }

    /*
      المرتجَعُ المحضَّر لا يُنقص (استُهلك ثمّ هُدر)، والجاهزُ يعود إلى الرفّ فيُنقص.
      والمجانيّ يُزيد ويُعَدّ على حدة. ومبلغُ المرتجَع يُنقص المبيعات في الحالين.
    */
    /*
      الكاشيرُ يقول عند كلّ ردٍّ أهُدرت المكوّنات (أحمد، ٣١ أكتوبر ٢٠٢٦: «اعتمد قاعدة الكاشير»):
      نعم ← استُهلكت وهُدرت؛ لا ← عادت إلى الرفّ كما يعيدها فودكس. وبلا جوابٍ وحده يُحكَم
      بالوصفة كما كان — كانت الوصفةُ تعدّ ١١١ مرتجعاً هدراً في ثمانية أسابيع والكاشيرُ ٣٤ منذ مايو.
    */
    const returnedMade = line.isRefund && (line.ingredientsWasted ?? isPreparedRecipe(version));
    const sign = line.isRefund ? -1 : 1;
    const useSign = returnedMade ? 0 : sign;

    includedLines++;
    includedUnits += sign * line.quantityMilli;
    includedTotal += sign * line.lineTotalMinor;
    if (returnedMade) {
      returnedLines++;
      returnedUnits += line.quantityMilli;
    }

    const present = new Set(line.modifierExternalIds ?? []);

    for (const ing of version.ingredients) {
      /*
        ── المكوّنُ المرتبطُ بخيارٍ لا يُحسَب إلّا بحضوره ──

        وأكثرُ الخيارات لا تزيد شيئاً: «دبل شوت» خيارٌ داخل الوصفة.
        فالحقلُ فارغٌ في الغالب، ومتى مُلئ بقرار إنسان («إكسترا شوت
        يزيد ١٨ جراماً») حُسب على البنود التي تحمله وحدها.
      */
      if (ing.modifierExternalId && !present.has(ing.modifierExternalId)) continue;

      const canonical = ingredientForSale(
        line.quantityMilli,
        ing.quantityMilli,
        yieldMilli,
        ing.prepLossBp,
        toCanonical(1, ing.unit),
      );

      let acc = byIngredient.get(ing.productId);
      if (!acc) {
        acc = {
          productId: ing.productId,
          canonicalMilli: 0,
          unit: ing.unit,
          fromSalesMilli: 0,
          fromComplimentaryMilli: 0,
          fromRefundsMilli: 0,
          fromReturnedWasteMilli: 0,
          recipeVersionIds: [],
          unitConflict: null,
        };
        byIngredient.set(ing.productId, acc);
      } else if (!sameUnitFamily(acc.unit, ing.unit) && acc.unitConflict === null) {
        acc.unitConflict = ing.unit;
      }

      acc.canonicalMilli += canonical * useSign;
      if (returnedMade) acc.fromReturnedWasteMilli += canonical;
      else if (line.isRefund) acc.fromRefundsMilli -= canonical;
      else if (line.isComplimentary) acc.fromComplimentaryMilli += canonical;
      else acc.fromSalesMilli += canonical;

      if (!acc.recipeVersionIds.includes(version.id)) acc.recipeVersionIds.push(version.id);
    }
  }

  return {
    byIngredient,
    returnedAfterPrep: { lines: returnedLines, unitsMilli: returnedUnits },
    included: { lines: includedLines, unitsMilli: includedUnits, totalMinor: includedTotal },
    excluded,
    excludedTotals: {
      lines: excluded.length,
      unitsMilli: excluded.reduce((s, e) => s + e.quantityMilli, 0),
      totalMinor: excluded.reduce((s, e) => s + e.lineTotalMinor, 0),
    },
  };
}
