/**
 * أقُرئت الورقة؟ — حكمٌ يُقال للباريستا قبل أن يُرسل.
 *
 * الصورةُ «واضحة» حين يُقرأ منها ما يلزم لتُقيَّد: من أصدرها (اسمُه أو رقمُه
 * الضريبيّ)، وأيّ فاتورةٍ هي (رقمُها أو تاريخُها)، وكم مبلغُها. وما نقص يُسمّى
 * باسمه — «لم يُقرأ الإجمالي» يقول ما يُعاد تصويرُه، و«غير واضحة» لا تقول شيئاً.
 *
 * والحكمُ عونٌ للمصوِّر لا قيد: لا يُنشئ شيئاً، والقيدُ بعد إقرار صاحب العمل.
 * المبالغُ تُعرض نصّاً كما قُرئت — الباريستا يقارنها بالورقة في يده.
 *
 * خالصة.
 */
import { formatRiyalsDisplay, parseRiyals } from "./money";
import type { ExtractionResult } from "./extraction/schema";

export type ClarityLevel = "CLEAR" | "PARTIAL" | "UNREADABLE";

export interface ClarityVerdict {
  level: ClarityLevel;
  /** ما قُرئ، ليُقارَن بالورقة. الفراغ: لم يُقرأ. */
  read: {
    supplier: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    total: string | null;
    lines: number;
  };
  /** ما لم يُقرأ، بأسمائه */
  missing: string[];
}

/** ثقةٌ دونها لا يُعدّ الحقلُ مقروءاً ولو كتب النموذج شيئاً */
const MIN_CONFIDENCE = 0.5;

const text = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

export function judgeClarity(x: ExtractionResult): ClarityVerdict {
  const c = x.confidence;
  const sure = (score: number | undefined) => score === undefined || score >= MIN_CONFIDENCE;

  const supplier = sure(c?.supplierName) ? text(x.supplierNameAr) ?? text(x.supplierNameEn) ?? text(x.sellerVatNumber) : null;
  const invoiceNumber = sure(c?.invoiceNumber) ? text(x.invoiceNumber) : null;
  const invoiceDate = sure(c?.invoiceDate) ? text(x.invoiceDate) : null;
  const totalMinor = sure(c?.amounts) ? parseRiyals(x.totalAmount ?? "") : null;
  const total = totalMinor !== null && totalMinor > 0 ? formatRiyalsDisplay(totalMinor) : null;
  const lines = x.lines?.length ?? 0;

  const missing: string[] = [];
  if (!supplier) missing.push("اسم المورّد");
  if (!invoiceNumber && !invoiceDate) missing.push("رقم الفاتورة وتاريخها");
  if (!total) missing.push("الإجمالي");

  const level: ClarityLevel = missing.length === 0 ? "CLEAR" : missing.length === 3 && lines === 0 ? "UNREADABLE" : "PARTIAL";
  return { level, read: { supplier, invoiceNumber, invoiceDate, total, lines }, missing };
}
