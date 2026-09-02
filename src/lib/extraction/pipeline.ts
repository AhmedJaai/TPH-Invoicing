/**
 * من المستند الخام إلى قرار كامل: أي مورد، وأي نوع، وأي اسم، وأي مجلد،
 * وما التنبيهات التي يجب أن يراها المستخدم قبل أن يعتمد.
 *
 * دالة خالصة عمداً — لا تلمس الشبكة ولا قاعدة البيانات، فتُختبر كلها.
 */
import { parseRiyals } from "@/lib/money";
import { drivePathFor, monthOf, resolveReceiptFiling } from "@/lib/filing";
import {
  buildCashFileName,
  buildInvoiceFileName,
  buildReceiptFileName,
  buildStatementFileName,
} from "@/lib/naming";
import { validateInvoice, type Finding } from "@/lib/validation";
import { ISSUE, ISSUE_TEXT } from "@/lib/issue-codes";
import { SERVICE_FOLDERS } from "@/config/drive";
import type { ExtractionResult } from "./schema";
import type { SupplierMatch, SupplierRecord } from "@/lib/supplier-match";

export interface PipelineInput {
  extraction: ExtractionResult;
  match: SupplierMatch;
  companyVat: string;
  originalFileName: string;
  /** أرقام فواتير هذا المورد الموجودة مسبقاً، لكشف التكرار */
  existingInvoiceNumbers?: string[];
  /** بصمات الملفات المرفوعة سابقاً */
  fileAlreadyUploaded?: boolean;
  confidenceThreshold?: number;
}

export interface PipelineResult {
  documentKind: ExtractionResult["documentKind"];
  supplier?: SupplierRecord;
  supplierCandidates: SupplierRecord[];
  invoiceNumber?: string;
  invoiceDate?: string;
  periodMonth?: string;
  subtotalMinor?: number;
  vatMinor?: number;
  totalMinor?: number;
  sellerVat?: string;
  buyerVat?: string;
  beneficiary?: string;
  /** الاسم الجديد المقترح للملف */
  proposedFileName?: string;
  /** مسار المجلد في الدرايف */
  proposedFolderPath?: string;
  proposedFolderName?: string;
  isTaxValid: boolean;
  inputVatEligible: boolean;
  isFixedAsset: boolean;
  findings: Finding[];
  lowConfidenceFields: string[];
  /** هل يمكن الرفع؟ يمنعه أي تنبيه من درجة BLOCKER */
  canArchive: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "pdf";
}

/**
 * رمز آمن لاسم الملف.
 *
 * الأسماء اللاتينية تُدمج بحروف كبيرة في أوائل الكلمات (MaqamAlThiqa)،
 * والعربية تبقى عربية بمسافاتها. حذف الحروف العربية هنا كان يُفقد اسم
 * المستفيد بصمت، وهو أسوأ من اسم ملف فيه عربية — والمستخدم يعدّله في المعاينة.
 */
function toSlugToken(value: string): string {
  const words = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "";

  const isLatin = /^[A-Za-z0-9\s]+$/.test(words.join(" "));
  const token = isLatin
    ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("")
    : words.join(" ");

  return token.slice(0, 40);
}

