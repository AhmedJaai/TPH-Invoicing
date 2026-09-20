/**
 * فهمُ ترويسات ملفّ المبيعات — بالاسم لا بالموضع.
 *
 * ── لماذا ليس بالموضع ──
 *
 * تصديرُ فودكس يختلف بين تقريرٍ وآخر، وبين لغةِ الحساب وأخرى، وبين
 * نسخةٍ ونسخة: عمودٌ يُضاف في الوسط فيزيح ما بعده. والقارئُ الذي يثق
 * بالموضع يقرأ «الكمّيّة» من عمود السعر **بلا أن يشكو** — ثمّ يُبنى
 * على ذلك جردُ أسبوع.
 *
 * والترويسةُ تُقارَن بعد تطبيعٍ يُسقط الفراغات وعلامات الترقيم
 * وأشكال العرض العربيّة: «صافي المبيعات» و«صافي  المبيعات» و«Net
 * Sales» و«net_sales» كلُّها شيءٌ واحد.
 *
 * ── وما لم يُفهَم يُعلَن ──
 *
 * الأعمدةُ غير المعروفة تُعرَض بأسمائها في شاشة الاستيراد. فمن أضاف
 * فودكس عموداً جديداً يعرف أنّنا لا نقرؤه، ولا يظنّ أنّنا قرأناه.
 */

/** الحقولُ التي يعرفها النظام. */
export type SalesColumn =
  | "orderId" | "businessDate" | "soldAt" | "branch"
  | "productExternalId" | "productName" | "category"
  | "quantity" | "unitPrice" | "lineTotal" | "gross" | "discount" | "refund" | "vat"
  | "isVoid" | "isRefund" | "isComplimentary" | "modifiers";

/**
 * المرادفات.
 *
 * والترتيب داخل كلّ قائمةٍ مقصود: يُجرَّب الأخصُّ قبل الأعمّ. فـ«net
 * sales» قبل «net»، و«رقم الطلب» قبل «الطلب» — وإلّا التقط العامُّ
 * عموداً ليس له.
 */
const RAW_SYNONYMS: Record<SalesColumn, readonly string[]> = {
  orderId: ["ordernumber", "orderid", "orderreference", "orderno", "receiptnumber", "invoicenumber", "رقمالطلب", "رقمالفاتورة", "رقمالإيصال", "الطلب"],
  businessDate: ["businessdate", "businessday", "تاريخالعمل", "يومالعمل", "التاريخ", "date"],
  soldAt: ["datetime", "createdat", "orderdate", "closedat", "time", "التاريخوالوقت", "الوقت"],
  branch: ["branchname", "branch", "store", "location", "الفرع", "اسمالفرع", "المتجر"],
  productExternalId: ["productid", "productsku", "sku", "itemid", "itemcode", "barcode", "رمزالصنف", "رقمالصنف", "الرمز"],
  productName: ["productname", "itemname", "product", "item", "name", "اسمالصنف", "اسمالمنتج", "الصنف", "المنتج"],
  category: ["categoryname", "category", "productcategory", "group", "التصنيف", "القسم", "المجموعة"],
  quantity: ["quantity", "qty", "soldquantity", "quantitysold", "count", "الكمية", "الكميةالمباعة", "العدد"],
  unitPrice: ["unitprice", "priceperunit", "price", "سعرالوحدة", "السعر"],
  lineTotal: ["netsales", "nettotal", "netamount", "linetotal", "totalsales", "subtotal", "total", "amount", "net", "صافيالمبيعات", "الإجمالي", "المجموع", "صافي"],
  gross: ["grosssales", "grossamount", "grosstotal", "gross", "إجماليالمبيعات", "الإجماليقبلالخصم"],
  discount: ["discountamount", "discounts", "discount", "الخصم", "الخصومات"],
  refund: ["refundamount", "refunds", "refunded", "returns", "returnamount", "المرتجعات", "المرتجع", "المردودات"],
  vat: ["taxamount", "vatamount", "tax", "vat", "الضريبة", "ضريبةالقيمةالمضافة"],
  isVoid: ["isvoid", "voided", "void", "cancelled", "canceled", "ملغاة", "ملغي", "ملغى"],
  isRefund: ["isrefund", "isreturn", "refundflag", "isrefunded", "مرتجع", "مرتجعة", "مردود"],
  isComplimentary: ["iscomplimentary", "complimentary", "comp", "isfree", "freeitem", "مجاني", "مجانية", "ضيافة"],
  modifiers: ["modifiers", "modifier", "options", "extras", "addons", "الإضافات", "الخيارات", "المعدلات"],
};

