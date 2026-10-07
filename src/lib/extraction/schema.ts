/**
 * مخطط استخراج بيانات المستند.
 *
 * يُوصَف لـDeepSeek في الموجِّه — المزوّد لا يفرض مخطّطاً صارماً — ثمّ
 * يُتحقَّق من الجواب به بعد القراءة. فالبنية مفحوصةٌ لا مضمونة.
 */
import { z } from "zod";

export const DOCUMENT_KINDS = [
  "TAX_INVOICE",
  "SIMPLIFIED_INVOICE",
  "STATEMENT",
  "QUOTATION",
  "PROFORMA",
  "RECEIPT",
  "CASH_RECEIPT",
  "CONTRACT",
  "UTILITY",
  "UNKNOWN",
] as const;

/** المبالغ تُطلب كنصوص لا كأرقام، حتى لا تفقد الفاصلة العشرية دقّتها في JSON. */
export const moneyString = z
  .string()
  .describe("المبلغ كنصّ بالأرقام اللاتينية ومنزلتين عشريتين، مثل 410.00. اتركه فارغاً إن لم يظهر.");

export const invoiceLineSchema = z.object({
  /*
    حرفاً بحرف: كان النموذجُ يختصر ويصحّح، فصار «كولومبي عنب» عند المحمصة الغربية
    «عنب» مرّةً و«كولومي عنب» أخرى و«كولومبي بن» ثالثة — وكلٌّ صنفٌ عندنا.
  */
  description: z.string().describe(
    "وصف البند منسوخاً حرفاً بحرف كما طُبع في سطره، بكلّ كلماته وبترتيبها: لا تختصره، ولا تصحّح إملاءه، "
    + "ولا تُسقط منه كلمة (كالمنشأ أو النوع)، ولا تُضف إليه كلمةً ليست فيه (مثل «بن»)، ولا تترجمه. "
    + "وإن طُبع بلغتين فانسخ العربيّ كما هو",
  ),
  quantity: z.string().describe("الكمية كنصّ، أو فارغ"),
  unitPrice: moneyString,
  lineTotal: moneyString,
});

/** سطر في كشف حساب المورّد: ما حمّله علينا وما سدّدناه. */
export const statementLineSchema = z.object({
  date: z.string().describe("تاريخ الحركة بصيغة YYYY-MM-DD، أو فارغ"),
  ref: z.string().describe("المرجع أو رقم الفاتورة كما كتبه المورّد، أو فارغ"),
  description: z.string().describe("بيان الحركة كما ورد، أو فارغ"),
  debit: moneyString.describe("المبلغ المحمَّل علينا (مدين)، أو فارغ"),
  credit: moneyString.describe("المبلغ المسدَّد منّا (دائن)، أو فارغ"),
  /* كشفُ أفال قُرئ رصيدُه الجاري مديناً — فله حقلُه، ولا يُحمل على مدينٍ أو دائن */
  balance: moneyString.describe(
    "الرصيد الجاري بعد هذه الحركة إن طُبع عمودُه، أو فارغ. لا تضعه أبداً في مدين أو دائن: "
    + "الفاتورةُ مبلغُها في «مدين» والرصيدُ هنا",
  ).default(""),
});

/**
 * ثقةٌ بين صفرٍ وواحد.
 *
 * كانت `z.number()` بلا حدّ، فثقةُ «95» من نموذجٍ كتبها نسبةً مئويّة تمرّ
 * على أنّها أعلى من كلّ حدّ. فما بين ١ و١٠٠ يُقرأ نسبةً ويُقسَم، وما
 * خرج عن ذلك يُردّ.
 */
export const confidenceScore = z.preprocess(
  (v) => (typeof v === "number" && v > 1 && v <= 100 ? v / 100 : v),
  z.number().min(0).max(1),
);

