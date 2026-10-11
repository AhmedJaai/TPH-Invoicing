/** عددٌ بالمِلّي للعرض: «1,169» أو «2.5» — بفواصل الآلاف وبلا أصفارٍ زائدة. */
export function formatUnits(milli: number): string {
  const sign = milli < 0 ? "−" : "";
  const abs = Math.abs(Math.round(milli));
  const whole = String(Math.floor(abs / 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

/** نقاطُ الأساس نسبةً بخانةٍ واحدة — معزولةً كي لا تنقلب في سطرٍ عربيّ. و`null` «غير معروف». */
export function formatShare(bp: number | null): string {
  if (bp === null) return "غير معروف";
  const abs = Math.abs(bp);
  const tenths = Math.round(abs / 10);
  return `⁦${bp < 0 ? "−" : ""}${Math.floor(tenths / 10)}.${tenths % 10}٪⁩`;
}
