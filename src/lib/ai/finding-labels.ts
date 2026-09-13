/**
 * أسماءُ اقتراحات التحليل — بلا تبعيّة، كي تُستورَد في المتصفّح.
 *
 * النواة (`supplier-analysis.ts`) تستعمل zod؛ واستيرادها في مكوّن عميل
 * يُدخل zod إلى حزمة المتصفّح لأجل جدول أسماء.
 */

export const FINDING_KINDS = [
  "PAID_OUTSIDE_BANK",
  "APPLY_CREDIT",
  "MISSING_INVOICES",
  "DUPLICATE_PAYMENT",
  "STATEMENT_GAP",
  "UNLINKED_TRANSFER",
  "NOTE",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export const FINDING_LABEL: Record<FindingKind, string> = {
  PAID_OUTSIDE_BANK: "سُدّدت خارج حساب المقهى",
  APPLY_CREDIT: "رصيدٌ لك عنده لم يُخصم",
  MISSING_INVOICES: "دفعتَ أكثر من فواتيره",
  DUPLICATE_PAYMENT: "دفعةٌ مسجَّلة مرّتين",
  STATEMENT_GAP: "كشفُه يخالف دفاترنا",
  UNLINKED_TRANSFER: "حوالةٌ له لم تُربط",
  NOTE: "ملاحظة",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  HIGH: "مهمّ",
  MEDIUM: "يستحقّ النظر",
  LOW: "للعلم",
};

export type FindingAction =
  | { type: "OWNER_PAID"; invoiceId: string }
  | { type: "APPLY_CREDIT" };

export interface FindingRef {
  ref: string;
  type: "invoice" | "payment" | "statement" | "transfer";
  id: string;
  label: string;
}
