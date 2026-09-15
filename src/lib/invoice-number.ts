/**
 * رقم الفاتورة موحَّداً للمقارنة — لا للعرض ولا للحفظ.
 *
 * كان كشفُ «الفاتورة مسجّلة مسبقاً» يقارن النصّ حرفاً بحرف. والمزامنة
 * تأخذ الرقم من اسم الملفّ («04»)، والنموذج يقرؤه من الورقة بلا أصفار
 * («4»). فصورةٌ ثانية للفاتورة نفسها مرّت فاتورةً ثانية، وخُصم رصيد
 * المورّد عليها: دَينٌ وهميّ بقيمتها.
 *
 * فيُوحَّد: الأرقام العربية لاتينيّة، والحروف كبيرة، والفواصل (فراغ · -
 * _ / . #) حدٌّ واحد، والحرف والرقم المتلاصقان مقطعان، والأصفار البادئة
 * في المقطع الرقميّ تسقط. فـ«04»=«4»، و«INV/2026/00124»=«INV-2026-124»،
 * و«SI0051»=«SI-51».
 */
export function normalizeInvoiceNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toUpperCase()
    .replace(/([A-Z؀-ۿ])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z؀-ۿ])/g, "$1 $2")
    .split(/[\s\-_/.#\\]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? part.replace(/^0+(?=\d)/, "") : part))
    .join("-");
}

/** رقمان لفاتورةٍ واحدة؟ — والفارغ لا يساوي شيئاً. */
export function sameInvoiceNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeInvoiceNumber(a);
  return x !== "" && x === normalizeInvoiceNumber(b);
}
