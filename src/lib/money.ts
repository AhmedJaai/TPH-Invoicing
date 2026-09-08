/**
 * كل المبالغ في النظام أعداد صحيحة بالهللات.
 * السبب: خطأ «فاتورة بـ٣٬٤٠٠ قُيّدت ١٬٧٠٠» لا يجوز أن يتكرر من جهة النظام،
 * والفاصلة العائمة في جافاسكربت تُنتج 0.1 + 0.2 = 0.30000000000000004.
 */

export const HALALAS_PER_RIYAL = 100;

/**
 * ما يُتسامح فيه بين (الصافي + الضريبة) والإجمالي المطبوع.
 *
 * وُجد في فواتير حقيقية أنّ المورّد يُسقط كسور الريال من الإجمالي:
 * «ملتقى الأواني» ٥٢٥٫٠٠ + ٧٨٫٧٥ = ٦٠٣٫٧٥ والمطبوع ٦٠٣٫٠٠، و«مختبرات
 * القهوة» ٥٧٤٫٠٠ + ٨٦٫١٠ = ٦٦٠٫١٠ والمطبوع ٦٦٠٫٠٠.
 *
 * والمطبوع هو الملزِم. فيُتسامح بريالٍ واحد — وهو أقصى ما يُنتجه
 * التقريب إلى الريال — وما جاوزه خطأُ قراءةٍ لا تقريب.
 */
export const TOTAL_ROUNDING_TOLERANCE_MINOR = HALALAS_PER_RIYAL;

/** هل الفرق بين المجموع والإجمالي تقريبُ مورّد لا خطأ قراءة؟ */
export function isSupplierRounding(
  subtotalMinor: number,
  vatMinor: number,
  totalMinor: number,
): boolean {
  const diff = Math.abs(subtotalMinor + vatMinor - totalMinor);
  return diff > 0 && diff <= TOTAL_ROUNDING_TOLERANCE_MINOR;
}

/** يحوّل نصاً مثل "410.00" أو "410" أو "١٬٢٣٤٫٥٠" إلى هللات. */
export function parseRiyals(input: string): number | null {
  const normalized = input
    .trim()
    // الأرقام العربية الهندية إلى اللاتينية
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    /*
      رمزُ العملة يُسقَط.

      المورّدون يكتبون المبلغ ومعه عملتُه: «1,151.15 SR». وكان يُردّ
      `null` — أي «لم يُقرأ» — فلا تُنشَأ فاتورةٌ لمستندٍ قُرئ كاملاً،
      فيبقى في الأرشيف بلا رقمٍ ولا اسمٍ ولا ظهورٍ في البحث.

      والإسقاط مقصورٌ على رموزٍ معلومة: ما ليس منها يبقى فيُردّ المبلغ،
      فالحرفُ الغريب في رقمٍ ماليّ خبرٌ لا يُتجاهَل.
    */
    .replace(/\b(?:SAR|SR)\b/gi, "")
    /*
      والعربيّ بلا `\b`.

      حدُّ الكلمة في JS مبنيٌّ على `\w` وهي محارف لاتينية، فلا يقع بين
      فراغٍ وحرفٍ عربيّ — و`\bريال\b` لا تطابق «1250 ريال» أبداً.
      مصيدةٌ وقعت في `bank/parsers/detect.ts` من قبل ومكتوبةٌ في
      CLAUDE.md، فتُتجنَّب هنا بالمطابقة المباشرة.
    */
    .replace(/(?:ريالات|ريالاً|ريالا|ريال|ر\.?\s?س|﷼)/g, "")
    // فاصلة الآلاف العربية واللاتينية
    .replace(/[,٬\s]/g, "")
    // الفاصلة العشرية العربية
    .replace(/٫/g, ".");

  /*
    ثلاث منازلٍ آخرُها صفر — «437.000».

    بعض أنظمة الفوترة تطبع ثلاث منازل. و«437.000» ريالاً هو «437.00»
    يقيناً، لا تقريباً. فتُقبَل المنزلة الثالثة **إن كانت صفراً وحدها**،
    ويُردّ ما سواها: «437.005» مبلغٌ لا يُمثَّل بالهللات، وحسمُه تخمين
    — والمجهول يُعلَن ولا يُقرَّب.
  */
  const threeDecimals = /^(-?\d+\.\d{2})0$/.exec(normalized);
  const cleaned = threeDecimals ? threeDecimals[1] : normalized;

  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace("-", "").split(".");
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