/** أشكالُ العرض العربيّة (ﻣﺆﺳﺴﺔ) إلى حروفها (مؤسسة) — وإلّا لم يلتقِ اسمٌ باسمه. */
function foldPresentationForms(text: string): string {
  return text.normalize("NFKC");
}

/**
 * تطبيعُ الترويسة.
 *
 * يُسقط الفراغات (ومنها الفراغ غير الفاصل الذي يضعه Excel) وعلامات
 * الترقيم والتشكيل، ويوحّد الهمزات والتاء المربوطة — وهي أكثرُ ما
 * يختلف في كتابة العربية.
 */
export function normaliseHeader(raw: string): string {
  return foldPresentationForms(raw)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s _\-./\\()[\]{}:؛,،'"#*]/g, "");
}

/**
 * ── المرادفاتُ تُطبَّع بما تُطبَّع به الترويسة ──
 *
 * كُتبت أوّلاً بحروفها كما تُكتب («الكمية»، «ملغاة»، «الإضافات»)، بينما
 * ‏`normaliseHeader` تحوّل التاء المربوطة هاءً والهمزةَ ألفاً. فكان
 * «الكمية» في الجدول لا يساوي «الكميه» الخارجَ من التطبيع، **فلا يُفهَم
 * عمودُ الكمّيّة في أيّ ملفٍّ عربيّ** — وذلك يُسقط تقريرَ مزيج الأصناف
 * كلَّه بحجّة «لم يُفهَم الملفّ».
 *
 * والعلاجُ أن يمرّ الطرفان بالدالّة نفسها، لا أن تُكتب الصيغةُ المطبَّعة
 * بالحدس: من يضيف مرادفاً جديداً يكتبه كما يُكتب، ويُطبَّع هنا.
 */
const SYNONYMS = Object.fromEntries(
  Object.entries(RAW_SYNONYMS).map(([field, list]) => [
    field,
    [...new Set(list.map(normaliseHeader))],
  ]),
) as unknown as Record<SalesColumn, readonly string[]>;

export interface ColumnMap {
  index: Partial<Record<SalesColumn, number>>;
  recognised: string[];
  unrecognised: string[];
}

/**
 * يربط الترويسات بالحقول.
 *
 * والمطابقةُ بالمساواة أوّلاً ثمّ بالاحتواء: «Net Sales (SAR)» يحتوي
 * «netsales». والأوّلُ يفوز — فلا يُسرَق عمودٌ فُهم بالضبط لصالح آخر
 * فُهم بالتقريب.
 */
export function mapColumns(header: readonly string[]): ColumnMap {
  const normalised = header.map((h) => normaliseHeader(h ?? ""));
  const index: Partial<Record<SalesColumn, number>> = {};
  const taken = new Set<number>();

  const claim = (field: SalesColumn, at: number) => {
    if (index[field] !== undefined || taken.has(at)) return false;
    index[field] = at;
    taken.add(at);
    return true;
  };

  for (const pass of ["exact", "contains"] as const) {
    for (const field of Object.keys(SYNONYMS) as SalesColumn[]) {
      if (index[field] !== undefined) continue;
      for (const syn of SYNONYMS[field]) {
        const at = normalised.findIndex((h, i) =>
          !taken.has(i) && h !== "" && (pass === "exact" ? h === syn : h.includes(syn)),
        );
        if (at >= 0 && claim(field, at)) break;
      }
    }
  }

  const recognised: string[] = [];
  for (const [field, at] of Object.entries(index)) {
    if (typeof at === "number") recognised.push(`${header[at]} ← ${FIELD_LABEL[field as SalesColumn]}`);
  }
  const unrecognised = header.filter((h, i) => (h ?? "").trim() !== "" && !taken.has(i));

  return { index, recognised, unrecognised };
}

export const FIELD_LABEL: Record<SalesColumn, string> = {
  orderId: "رقم الطلب",
  businessDate: "تاريخ العمل",
  soldAt: "وقت البيع",
  branch: "الفرع",
  productExternalId: "رمز الصنف",
  productName: "اسم الصنف",
  category: "التصنيف",
  quantity: "الكمّيّة",
  unitPrice: "سعر الوحدة",
  lineTotal: "إجمالي السطر",
  gross: "الإجمالي قبل الخصم",
  discount: "الخصم",
  refund: "المرتجَع",
  vat: "الضريبة",
  isVoid: "ملغاة",
  isRefund: "مرتجَعة",
  isComplimentary: "مجانيّة",
  modifiers: "الإضافات",
};
