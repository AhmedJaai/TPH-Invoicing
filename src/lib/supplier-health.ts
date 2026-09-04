import { MONTH, STATEMENT, countNoun } from "./arabic";

/**
 * صحّة العلاقة مع المورّد.
 *
 * ليست درجةً واحدة من مئة — رقمٌ كهذا يُخفي سببه، فلا يُفيد عند
 * التفاوض. بل أبعادٌ منفصلة، كلٌّ منها يقول ما فيه: الوثائق، والامتثال
 * الضريبي، وانضباط الكشوف، والسعر.
 *
 * والبُعد الذي لا تكفي بياناته يبقى **غير مقيَّم**، ولا يُعطى صفراً:
 * الصفر حكمٌ، وغياب البيانات ليس حكماً.
 */

export type Dimension = "DOCUMENTS" | "VAT" | "STATEMENTS" | "PRICING";

export const DIMENSION_LABEL: Record<Dimension, string> = {
  DOCUMENTS: "الوثائق",
  VAT: "الامتثال الضريبي",
  STATEMENTS: "الكشوف",
  PRICING: "استقرار السعر",
};

export type Grade = "GOOD" | "FAIR" | "POOR" | "UNRATED";

export interface DimensionScore {
  dimension: Dimension;
  grade: Grade;
  /** ما الذي بُني عليه الحكم — بلا سبب لا يُفاوَض به. */
  reason: string;
}

export interface SupplierFacts {
  invoiceCount: number;
  /** فواتير مستوفية الأركان الأربعة */
  taxValidCount: number;
  /** فواتير معلومٌ نقصها */
  taxInvalidCount: number;
  /** فواتير لم يُقرأ تفصيلها بعد */
  taxUnknownCount: number;

  issuesInvoices: boolean;
  contractOnFile: boolean;
  hasVatNumber: boolean;

  statementCount: number;
  /** أشهر فيها فواتير من هذا المورّد */
  activeMonths: number;

  /** نسبة تغيّر متوسّط السعر خلال المدّة، أو `null` إن تعذّر الحساب */
  priceChangePct: number | null;
}

export const GOOD_VAT_RATIO = 0.9;
export const FAIR_VAT_RATIO = 0.6;
export const PRICE_CALM_PCT = 5;
export const PRICE_HOT_PCT = 12;

export function scoreDocuments(f: SupplierFacts): DimensionScore {
  if (!f.issuesInvoices) {
    return f.contractOnFile
      ? { dimension: "DOCUMENTS", grade: "FAIR",
          reason: "لا يصدر فواتير ضريبية، لكن معه عقد توريد مكتوب." }
      : { dimension: "DOCUMENTS", grade: "POOR",
          reason: "لا يصدر فواتير ضريبية ولا عقد معه — لا إثبات مصروف ولا خصم ضريبة." };
  }
  if (f.invoiceCount === 0) {
    return { dimension: "DOCUMENTS", grade: "UNRATED", reason: "لا فواتير منه بعد." };
  }
  return { dimension: "DOCUMENTS", grade: "GOOD",
    reason: `${f.invoiceCount} فاتورة محفوظة منه.` };
}

export function scoreVat(f: SupplierFacts): DimensionScore {
  if (!f.issuesInvoices) {
    return { dimension: "VAT", grade: "POOR", reason: "لا يصدر فواتير ضريبية، فلا خصم مدخلات." };
  }
  const judged = f.taxValidCount + f.taxInvalidCount;
  if (judged === 0) {
    return { dimension: "VAT", grade: "UNRATED",
      reason: f.taxUnknownCount > 0
        ? `${f.taxUnknownCount} فاتورة لم يُقرأ تفصيلها الضريبي بعد.`
        : "لا فواتير مقروءة بعد." };
  }
  const ratio = f.taxValidCount / judged;
  const pct = Math.round(ratio * 100);
  if (ratio >= GOOD_VAT_RATIO) {
    return { dimension: "VAT", grade: "GOOD", reason: `${pct}٪ من فواتيره مستوفية الأركان.` };
  }
  if (ratio >= FAIR_VAT_RATIO) {
    return { dimension: "VAT", grade: "FAIR",
      reason: `${pct}٪ فقط مستوفية — ${f.taxInvalidCount} فاتورة ينقصها ركن.` };
  }
  return { dimension: "VAT", grade: "POOR",
    reason: `${pct}٪ مستوفية — ${f.taxInvalidCount} فاتورة ضريبتها معرَّضة للرفض.` };
}

export function scoreStatements(f: SupplierFacts): DimensionScore {
  if (f.activeMonths === 0) {
    return { dimension: "STATEMENTS", grade: "UNRATED", reason: "لا تعامل بعد." };
  }
  if (f.statementCount === 0) {
    return { dimension: "STATEMENTS", grade: "POOR",
      reason: `لا كشف حساب واحد خلال ${countNoun(f.activeMonths, MONTH)} من التعامل.` };
  }
  if (f.statementCount >= f.activeMonths) {
    return { dimension: "STATEMENTS", grade: "GOOD",
      reason: `${countNoun(f.statementCount, STATEMENT)} مقابل ${countNoun(f.activeMonths, MONTH)}.` };
  }
  return { dimension: "STATEMENTS", grade: "FAIR",
    reason: `${countNoun(f.statementCount, STATEMENT)} فقط خلال ${countNoun(f.activeMonths, MONTH)}.` };
}

export function scorePricing(f: SupplierFacts): DimensionScore {
  if (f.priceChangePct === null) {
    return { dimension: "PRICING", grade: "UNRATED",
      reason: "لا تكفي بنود فواتيره لقياس تغيّر السعر." };
  }
  const p = f.priceChangePct;
  const shown = `${p > 0 ? "+" : ""}${Math.round(p)}٪`;
  if (Math.abs(p) <= PRICE_CALM_PCT) {
    return { dimension: "PRICING", grade: "GOOD", reason: `متوسّط أسعاره تغيّر ${shown} — مستقرّ.` };
  }
  if (p < 0) {
    return { dimension: "PRICING", grade: "GOOD", reason: `متوسّط أسعاره انخفض ${shown}.` };
  }
  if (p <= PRICE_HOT_PCT) {
    return { dimension: "PRICING", grade: "FAIR", reason: `متوسّط أسعاره ارتفع ${shown}.` };
  }
  return { dimension: "PRICING", grade: "POOR",
    reason: `متوسّط أسعاره ارتفع ${shown} — يستحقّ تفاوضاً.` };
}

export function buildSupplierHealth(f: SupplierFacts): DimensionScore[] {
  return [scoreDocuments(f), scoreVat(f), scoreStatements(f), scorePricing(f)];
}

/**
 * حكمٌ عامّ من الأبعاد.
 *
 * لا يُجمَع كمعدّل: بُعدٌ واحد رديء في الامتثال الضريبي أخطر من ثلاثة
 * جيّدة. فالأسوأ هو الحاكم، وغير المقيَّم لا يُخفّف الحكم ولا يشدّده.
 */
export function overallGrade(scores: readonly DimensionScore[]): Grade {
  const rated = scores.filter((s) => s.grade !== "UNRATED");
  if (rated.length === 0) return "UNRATED";
  if (rated.some((s) => s.grade === "POOR")) return "POOR";
  if (rated.some((s) => s.grade === "FAIR")) return "FAIR";
  return "GOOD";
}

export const GRADE_LABEL: Record<Grade, string> = {
  GOOD: "سليم",
  FAIR: "يحتاج نظراً",
  POOR: "يحتاج معالجة",
  UNRATED: "غير مقيَّم",
};
