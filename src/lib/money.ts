/**
 * كل المبالغ في النظام أعداد صحيحة بالهللات.
 * السبب: خطأ «فاتورة بـ٣٬٤٠٠ قُيّدت ١٬٧٠٠» لا يجوز أن يتكرر من جهة النظام،
 * والفاصلة العائمة في جافاسكربت تُنتج 0.1 + 0.2 = 0.30000000000000004.
 */

export const HALALAS_PER_RIYAL = 100;

/** يحوّل نصاً مثل "410.00" أو "410" أو "١٬٢٣٤٫٥٠" إلى هللات. */
export function parseRiyals(input: string): number | null {
  const normalized = input
    .trim()
    // الأرقام العربية الهندية إلى اللاتينية
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    // فاصلة الآلاف العربية واللاتينية
    .replace(/[,٬\s]/g, "")
    // الفاصلة العشرية العربية
    .replace(/٫/g, ".");

  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace("-", "").split(".");
  const halalas = Number(whole) * HALALAS_PER_RIYAL + Number(fraction.padEnd(2, "0"));
  return negative ? -halalas : halalas;
}

/** يحوّل الهللات إلى نص بمنزلتين عشريتين دائماً — "410.00" لا "410". */
export function formatRiyals(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / HALALAS_PER_RIYAL);
  const fraction = String(abs % HALALAS_PER_RIYAL).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** للعرض في الواجهة مع فواصل الآلاف: "17,572.00" */
export function formatRiyalsDisplay(minor: number): string {
  const [whole, fraction] = formatRiyals(minor).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = whole.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${digits}.${fraction}`;
}
