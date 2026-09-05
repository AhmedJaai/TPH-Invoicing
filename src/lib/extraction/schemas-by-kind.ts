/**
 * مخطّطٌ لكل نوع مستند.
 *
 * كان مخطّطٌ واحد ضخم يُطلَب لكلّ شيء: حقول الفاتورة، وأرصدة الكشف،
 * وسطوره، واسم المستفيد في الإيصال — ثلاثون حقلاً يُطلَب من النموذج أن
 * يفكّر فيها كلّها وهو يقرأ فاتورة فيها ستّة.
 *
 * وهذا يُضعف الدقّة من وجهين: يُشتّت انتباه النموذج، ويجعل الحقل
 * الفارغ غامضاً — أفارغٌ لأنّه غير موجود، أم لأنّه لم يُقرأ؟
 *
 * فصار المسار على مرحلتين: **يُصنَّف المستند أوّلاً**، ثمّ يُطلَب مخطّط
 * نوعه وحده. والتصنيف رخيص لأنّه سؤالٌ واحد.
 */
import { z } from "zod";
import { DOCUMENT_KINDS, invoiceLineSchema, statementLineSchema, moneyString } from "./schema";

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** المرحلة الأولى: ما هذا المستند؟ */
export const classifierSchema = z.object({
  documentKind: z.enum(DOCUMENT_KINDS).describe("نوع المستند"),
  confidence: z.number().describe("ثقتك في التصنيف بين 0 و 1"),
  reason: z.string().describe("لماذا صنّفته هكذا، بجملة قصيرة"),
});

const partiesShape = {
  supplierNameAr: z.string().describe("اسم المورد بالعربية كما ورد، أو فارغ"),
  supplierNameEn: z.string().describe("اسم المورد بالإنجليزية كما ورد، أو فارغ"),
  sellerVatNumber: z.string().describe("الرقم الضريبي للبائع، ١٥ رقماً، أو فارغ"),
  sellerCrNumber: z.string().describe("السجل التجاري للبائع، أو فارغ"),
};

const confidenceShape = {
  confidence: z
    .object({
      supplierName: z.number(),
      invoiceNumber: z.number(),
      invoiceDate: z.number(),
      amounts: z.number(),
      vatNumbers: z.number(),
    })
    .describe("ثقتك في كل مجموعة بين 0 و 1. كن صادقاً: الحقل غير الواضح ثقته منخفضة."),
  notes: z.string().describe("ملاحظة قصيرة عن أي غموض أو تلف، أو فارغ"),
};

/** الفاتورة الضريبية والمبسّطة — ولا يُسأل عن أرصدة كشفٍ ولا سطوره. */
export const invoiceExtractionSchema = z.object({
  ...partiesShape,
  buyerNameAr: z.string().describe("اسم المشتري كما ورد، أو فارغ"),
  buyerVatNumber: z.string().describe("الرقم الضريبي للمشتري، ١٥ رقماً، أو فارغ"),
  invoiceNumber: z.string().describe("رقم الفاتورة كما ورد، أو فارغ"),
  invoiceDate: z.string().describe("تاريخ الفاتورة YYYY-MM-DD ميلادية، أو فارغ"),
  subtotalAmount: moneyString.describe("الإجمالي قبل الضريبة"),
  vatAmount: moneyString.describe("مبلغ ضريبة القيمة المضافة"),
  totalAmount: moneyString.describe("الإجمالي شامل الضريبة"),
  lines: z.array(invoiceLineSchema).describe("بنود الفاتورة، أو فارغة إن لم تُقرأ"),
  ...confidenceShape,
});

/** كشف حساب المورّد — ولا يُسأل عن بنود فاتورة ولا مشترٍ. */
export const statementExtractionSchema = z.object({
  ...partiesShape,
  statementDate: z.string().describe("تاريخ الكشف YYYY-MM-DD، أو فارغ"),
  periodStart: z.string().describe("بداية الفترة YYYY-MM-DD، أو فارغ"),
  periodEnd: z.string().describe("نهاية الفترة YYYY-MM-DD، أو فارغ"),
  openingBalance: moneyString.describe("الرصيد الافتتاحي"),
  closingBalance: moneyString.describe("الرصيد الختامي"),
  statementLines: z
    .array(statementLineSchema)
    .describe("سطور الكشف كما وردت. انسخ ولا تحسب مجموعاً ولا رصيداً."),
  ...confidenceShape,
});

/** إيصال التحويل — المستفيد فيه يخالف اسم المورّد غالباً. */
export const receiptExtractionSchema = z.object({
  beneficiaryName: z.string().describe("اسم المستفيد كما ورد في الإيصال"),
  beneficiaryAccount: z.string().describe("حساب المستفيد أو آيبانه، أو فارغ"),
  senderName: z.string().describe("اسم المحوِّل، أو فارغ"),
  referenceNumber: z.string().describe("رقم العملية أو المرجع، أو فارغ"),
  transferDate: z.string().describe("تاريخ التحويل YYYY-MM-DD، أو فارغ"),
  totalAmount: moneyString.describe("المبلغ المحوَّل"),
  ...confidenceShape,
});