export function runPipeline(input: PipelineInput): PipelineResult {
  const { extraction: x, match } = input;
  const findings: Finding[] = [];

  const subtotalMinor = parseRiyals(x.subtotalAmount) ?? undefined;
  const vatMinor = parseRiyals(x.vatAmount) ?? undefined;
  const totalMinor = parseRiyals(x.totalAmount) ?? undefined;
  const invoiceDate = DATE_RE.test(x.invoiceDate) ? x.invoiceDate : undefined;
  const invoiceNumber = x.invoiceNumber.trim() || undefined;

  const isPaymentDoc = x.documentKind === "RECEIPT" || x.documentKind === "CASH_RECEIPT";

  // ── الفحص الضريبي والمحاسبي ──
  const validation = validateInvoice(
    {
      kind:
        x.documentKind === "TAX_INVOICE" ||
        x.documentKind === "SIMPLIFIED_INVOICE" ||
        x.documentKind === "QUOTATION" ||
        x.documentKind === "PROFORMA" ||
        x.documentKind === "STATEMENT"
          ? x.documentKind
          : "UNKNOWN",
      invoiceNumber,
      sellerVat: x.sellerVatNumber || null,
      buyerVat: x.buyerVatNumber || null,
      subtotalMinor,
      vatMinor,
      totalMinor,
      fieldConfidence: {
        النوع: x.confidence.documentKind,
        المورد: x.confidence.supplierName,
        "رقم الفاتورة": x.confidence.invoiceNumber,
        التاريخ: x.confidence.invoiceDate,
        المبالغ: x.confidence.amounts,
        "الأرقام الضريبية": x.confidence.vatNumbers,
      },
    },
    {
      companyVat: input.companyVat,
      supplierIssuesInvoices: match.supplier?.issuesInvoices,
      supplierContractOnFile: match.supplier?.contractOnFile,
      confidenceThreshold: input.confidenceThreshold,
    },
  );

  // الفواتير وحدها تخضع للفحص الضريبي؛ الإيصال والكشف لهما منطق آخر.
  if (!isPaymentDoc && x.documentKind !== "STATEMENT") {
    findings.push(...validation.findings);
  } else {
    findings.push(...validation.findings.filter((f) => f.code === ISSUE.LOW_CONFIDENCE_FIELD));
  }

  if (input.fileAlreadyUploaded) {
    findings.push({ code: ISSUE.DUPLICATE_FILE, ...ISSUE_TEXT.DUPLICATE_FILE });
  }

  if (invoiceNumber && input.existingInvoiceNumbers?.includes(invoiceNumber)) {
    findings.push({
      code: ISSUE.DUPLICATE_INVOICE,
      ...ISSUE_TEXT.DUPLICATE_INVOICE,
      message: `الفاتورة رقم ${invoiceNumber} مسجّلة مسبقاً لهذا المورد`,
    });
  }

  if (!match.supplier) {
    findings.push({
      code: ISSUE.LOW_CONFIDENCE_FIELD,
      severity: "BLOCKER",
      message:
        match.candidates.length > 0
          ? "لم نتعرّف على المورد بثقة كافية — اختره من المرشّحين"
          : "مورد غير مسجّل — أنشئه أولاً مع سجله التجاري وشهادته الضريبية",
    });
  }

  // ── الاسم والمجلد ──
  const amountForName = totalMinor;
  const ext = extensionOf(input.originalFileName);
  let proposedFileName: string | undefined;
  let proposedFolderName: string | undefined;
  let periodMonth: string | undefined;

  if (invoiceDate && amountForName !== undefined) {
    const date = new Date(`${invoiceDate}T00:00:00Z`);

    if (isPaymentDoc) {
      periodMonth = resolveReceiptFiling({ paidAt: date });
      if (x.documentKind === "CASH_RECEIPT") {
        proposedFolderName = SERVICE_FOLDERS.CASH;
        proposedFileName = buildCashFileName({
          date: invoiceDate,
          description: toSlugToken(x.supplierNameEn || x.supplierNameAr || "Cash") || "Cash",
          amountMinor: amountForName,
          extension: ext === "pdf" ? "jpg" : ext,
        });
      } else {
        proposedFolderName = SERVICE_FOLDERS.RECEIPTS;
        const slug = match.supplier?.slug ?? toSlugToken(x.supplierNameEn || x.supplierNameAr);
        if (slug) {
          proposedFileName = buildReceiptFileName({
            date: invoiceDate,
            slug,
            beneficiary: x.beneficiaryName ? toSlugToken(x.beneficiaryName) : undefined,
            amountMinor: amountForName,
            extension: ext,
          });
        }
      }
    } else {
      periodMonth = monthOf(date);
      proposedFolderName = match.supplier?.driveFolderName ?? SERVICE_FOLDERS.OTHER;
      const slug = match.supplier?.slug ?? toSlugToken(x.supplierNameEn || x.supplierNameAr);

      if (x.documentKind === "STATEMENT" && slug) {
        proposedFileName = buildStatementFileName({
          date: invoiceDate,
          slug,
          amountMinor: amountForName,
          extension: ext,
        });
      } else if (slug && invoiceNumber) {
        proposedFileName = buildInvoiceFileName({
          date: invoiceDate,
          slug,
          invoiceNumber,
          amountMinor: amountForName,
          extension: ext,
        });
      }
    }
  }

  if (!invoiceDate) {
    findings.push({
      code: ISSUE.LOW_CONFIDENCE_FIELD,
      severity: "BLOCKER",
      message: "لم يُقرأ تاريخ المستند — لا يمكن تحديد الشهر بدونه",
    });
  }
  if (amountForName === undefined) {
    findings.push({
      code: ISSUE.LOW_CONFIDENCE_FIELD,
      severity: "BLOCKER",
      message: "لم يُقرأ المبلغ الإجمالي — لا يمكن تسمية الملف بدونه",
    });
  }

  const proposedFolderPath =
    periodMonth && proposedFolderName ? drivePathFor(periodMonth, proposedFolderName) : undefined;

  return {
    documentKind: x.documentKind,
    supplier: match.supplier,
    supplierCandidates: match.candidates,
    invoiceNumber,
    invoiceDate,
    periodMonth,
    subtotalMinor,
    vatMinor,
    totalMinor,
    sellerVat: x.sellerVatNumber || undefined,
    buyerVat: x.buyerVatNumber || undefined,
    beneficiary: x.beneficiaryName || undefined,
    proposedFileName,
    proposedFolderPath,
    proposedFolderName,
    isTaxValid: validation.isTaxValid,
    inputVatEligible: validation.inputVatEligible,
    isFixedAsset: validation.isFixedAsset,
    findings,
    lowConfidenceFields: validation.lowConfidenceFields,
    canArchive:
      Boolean(proposedFileName) &&
      Boolean(proposedFolderPath) &&
      !findings.some((f) => f.severity === "BLOCKER"),
  };
}
