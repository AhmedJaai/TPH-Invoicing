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
  | { type: "APPLY_CREDIT" }
  /** دفعةٌ مكرّرة بلا أصل (لا حركة بنك ولا مستند) بجانب توأمٍ له أصل — تُلغى */
  | { type: "VOID_DUPLICATE"; paymentId: string };

export interface FindingRef {
  ref: string;
  type: "invoice" | "payment" | "statement" | "transfer";
  id: string;
  label: string;
}

/**
 * رموزُ المراجع في نصّ النموذج تصير أسماءً يقرؤها صاحبُ المقهى.
 *
 * النموذجُ يُعطى الفواتير والدفعات برموزٍ قصيرة (F1 · P2) كي يشير إليها
 * بلا أن ينسخ أرقاماً، ثمّ يكتبها في الشرح نفسه: «فواتير F10 وF11 وF12
 * مفتوحة… من دفعة P1». فيقرأ أحمد رموزاً لا يعرفها. والاسمُ من المرجع
 * المحسوب لا من النموذج: الفاتورةُ برقمها، والدفعةُ والحوالةُ بتاريخها،
 * والكشفُ بنهايته. وما لا مرجعَ له يبقى كما كُتب — إخفاؤه يغيّر المعنى.
 */
export function humanizeRefs(text: string, refs: readonly Pick<FindingRef, "ref" | "type" | "label">[]): string {
  if (!text || refs.length === 0) return text;
  const name = new Map(refs.map((r) => [r.ref, shortName(r)]));
  const keys = [...name.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (keys.length === 0) return text;
  const re = new RegExp(`(?<![A-Za-z0-9])(${keys.join("|")})(?![A-Za-z0-9])`, "g");
  return text.replace(re, (m) => name.get(m) ?? m);
}

function shortName(r: Pick<FindingRef, "type" | "label">): string {
  const stripped = r.label.replace(/^(فاتورة|دفعة|كشف|حوالة)\s+/, "");
  /* الفاتورةُ برقمها وحده — تاريخُها في قائمة المراجع تحت الشرح */
  return r.type === "invoice" ? stripped.split(" · ")[0] : stripped;
}
