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