export const extractionSchema = z.object({
  documentKind: z
    .enum(DOCUMENT_KINDS)
    .describe(
      "نوع المستند. TAX_INVOICE فاتورة ضريبية تحمل الرقم الضريبي للمشتري. " +
        "SIMPLIFIED_INVOICE فاتورة مبسطة بلا رقم ضريبي للمشتري. " +
        "STATEMENT كشف حساب يجمع عدة عمليات. " +
        "QUOTATION عرض سعر. PROFORMA فاتورة مبدئية. " +
        "RECEIPT إيصال تحويل بنكي. CASH_RECEIPT إيصال نقدي ورقي.",
    ),

  supplierNameAr: z.string().describe("اسم المورد بالعربية كما ورد، أو فارغ"),
  supplierNameEn: z.string().describe("اسم المورد بالإنجليزية كما ورد، أو فارغ"),
  sellerVatNumber: z.string().describe("الرقم الضريبي للبائع، ١٥ رقماً، أو فارغ"),
  sellerCrNumber: z.string().describe("السجل التجاري للبائع، أو فارغ"),

  buyerNameAr: z.string().describe("اسم المشتري كما ورد، أو فارغ"),
  buyerVatNumber: z.string().describe("الرقم الضريبي للمشتري، ١٥ رقماً، أو فارغ"),

  invoiceNumber: z.string().describe("رقم الفاتورة أو الإيصال، أو فارغ"),
  invoiceDate: z
    .string()
    .describe("تاريخ المستند الميلاديّ بصيغة YYYY-MM-DD. إن لم يظهر إلا الهجريّ فانسخه كما طُبع بسنته الهجرية ولا تحوّله. فارغ إن لم يظهر."),

  subtotalAmount: moneyString.describe("صافي المبلغ الخاضع للضريبة بعد الخصم الذي يخفض الوعاء، كما هو مطبوع"),
  vatAmount: moneyString.describe("مبلغ ضريبة القيمة المضافة كما هو مطبوع"),
  /* غائبُه فراغ: قراءاتٌ محفوظةٌ قبله ومزوّدٌ لا يُرجعه — لا تُردّ القراءةُ كلُّها لحقلٍ جديد */
  discountAmount: moneyString.describe("الخصم على مستوى الفاتورة كما هو مطبوع، أو فارغ إذا لا يوجد").default(""),
  chargesAmount: moneyString.describe("رسوم بعد الضريبة غير داخلة في الصافي (توصيل أو شحن أو خدمة) كما هي مطبوعة، أو فارغ إذا لا يوجد. ولا تُنقل إلى البنود").default(""),
  totalAmount: moneyString.describe("المبلغ النهائي المستحق أو المدفوع بعد الخصم، كما هو مطبوع"),

  /** اسم المستفيد في إيصال التحويل — يخالف اسم المورد غالباً */
  beneficiaryName: z.string().describe("اسم المستفيد في إيصال التحويل البنكي، أو فارغ"),

  lines: z.array(invoiceLineSchema).describe("بنود الفاتورة. اتركها فارغة إن لم تكن مقروءة."),

  /* ── كشوف الحساب وحدها ── */
  openingBalance: moneyString.describe("الرصيد الافتتاحي في كشف الحساب، أو فارغ"),
  closingBalance: moneyString.describe("الرصيد الختامي في كشف الحساب، أو فارغ"),
  statementLines: z
    .array(statementLineSchema)
    .describe(
      "سطور كشف الحساب. تُملأ في كشوف الحساب وحدها، وتُترك فارغة في الفواتير. " +
        "انسخ كل سطر كما هو ولا تحسب مجموعاً ولا رصيداً.",
    ),

  confidence: z
    .object({
      documentKind: confidenceScore,
      supplierName: confidenceScore,
      invoiceNumber: confidenceScore,
      invoiceDate: confidenceScore,
      amounts: confidenceScore,
      vatNumbers: confidenceScore,
    })
    .describe("ثقتك في كل مجموعة حقول بين 0 و 1. كن صادقاً: الحقل غير الواضح ثقته منخفضة."),

  notes: z
    .string()
    .describe("ملاحظة قصيرة بالعربية عن أي غموض أو تلف في المستند، أو فارغ"),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
