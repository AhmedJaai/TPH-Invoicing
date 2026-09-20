/**
 * معادلةُ المخزون — وما لا يُعرَف حدٌّ منه لا يُحسَب.
 *
 * ```
 *     الافتتاحيّ
 *   + المشتريات
 *   + تسوياتٌ ونقلٌ داخل
 *   − الاستهلاك المتوقَّع
 *   − الهدر المسجَّل
 *   − نقلٌ خارج
 *   ─────────────────────
 *   = المخزون الختاميّ المتوقَّع
 *
 *     الفرق  = الفعليّ − المتوقَّع
 * ```
 *
 * ── لماذا `null` تنتشر ولا تُبتَلع ──
 *
 * افتتاحيٌّ مجهول + مشترياتٌ ٢٠ كجم = **مجهول**، لا ٢٠. ولو قُرئ
 * المجهولُ صفراً لصار المتوقَّعُ ٢٠ والجردُ ١٠٫٥، فيُعلَن نقصٌ ٩٫٥ كجم
 * سببُه أنّنا لم نعرف الافتتاحيّ — **ويُتَّهم به أحد**.
 *
 * وهذا هو القيد الرابع في هذا المشروع مطبَّقاً على المخزون: المجهول
 * ليس صفراً. والفرقُ بينهما أنّ الصفرَ خبرٌ («لم يكن على الرفّ شيء»)
 * والفراغَ اعترافٌ («لا نعرف»).
 *
 * ── وما يُعرَف صفرُه يبقى صفراً ──
 *
 * الهدرُ المسجَّل والتسوياتُ صفرُها حقيقيّ: لم يُسجَّل هدرٌ يعني أنّه
 * لم يُسجَّل، وهو خبرٌ تامّ عن سجلٍّ نملكه كلَّه.
 */

/** الفرقُ يُنسَب إلى المتوقَّع — بنقاط الأساس، عدداً صحيحاً (١٠٠ = ١٪). */
export const BP = 10_000;

export interface StockTerms {
  openingMilli: number | null;
  purchasesMilli: number | null;
  adjustmentsInMilli: number;
  adjustmentsOutMilli: number;
  theoreticalConsumptionMilli: number | null;
  recordedWasteMilli: number;
}

export interface StockResult {
  theoreticalClosingMilli: number | null;
  varianceMilli: number | null;
  varianceBp: number | null;
}

/**
 * المخزون الختاميّ المتوقَّع.
 *
 * ولا تُقصّ النتيجةُ عند الصفر: مخزونٌ متوقَّعٌ سالب **خبرٌ** — إمّا
 * شراءٌ لم يُقيَّد، وإمّا وصفةٌ تبالغ، وإمّا افتتاحيٌّ أقلّ ممّا كان.
 * وقصُّه عند الصفر يُخفي السؤالَ بدل أن يطرحه.
 */
export function theoreticalClosing(terms: StockTerms): number | null {
  if (terms.openingMilli === null) return null;
  if (terms.purchasesMilli === null) return null;
  if (terms.theoreticalConsumptionMilli === null) return null;

  return (
    terms.openingMilli +
    terms.purchasesMilli +
    terms.adjustmentsInMilli -
    terms.adjustmentsOutMilli -
    terms.theoreticalConsumptionMilli -
    terms.recordedWasteMilli
  );
}

/**
 * الفرق ونسبتُه.
 *
 * والنسبةُ تُنسَب إلى **المتوقَّع** لا إلى الفعليّ: السؤال «كم ضاع
 * ممّا كان ينبغي أن يكون» لا «كم يزيد ما وُجد». وحين يكون المتوقَّع
 * صفراً فالنسبةُ **غير معرَّفة** ولا تُكتب: القسمةُ على صفرٍ لا تُصلَح
 * بمئةٍ ولا بصفر.
 */
export function stockVariance(terms: StockTerms, actualMilli: number | null): StockResult {
  const closing = theoreticalClosing(terms);
  if (closing === null || actualMilli === null) {
    return { theoreticalClosingMilli: closing, varianceMilli: null, varianceBp: null };
  }

  const variance = actualMilli - closing;
  const bp = closing === 0 ? null : Math.round((variance * BP) / Math.abs(closing));
  return { theoreticalClosingMilli: closing, varianceMilli: variance, varianceBp: bp };
}

/** نقاطُ الأساس نسبةً مئويّةً للعرض — «‏١٩٫٢‑٪». */
export function formatBp(bp: number | null): string {
  if (bp === null) return "غير معروف";
  const pct = Math.round(Math.abs(bp) / 10) / 10;
  const sign = bp > 0 ? "+" : bp < 0 ? "−" : "";
  return `${sign}${pct}٪`;
}
