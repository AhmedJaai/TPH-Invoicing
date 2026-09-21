/**
 * الوصفة ونسختُها السارية.
 *
 * ── لماذا النسخُ مؤرَّخة ──
 *
 * غُيّرت جرعةُ البنّ من ٢٠ جراماً إلى ١٨ في ٨ سبتمبر. فحسابُ الأسبوع
 * الأوّل بالوصفة الأحدث يقول إنّ المقهى استهلك ‏١٨٠٠ جرامٍ وقد استهلك
 * ‏٢٠٠٠ — فيظهر فرقٌ قدرُه مئتا جرامٍ لم يقع. **والتقريرُ الذي يتغيّر
 * كلّما عُدّلت وصفةٌ ليس تقريراً تاريخياً.**
 *
 * فكلُّ بيعةٍ تأخذ النسخةَ السارية **في تاريخ عملها هي**، لا الأحدثَ
 * ولا الأولى. وفي الأسبوع الواحد قد تعمل نسختان.
 */
import type { StoredUnit } from "@/lib/unit-conversion";

export interface RecipeIngredientInput {
  productId: string;
  /**
   * مكوّنٌ لا يُحسَب إلّا مع هذا الخيار.
   *
   * فارغٌ = يخصّ الوصفة كلَّها. و**«دبل شوت» في هذا المقهى خيارٌ داخل
   * الوصفة لا إضافةُ بنّ** — قالها صاحبُه، ويؤيّدها الملفّ: سعرُه صفرٌ
   * في ١٥٨ مرّة. فلا يُملأ هذا الحقلُ إلّا بقرار إنسان.
   */
  modifierExternalId?: string | null;
  /** بالمِلّي من `unit`. */
  quantityMilli: number;
  unit: StoredUnit;
  /** فاقدُ التجهيز بنقاط الأساس (١٠٠ = ١٪) — و`null` «لم يُقَس» لا «صفر». */
  prepLossBp: number | null;
}

export interface RecipeVersionInput {
  id: string;
  recipeId: string;
  /** صنفُ القائمة الذي تصفه. */
  menuProductId: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  /** YYYY-MM-DD شاملاً. */
  effectiveFrom: string;
  /** YYYY-MM-DD شاملاً، أو `null` — «سارية إلى الآن». */
  effectiveTo: string | null;
  /** ناتجُ الوصفة إن كانت دفعةً: «هذه الكمّيّات تُنتج ٤ أكواب». */
  yieldQuantityMilli: number | null;
  yieldUnit: StoredUnit | null;
  ingredients: readonly RecipeIngredientInput[];
}

/** الافتراض: كمّيّاتُ الوصفة تُنتج وحدةً واحدة مباعة. */
export const DEFAULT_YIELD_MILLI = 1000;

/**
 * بدايةُ السجلّ — تاريخُ سريان **أوّل** نسخةٍ لأيّ وصفة.
 *
 * ── ولماذا لا تبدأ اليوم ──
 *
 * أوّلُ نسخةٍ تصف **كيف كان يُصنَع المشروب دائماً**، لا كيف سيُصنَع من
 * الغد. فلو بدأت يومَ رفعها لخرج كلُّ بيعٍ قبلها «بلا نسخةٍ سارية»،
 * ولا يُحسَب له استهلاك.
 *
 * وقد وقع ذلك بعينه: رُفع الكتالوج في ٢١ سبتمبر بتاريخ سريانٍ
 * افتراضيّه أوّلُ الأسبوع القادم (٢٠ سبتمبر)، والجردُ على أسبوع
 * ‏١٣–١٩. فقالت الشاشة **«لم يدخل الحسابَ سطرُ بيعٍ واحد»** —
 * ‏١٧٠٦ سطراً من ١٧١٧، تسعةٌ وتسعون فاصلة ثمانية في المئة من الوحدات
 * المباعة. والوصفاتُ كلُّها مكتوبةٌ صحيحة، والمحرّكُ سليم، والتاريخُ
 * وحده أبطلها.
 *
 * **والتغييرُ اللاحق وحده هو الذي يُؤرَّخ**: نسخةٌ ثانية بتاريخٍ
 * يقول «من هنا صار كذا»، وتُغلَق سابقتُها قبله بيوم. فيبقى تقريرُ
 * ما مضى محسوباً بما كان.
 */
export const RECIPE_EPOCH = "2000-01-01";

/** أهذه النسخةُ سارية منذ البداية؟ — تُعرَض «منذ البداية» لا بتاريخٍ لا معنى له. */
export function isSinceBeginning(effectiveFrom: string): boolean {
  return effectiveFrom <= RECIPE_EPOCH;
}

/**
 * هل تسري هذه النسخةُ في هذا اليوم؟
 *
 * والمقارنةُ نصّيّة لأنّ التواريخ `YYYY-MM-DD` — وهي صيغةٌ ترتيبُها
 * المعجميّ هو ترتيبُها الزمنيّ. ولا `Date` هنا: بناءُ تاريخٍ من نصٍّ
 * يجرّ منطقةَ الجلسة معه، وقد كلّفنا ذلك درساً في `032`.
 */
export function versionCoversDate(v: RecipeVersionInput, businessDate: string): boolean {
  if (v.status !== "ACTIVE") return false;
  if (businessDate < v.effectiveFrom) return false;
  if (v.effectiveTo !== null && businessDate > v.effectiveTo) return false;
  return true;
}

/**
 * فهرسٌ للبحث السريع: صنفُ القائمة ← نسخُه مرتَّبةً.
 *
 * والترتيبُ بالأحدثِ أوّلاً كي تُوجَد النسخةُ الغالبة في أوّل مقارنة —
 * وأكثرُ المبيعات في آخر فترةٍ من الوصفات.
 */
export function indexRecipeVersions(
  versions: readonly RecipeVersionInput[],
): Map<string, RecipeVersionInput[]> {
  const byProduct = new Map<string, RecipeVersionInput[]>();
  for (const v of versions) {
    const list = byProduct.get(v.menuProductId);
    if (list) list.push(v);
    else byProduct.set(v.menuProductId, [v]);
  }
  for (const list of byProduct.values()) {
    list.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.version - a.version));
  }
  return byProduct;
}

/**
 * النسخةُ السارية لصنفٍ في يوم.
 *
 * وترجع `null` حين لا تسري نسخةٌ — **ولا تُرجع الأقربَ ولا الأحدث**.
 * فالبيعةُ التي لا وصفةَ لها في يومها تُعلَن ناقصةَ تغطية، ولا
 * يُخترَع لها استهلاك.
 */
export function effectiveVersion(
  index: Map<string, RecipeVersionInput[]>,
  menuProductId: string,
  businessDate: string,
): RecipeVersionInput | null {
  const list = index.get(menuProductId);
  if (!list) return null;
  return list.find((v) => versionCoversDate(v, businessDate)) ?? null;
}
