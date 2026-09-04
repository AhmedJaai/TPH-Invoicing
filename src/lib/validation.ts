/**
 * فحص الصحة الضريبية والمحاسبية.
 *
 * الفاتورة الضريبية الصحيحة يجب أن تحمل الأربعة معاً:
 *   رقم فاتورة + الرقم الضريبي للبائع + الرقم الضريبي للمشتري مطابقاً + تفصيل الضريبة.
 * والفاتورة المبسطة بلا رقم ضريبي للمشتري لا تصلح لخصم ضريبة المدخلات.
 */
import { FIXED_ASSET_THRESHOLD_MINOR, VAT_RATE } from "@/config/drive";
import { isSupplierRounding } from "./money";
import { ISSUE, ISSUE_TEXT, type IssueCode, type Severity } from "./issue-codes";

export interface Finding {
  code: IssueCode;
  severity: Severity;
  message: string;
}

export interface InvoiceCandidate {
  kind: "TAX_INVOICE" | "SIMPLIFIED_INVOICE" | "QUOTATION" | "PROFORMA" | "STATEMENT" | "UNKNOWN";
  invoiceNumber?: string | null;
  sellerVat?: string | null;
  buyerVat?: string | null;
  subtotalMinor?: number | null;
  vatMinor?: number | null;
  totalMinor?: number | null;
  /** ثقة كل حقل بين ٠ و١، من مخرجات نموذج الاستخراج */
  fieldConfidence?: Record<string, number>;
}

export interface ValidationContext {
  companyVat: string;
  /** المورد لا يصدر فواتير ضريبية أصلاً (أوسكا · البراونيز · فلاتر المياه) */
  supplierIssuesInvoices?: boolean;
  supplierContractOnFile?: boolean;
  /** أدنى ثقة مقبولة قبل طلب المراجعة البشرية */
  confidenceThreshold?: number;
}

/**
 * حالة الفاتورة ضريبياً.
 *
 * الراية الثنائية كانت تكذب: `false` تعني «ليست ضريبية» و«لا نعرف» معاً.
 * والفرق ليس لفظياً — الأولى تُطالِب المورّد ببديل، والثانية تُطالِبنا نحن
 * بقراءة المستند. ولوحة القيادة كانت تعرض «ضريبة معرّضة: صفر» عن مئة فاتورة
 * لم يُقرأ تفصيلها، وذلك أسوأ من الفراغ لأنّه يُطمئن كذباً.
 */
export type TaxStatus = "VALID" | "INVALID" | "UNKNOWN" | "NOT_APPLICABLE";
export type InputVatStatus = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";

export const TAX_STATUS_LABEL: Record<TaxStatus, string> = {
  VALID: "ضريبية كاملة",
  INVALID: "لا تصلح للخصم",
  UNKNOWN: "لم تُقرأ بعد",
  NOT_APPLICABLE: "لا تُقيَّد",
};

export interface ValidationResult {
  taxStatus: TaxStatus;
  inputVatStatus: InputVatStatus;
  isFixedAsset: boolean;
  findings: Finding[];
  /** الحقول التي تحتاج مراجعة بشرية — تُلوَّن بالأصفر في الواجهة */
  lowConfidenceFields: string[];
}

/** الرقم الضريبي السعودي: ١٥ رقماً يبدأ بـ٣ وينتهي بـ٣. */
export function isValidSaudiVat(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length === 15 && digits.startsWith("3") && digits.endsWith("3");
}

