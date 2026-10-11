/**
 * نسبةُ ضريبة القيمة المضافة — **موضعٌ واحد**، بأعدادٍ صحيحة.
 *
 * كانت «١٥٪» مكتوبةً بأربع صيغ: `VAT_RATE = 0.15` عائمةً تُضرَب في الهللات
 * (`line-pricing`)، و`15` باليد (`auto-archive`)، وثابتٌ محلّيّ ثانٍ
 * (`validate-extraction`)، و`VAT_PERCENT` هنا. و`1 + 0.15` ليست `1.15` في
 * الفاصلة العائمة: صافٍ ٦٠٫٠٠ × ١٫١٥ كان يخرج ‎٦٨٫٩٩٩٩٩٩٩٩٩٩٩٩٩٩‎ لا ٦٩٫٠٠،
 * فينقلب حدُّ المقارنة عند هللة. ولو تغيّرت النسبة (كما تغيّرت من ٥٪ سنة ٢٠٢٠)
 * لزم تعديلُ أربعة مواضع — وصار واحداً.
 *
 * كلُّ ضربٍ هنا بسطٌ ومقامٌ صحيحان وتقريبٌ واحد إلى الهللة.
 */

/** نسبةُ الضريبة في المملكة: ١٥٪ — فالضريبةُ من المبلغ الشامل ١٥ من ١١٥. */
export const VAT_PERCENT = 15;

/** ضريبةٌ داخل مبلغٍ شاملها، بالهللات وبتقريبٍ واحد. */
export function vatInsideGross(grossMinor: number): number {
  return Math.round((grossMinor * VAT_PERCENT) / (100 + VAT_PERCENT));
}

/** ضريبةُ صافٍ قبلها: ١٥٪ منه، بالهللات وبتقريبٍ واحد — ضربٌ صحيح لا `× 0.15` عائماً. */
export function vatOnNet(netMinor: number): number {
  return Math.round((netMinor * VAT_PERCENT) / 100);
}

/** الصافي داخل مبلغٍ شاملٍ الضريبة: ١٠٠ من ١١٥، بتقريبٍ واحد. */
export function netInsideGross(grossMinor: number): number {
  return Math.round((grossMinor * 100) / (100 + VAT_PERCENT));
}

/** وعاءُ ضريبةٍ معلومة: ١٠٠ من ١٥ منها، بتقريبٍ واحد. */
export function netOfVat(vatMinor: number): number {
  return Math.round((vatMinor * 100) / VAT_PERCENT);
}

/** المبلغُ الشامل الذي فيه هذه الضريبة: ١١٥ من ١٥ منها، بتقريبٍ واحد. */
export function grossOfVat(vatMinor: number): number {
  return Math.round((vatMinor * (100 + VAT_PERCENT)) / VAT_PERCENT);
}

/**
 * الصافي وعليه ضريبتُه — **بلا تقريب**، للمقارنة وحدها («أهذا الإجماليّ شاملٌ
 * الضريبة؟»). ما يُكتَب في القاعدة يمرّ بـ`vatOnNet`، لا من هنا.
 */
export function grossOfNetExact(net: number): number {
  return (net * (100 + VAT_PERCENT)) / 100;
}

/**
 * أتساوي الضريبةُ ١٥٪ من الصافي، بتسامحٍ بالهللات؟ — ‎|الضريبة×١٠٠ − الصافي×١٥| ≤ التسامح×١٠٠،
 * فلا قسمةَ ولا عددَ عشريّاً في المقارنة.
 */
export function vatMatchesStandardRate(subtotalMinor: number, vatMinor: number, toleranceMinor: number): boolean {
  return Math.abs(vatMinor * 100 - subtotalMinor * VAT_PERCENT) <= toleranceMinor * 100;
}
