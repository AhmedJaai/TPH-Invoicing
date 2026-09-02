/**
 * مخطط استخراج بيانات المستند.
 *
 * يُمرَّر إلى Claude كمخرجات منظّمة، فيلتزم النموذج بالبنية حرفياً
 * ولا نحتاج تحليل نصّ حرّ ولا تخمين شكل الإجابة.
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
const moneyString = z
  .string()
  .describe("المبلغ كنصّ بالأرقام اللاتينية ومنزلتين عشريتين، مثل 410.00. اتركه فارغاً إن لم يظهر.");

export const invoiceLineSchema = z.object({
  description: z.string().describe("وصف البند كما ورد في المستند"),
  quantity: z.string().describe("الكمية كنصّ، أو فارغ"),
  unitPrice: moneyString,
  lineTotal: moneyString,
});

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
    .describe("تاريخ المستند بصيغة YYYY-MM-DD ميلادية. حوّل التاريخ الهجري إن كان هو الوحيد. فارغ إن لم يظهر."),

  subtotalAmount: moneyString.describe("الإجمالي قبل الضريبة"),
  vatAmount: moneyString.describe("مبلغ ضريبة القيمة المضافة"),
  totalAmount: moneyString.describe("الإجمالي شامل الضريبة"),

  /** اسم المستفيد في إيصال التحويل — يخالف اسم المورد غالباً */
  beneficiaryName: z.string().describe("اسم المستفيد في إيصال التحويل البنكي، أو فارغ"),

  lines: z.array(invoiceLineSchema).describe("بنود الفاتورة. اتركها فارغة إن لم تكن مقروءة."),

  confidence: z
    .object({
      documentKind: z.number(),
      supplierName: z.number(),
      invoiceNumber: z.number(),
      invoiceDate: z.number(),
      amounts: z.number(),
      vatNumbers: z.number(),
    })
    .describe("ثقتك في كل مجموعة حقول بين 0 و 1. كن صادقاً: الحقل غير الواضح ثقته منخفضة."),

  notes: z
    .string()
    .describe("ملاحظة قصيرة بالعربية عن أي غموض أو تلف في المستند، أو فارغ"),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
