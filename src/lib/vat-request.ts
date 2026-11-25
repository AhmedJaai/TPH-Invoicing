/**
 * طلبُ فاتورةٍ ضريبيّة من المورّد — لضريبةٍ لا تُخصم لأنّ ورقتَه ينقصها ركن.
 *
 * كانت «ضريبة ضائعة حسب المورّد» تقول «اطلب منهم» ولا تعين على الطلب: نحو ٢٬١٥٠ ريالاً على
 * فواتير مبسّطة بلا رقمنا الضريبي (أوسكا · مود · جملة تقنية · زاكوباك). فيُكتب الطلبُ بأرقام
 * فواتيره وتواريخها وما ينقص كلّاً منها، ويُرسَل من الجوال — لا يُرسَل من هنا شيء.
 *
 * دالّةٌ خالصة.
 */
import { formatDay } from "./riyadh-time";

export interface RequestInvoice {
  number: string;
  /** `YYYY-MM-DD` */
  day: string;
  /** ما ينقص الورقة، بأسماء الأركان كما تُعرض (`missingPillars`). */
  missing: readonly string[];
}

export function buildTaxInvoiceRequest(input: {
  supplierName: string;
  companyName: string;
  companyVat: string | null;
  invoices: readonly RequestInvoice[];
}): string {
  const lines = [...input.invoices]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((i) => `• فاتورة ${i.number || "بلا رقم"} بتاريخ ${formatDay(i.day)}${i.missing.length > 0 ? ` (ينقصها: ${i.missing.join("، ")})` : ""}`);
  return [
    `السلام عليكم ${input.supplierName}،`,
    "",
    `نرجو إصدار فاتورة ضريبية بدلاً من الفواتير التالية، باسم ${input.companyName}${input.companyVat ? ` ورقمنا الضريبي ${input.companyVat}` : ""}:`,
    ...lines,
    "",
    "نحتاجها لخصم ضريبة المدخلات في الإقرار. شاكرين لكم.",
  ].join("\n");
}
