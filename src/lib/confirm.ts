/**
 * التحقّق من المستند وقت الأرشفة — على الخادم، لا في المتصفّح.
 *
 * كانت واجهة الأرشفة تأخذ «هل الفاتورة ضريبية صحيحة» وقائمة التنبيهات كما
 * يرسلها المتصفّح وتكتبها كما هي. ومعنى ذلك أنّ المتصفّح هو من يقرّر صحّة
 * الفاتورة ضريبياً، وأنّ من يرسل قائمة تنبيهات فارغة يتجاوز كل قاعدة مانعة.
 * فلا يبقى رقم ضريبي في النظام يمكن الدفاع عنه أمام مراجع.
 *
 * لذلك يُعاد الحساب هنا من القيم التي اعتمدها الإنسان، وتُهمَل رايات المتصفّح.
 * والمنطق مطابق لما في pipeline.ts عمداً، حتى لا تختلف شاشة المعاينة عن
 * القرار الفعلي فيرى المستخدم شيئاً ويحدث غيره.
 */
import { ISSUE, ISSUE_TEXT } from "./issue-codes";
import {
  validateInvoice,
  type Finding, type InputVatStatus, type TaxStatus,
} from "./validation";

/** أنواع تُقيَّد كفواتير — لها وحدها فحص ضريبي كامل. */
const INVOICE_KINDS = new Set(["TAX_INVOICE", "SIMPLIFIED_INVOICE"]);
const PAYMENT_KINDS = new Set(["RECEIPT", "CASH_RECEIPT"]);

export interface ConfirmedFields {
  documentKind: string;
  supplierId?: string | null;
  invoiceNumber?: string | null;
  /** YYYY-MM-DD */
  invoiceDate?: string | null;
  subtotalMinor?: number | null;
  vatMinor?: number | null;
  totalMinor?: number | null;
  sellerVat?: string | null;
  buyerVat?: string | null;
}

export interface ConfirmContext {
  companyVat: string;
  /** المورد لا يصدر فواتير ضريبية أصلاً */
  supplierIssuesInvoices?: boolean;
  supplierContractOnFile?: boolean;
  /** بصمة الملف موجودة مسبقاً */
  duplicateFile?: boolean;
  /** رقم الفاتورة مسجَّل مسبقاً لهذا المورد */
  duplicateInvoiceNumber?: boolean;
}

export interface ConfirmReview {
  findings: Finding[];
  blockers: Finding[];
  taxStatus: TaxStatus;
  inputVatStatus: InputVatStatus;
  isFixedAsset: boolean;
  /** هل تكتمل شروط إنشاء صفّ فاتورة؟ غيابها يجب أن يُعلَن لا أن يُبتلَع */
  canCreateInvoice: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function reviewConfirmed(
  fields: ConfirmedFields,
  context: ConfirmContext,
): ConfirmReview {
  const findings: Finding[] = [];

  const kind = fields.documentKind;
  const isPaymentDoc = PAYMENT_KINDS.has(kind);
  const isStatement = kind === "STATEMENT";
  const invoiceNumber = fields.invoiceNumber?.trim() || undefined;
  const invoiceDate = DATE_RE.test(fields.invoiceDate ?? "") ? fields.invoiceDate! : undefined;

  const validation = validateInvoice(
    {
      kind:
        kind === "TAX_INVOICE" || kind === "SIMPLIFIED_INVOICE" ||
        kind === "QUOTATION" || kind === "PROFORMA" || kind === "STATEMENT"
          ? kind
          : "UNKNOWN",
      invoiceNumber,
      sellerVat: fields.sellerVat ?? null,
      buyerVat: fields.buyerVat ?? null,
      subtotalMinor: fields.subtotalMinor ?? undefined,
      vatMinor: fields.vatMinor ?? undefined,
      totalMinor: fields.totalMinor ?? undefined,
    },
    {
      companyVat: context.companyVat,
      supplierIssuesInvoices: context.supplierIssuesInvoices,
      supplierContractOnFile: context.supplierContractOnFile,
    },
  );

  // الإيصال والكشف لهما منطق آخر، فلا يخضعان للفحص الضريبي — كما في pipeline
  if (!isPaymentDoc && !isStatement) findings.push(...validation.findings);

  if (context.duplicateFile) {
    findings.push({ code: ISSUE.DUPLICATE_FILE, ...ISSUE_TEXT.DUPLICATE_FILE });
  }

  if (invoiceNumber && context.duplicateInvoiceNumber) {
    findings.push({
      code: ISSUE.DUPLICATE_INVOICE,
      ...ISSUE_TEXT.DUPLICATE_INVOICE,
      message: `الفاتورة رقم ${invoiceNumber} مسجّلة مسبقاً لهذا المورد`,
    });
  }

  if (!fields.supplierId) {
    findings.push({
      code: ISSUE.LOW_CONFIDENCE_FIELD,
      severity: "BLOCKER",
      message: "لم يُحدَّد المورد — لا يمكن الأرشفة بلا مورد مسجّل",
    });
  }

  if (!invoiceDate) {
    findings.push({
      code: ISSUE.LOW_CONFIDENCE_FIELD,
      severity: "BLOCKER",
      message: "لم يُقرأ تاريخ المستند — لا يمكن تحديد الشهر بدونه",
    });
  }

  if (fields.totalMinor === null || fields.totalMinor === undefined) {
    findings.push({
      code: ISSUE.LOW_CONFIDENCE_FIELD,
      severity: "BLOCKER",
      message: "لم يُقرأ المبلغ الإجمالي — لا يمكن تسمية الملف بدونه",
    });
  }

  /*
   * الفاتورة بلا رقم كانت تُرفع إلى الدرايف وتُسجَّل كمستند بلا صفّ فاتورة،
   * والمستخدم يقرأ «تم الرفع بنجاح». فقدان صامت لفاتورة في نظام مالي أسوأ
   * من رفض صريح، فصار الرفض صريحاً.
   */
  if (INVOICE_KINDS.has(kind) && !invoiceNumber) {
    findings.push({
      code: ISSUE.MISSING_INVOICE_NUMBER,
      severity: "BLOCKER",
      message: "فاتورة بلا رقم — أدخل رقم الفاتورة قبل الأرشفة، وإلّا لن تُسجَّل كفاتورة",
    });
  }

  const canCreateInvoice =
    INVOICE_KINDS.has(kind) &&
    Boolean(fields.supplierId) &&
    Boolean(invoiceNumber) &&
    Boolean(invoiceDate) &&
    fields.totalMinor !== null &&
    fields.totalMinor !== undefined;

  return {
    findings,
    blockers: findings.filter((f) => f.severity === "BLOCKER"),
    taxStatus: validation.taxStatus,
    inputVatStatus: validation.inputVatStatus,
    isFixedAsset: validation.isFixedAsset,
    canCreateInvoice,
  };
}
