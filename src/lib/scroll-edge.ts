/**
 * حسابُ حافّة التمرير الأفقيّ — نقيٌّ ليُختبَر، ويرسمه `ScrollX` و`ScrollStrip`.
 *
 * في الاتّجاه من اليمين إلى اليسار يكون `scrollLeft` سالباً أو صفراً في
 * المتصفّحات الحديثة، فيؤخذ مطلقه. والسماح ببكسلٍ واحد لأنّ القياس كسريّ عند
 * بعض مستويات التكبير، فيبقى فرقٌ لا يُرى ويُنتج حافّةً كاذبة.
 */
export type OverflowSide = "none" | "start" | "end" | "both";

export function overflowSide(scrollWidth: number, clientWidth: number, scrollLeft: number): OverflowSide {
  const max = scrollWidth - clientWidth;
  if (max <= 1) return "none";
  const at = Math.abs(scrollLeft);
  if (at <= 1) return "end";
  if (at >= max - 1) return "start";
  return "both";
}

/**
 * كم يُمرَّر الشريطُ أفقياً ليقع اللسانُ المختار في وسطه — صفرٌ إن كان ظاهراً
 * كلُّه. بالبكسل المادّيّ (يسار/يمين الشاشة)، فيصحّ في الاتّجاهين: إضافتُه إلى
 * `scrollLeft` تحرّك المحتوى بالقدر نفسه في RTL وLTR.
 */
export function revealDelta(
  container: { left: number; right: number },
  item: { left: number; right: number },
): number {
  const fits = item.left >= container.left - 1 && item.right <= container.right + 1;
  if (fits) return 0;
  return Math.round((item.left + item.right) / 2 - (container.left + container.right) / 2);
}