function normalizeVat(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function finding(code: IssueCode, override?: Partial<Finding>): Finding {
  return { code, ...ISSUE_TEXT[code], ...override };
}

export function validateInvoice(
  candidate: InvoiceCandidate,
  context: ValidationContext,
): ValidationResult {
  const findings: Finding[] = [];
  const threshold = context.confidenceThreshold ?? 0.8;

  // عرض السعر والمبدئية ليسا فاتورة — يمنعان القيد تماماً.
  const isNotInvoice = candidate.kind === "QUOTATION" || candidate.kind === "PROFORMA";
  if (isNotInvoice) findings.push(finding(ISSUE.NOT_A_TAX_INVOICE));

  const hasNumber = Boolean(candidate.invoiceNumber?.trim());
  if (!hasNumber && !isNotInvoice) findings.push(finding(ISSUE.MISSING_INVOICE_NUMBER));

  const hasSellerVat = isValidSaudiVat(candidate.sellerVat);
  if (!hasSellerVat && !isNotInvoice) findings.push(finding(ISSUE.MISSING_SELLER_VAT));

  const buyerVat = normalizeVat(candidate.buyerVat);
  const companyVat = normalizeVat(context.companyVat);
  const hasBuyerVat = buyerVat.length > 0;
  const buyerVatMatches = hasBuyerVat && buyerVat === companyVat;

  if (!hasBuyerVat) {
    if (!isNotInvoice) findings.push(finding(ISSUE.MISSING_BUYER_VAT));
  } else if (!buyerVatMatches) {
    findings.push(finding(ISSUE.BUYER_VAT_MISMATCH));
  }

  /*
   * الفراغ ليس صفراً.
   * `null` تعني «لم يُقرأ»، و`0` تعني «قُرئ وكان صفراً». والخلط بينهما هو
   * ما جعل مئة فاتورة مجهولة تظهر «غير صالحة ضريبياً» وهي لم تُقرأ أصلاً.
   */
  const vatKnown = candidate.vatMinor !== null && candidate.vatMinor !== undefined;
  const subtotalKnown = candidate.subtotalMinor !== null && candidate.subtotalMinor !== undefined;
  const totalKnown = candidate.totalMinor !== null && candidate.totalMinor !== undefined;

  const vatMinor = candidate.vatMinor ?? 0;
  const subtotalMinor = candidate.subtotalMinor ?? 0;
  const totalMinor = candidate.totalMinor ?? 0;
  const hasVatBreakdown = vatKnown && vatMinor > 0;

  // فحص حسابي يكشف أخطاء الاستخراج قبل أن تصل إلى القيد — على المعلوم وحده.
  if (subtotalKnown && totalKnown && subtotalMinor > 0 && totalMinor > 0) {
    if (isSupplierRounding(subtotalMinor, vatMinor, totalMinor)) {
      /*
       * المورّد يُسقط كسور الريال من الإجمالي، والمطبوع هو الملزِم.
       * فلا يُعدّ خطأً، لكنّه يُذكَر كي لا يُظنّ أنّ النظام لم يره.
       */
      findings.push(finding(ISSUE.VAT_MATH_MISMATCH, {
        severity: "INFO",
        message: `المورّد قرّب الإجمالي: ${(subtotalMinor + vatMinor) / 100} صار ${totalMinor / 100}`,
      }));
    } else if (subtotalMinor + vatMinor !== totalMinor) {
      findings.push(finding(ISSUE.VAT_MATH_MISMATCH, {
        message: `المجموع ${totalMinor / 100} لا يساوي الصافي ${subtotalMinor / 100} زائد الضريبة ${vatMinor / 100}`,
      }));
    } else if (hasVatBreakdown) {
      const expected = Math.round(subtotalMinor * VAT_RATE);
      // نتسامح بهللة واحدة لاختلاف التقريب لدى المورد.
      if (Math.abs(expected - vatMinor) > 1) {
        findings.push(finding(ISSUE.VAT_MATH_MISMATCH, {
          severity: "INFO",
          message: `الضريبة ${vatMinor / 100} تخالف ١٥٪ من الصافي (${expected / 100}) — تحقّق من وجود بنود معفاة`,
        }));
      }
    }
  }

  /*
   * الحالة الضريبية على ثلاث درجات لا اثنتين:
   *   ركنٌ ناقص معلوم  ← INVALID، وعلاجها مطالبة المورّد.
   *   تفصيل لم يُقرأ    ← UNKNOWN، وعلاجها قراءة المستند.
   *   الأركان الأربعة  ← VALID.
   */
  const pillarsFailing = !hasNumber || !hasSellerVat || !buyerVatMatches;

  let taxStatus: TaxStatus;
  if (isNotInvoice) taxStatus = "NOT_APPLICABLE";
  else if (pillarsFailing) taxStatus = "INVALID";
  else if (!vatKnown) taxStatus = "UNKNOWN";
  else taxStatus = hasVatBreakdown ? "VALID" : "INVALID";

  const inputVatStatus: InputVatStatus =
    taxStatus === "VALID" ? "ELIGIBLE" : taxStatus === "UNKNOWN" ? "UNKNOWN" : "NOT_ELIGIBLE";

  if (taxStatus === "UNKNOWN") findings.push(finding(ISSUE.TAX_STATUS_UNKNOWN));

  /*
   * أساس الرسملة: الضريبة تدخل التكلفة فقط حين لا تكون قابلة للخصم.
   * ومع صافٍ مجهول وضريبة معلومة يُشتقّ الصافي من الفرق بدل أن يُفترض صفراً.
   */
  const assetBasis =
    inputVatStatus === "ELIGIBLE"
      ? (subtotalKnown ? subtotalMinor : totalMinor - vatMinor)
      : totalMinor;
  // بلا إجمالي معلوم لا يُحكم بالرسملة — الجهل لا يُترجم «لا»
  const isFixedAsset = totalKnown && assetBasis > FIXED_ASSET_THRESHOLD_MINOR;
  if (isFixedAsset) {
    findings.push(finding(ISSUE.POSSIBLE_FIXED_ASSET, {
      message: `مبلغ ${assetBasis / 100} ريال يتجاوز حد الرسملة ٣٬٠٠٠ — راجع إن كانت معدّة تُهلك`,
    }));
  }

  if (context.supplierIssuesInvoices === false && context.supplierContractOnFile !== true) {
    findings.push(finding(ISSUE.SUPPLIER_WITHOUT_CONTRACT));
  }

  const lowConfidenceFields = Object.entries(candidate.fieldConfidence ?? {})
    .filter(([, score]) => score < threshold)
    .map(([field]) => field);

  if (lowConfidenceFields.length > 0) {
    findings.push(finding(ISSUE.LOW_CONFIDENCE_FIELD, {
      message: `حقول تحتاج مراجعة: ${lowConfidenceFields.join("، ")}`,
    }));
  }

  return { taxStatus, inputVatStatus, isFixedAsset, findings, lowConfidenceFields };
}

/** هل يمنع أي تنبيه إدراج الفاتورة في دفعة السداد أو قيدها؟ */
export function hasBlocker(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "BLOCKER");
}