/** فاتورة مرافق — عدّاد وفترة، لا بنود ولا مورّد بالمعنى المعتاد. */
export const utilityExtractionSchema = z.object({
  ...partiesShape,
  accountNumber: z.string().describe("رقم الحساب أو العدّاد، أو فارغ"),
  invoiceNumber: z.string().describe("رقم الفاتورة، أو فارغ"),
  invoiceDate: z.string().describe("تاريخ الفاتورة YYYY-MM-DD، أو فارغ"),
  periodStart: z.string().describe("بداية فترة الاستهلاك، أو فارغ"),
  periodEnd: z.string().describe("نهايتها، أو فارغ"),
  subtotalAmount: moneyString.describe("قبل الضريبة"),
  vatAmount: moneyString.describe("الضريبة"),
  totalAmount: moneyString.describe("الإجمالي"),
  ...confidenceShape,
});

/**
 * أيّ مخطّط لأيّ نوع.
 *
 * وعرض السعر والمبدئية تُقرآن بمخطّط الفاتورة: شكلهما شكلها، والفرق
 * أنّهما لا تُقيَّدان — وذلك حكمٌ يُتَّخذ بعد القراءة لا قبلها.
 */
export function schemaFor(kind: DocumentKind) {
  switch (kind) {
    case "STATEMENT":
      return statementExtractionSchema;
    case "RECEIPT":
    case "CASH_RECEIPT":
      return receiptExtractionSchema;
    default:
      return invoiceExtractionSchema;
  }
}

/** عدد الحقول المطلوبة لكل نوع — يُبيّن كم اختصر التخصيص. */
export function fieldCount(kind: DocumentKind): number {
  return Object.keys(schemaFor(kind).shape).length;
}

/* ─────────────── من المخطّط الضيّق إلى النتيجة الكاملة ─────────────── */

/**
 * حقولٌ **لا وجود لها في هذا النوع** — لا حقولٌ لم تُقرأ.
 *
 * وهذا هو الفرق الذي بُني عليه التخصيص كلّه: الحقل الفارغ في المخطّط
 * الواحد الضخم غامض — أفارغٌ لأنّ المستند لا يحمله، أم لأنّ النموذج لم
 * يقرأه؟ وبعد التخصيص صار الجواب معلوماً بالبناء: ما لم يُسأل عنه
 * أصلاً غيرُ موجود في هذا النوع، وما سُئل عنه وعاد فارغاً لم يُقرأ.
 *
 * ويُحفَظ هذا في `notes` كي لا يضيع بعد التوسيع.
 */
export function absentFieldsFor(kind: DocumentKind): string[] {
  const asked = new Set(Object.keys(schemaFor(kind).shape));
  const all = [
    "supplierNameAr", "supplierNameEn", "sellerVatNumber", "sellerCrNumber",
    "buyerNameAr", "buyerVatNumber", "invoiceNumber", "invoiceDate",
    "subtotalAmount", "vatAmount", "totalAmount", "beneficiaryName",
    "lines", "openingBalance", "closingBalance", "statementLines",
  ];
  return all.filter((f) => !asked.has(f));
}

/**
 * يوسّع النتيجة الضيّقة إلى شكل `ExtractionResult` الكامل.
 *
 * والغرض أن يبقى ما بعده — `pipeline.ts` وما يليه — بلا تغيير: هو
 * يقرأ شكلاً واحداً، والتخصيص شأنُ الاستخراج وحده.
 *
 * ولا يخترع شيئاً: ما لم يُسأل عنه يبقى فارغاً، ويُذكَر أنّه لم يُسأل.
 */
export function widen(
  kind: DocumentKind,
  narrow: Record<string, unknown>,
  classifierConfidence: number,
): Record<string, unknown> {
  const str = (k: string): string => {
    const v = narrow[k];
    return typeof v === "string" ? v : "";
  };
  const arr = (k: string): unknown[] => (Array.isArray(narrow[k]) ? (narrow[k] as unknown[]) : []);
  const conf = (narrow.confidence ?? {}) as Record<string, number>;

  const absent = absentFieldsFor(kind);
  const note = str("notes");

  return {
    documentKind: kind,
    supplierNameAr: str("supplierNameAr"),
    supplierNameEn: str("supplierNameEn"),
    sellerVatNumber: str("sellerVatNumber"),
    sellerCrNumber: str("sellerCrNumber"),
    buyerNameAr: str("buyerNameAr"),
    buyerVatNumber: str("buyerVatNumber"),
    invoiceNumber: str("invoiceNumber") || str("referenceNumber"),
    /* الإيصال يسمّي تاريخه `transferDate`، والكشف `statementDate` */
    invoiceDate: str("invoiceDate") || str("transferDate") || str("statementDate"),
    subtotalAmount: str("subtotalAmount"),
    vatAmount: str("vatAmount"),
    totalAmount: str("totalAmount"),
    beneficiaryName: str("beneficiaryName"),
    lines: arr("lines"),
    openingBalance: str("openingBalance"),
    closingBalance: str("closingBalance"),
    statementLines: arr("statementLines"),
    confidence: {
      /* ثقة التصنيف من المرحلة الأولى — لا يخمّنها مخطّطُ النوع */
      documentKind: classifierConfidence,
      supplierName: conf.supplierName ?? 0,
      invoiceNumber: conf.invoiceNumber ?? 0,
      invoiceDate: conf.invoiceDate ?? 0,
      amounts: conf.amounts ?? 0,
      vatNumbers: conf.vatNumbers ?? 0,
    },
    notes:
      absent.length === 0
        ? note
        : [note, `حقولٌ لا يحملها هذا النوع فلم تُطلَب: ${absent.join("، ")}`]
            .filter(Boolean)
            .join(" · "),
  };
}
