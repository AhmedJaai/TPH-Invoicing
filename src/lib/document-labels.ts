/**
 * أسماءُ أنواع المستند وأحوالِه — اسمٌ واحد في كلّ شاشة (قائمةُ المستندات
 * وملفُّ المستند). كانت «قيد القراءة» في الترشيح «مقروءاً» في الصفّ.
 */
export type LabelTone = "ok" | "warn" | "danger" | "muted" | "info";

export const DOCUMENT_KIND_LABEL: Record<string, string> = {
  TAX_INVOICE: "فاتورة ضريبية",
  SIMPLIFIED_INVOICE: "فاتورة مبسطة",
  STATEMENT: "كشف حساب",
  QUOTATION: "عرض سعر",
  PROFORMA: "فاتورة مبدئية",
  RECEIPT: "إيصال سداد",
  CASH_RECEIPT: "إيصال نقدي",
  CONTRACT: "عقد",
  UTILITY: "مرافق وحكومي",
  UNKNOWN: "غير محدَّد",
};

export const DOCUMENT_STATUS_BADGE: Record<string, { text: string; tone: LabelTone }> = {
  ARCHIVED: { text: "أُرشف", tone: "ok" },
  PENDING: { text: "ينتظر المراجعة", tone: "warn" },
  EXTRACTED: { text: "ينتظر المراجعة", tone: "warn" },
  NEEDS_REVIEW: { text: "ينتظر المراجعة", tone: "warn" },
  REJECTED: { text: "رُفض", tone: "danger" },
};

/** رابطُ ملفّ المستند — لوحاً فوق ما أنت فيه، أو صفحةً إن فُتح مباشرة. */
export function documentHref(id: string, anchor?: "fix" | "why"): string {
  return `/documents/file/${encodeURIComponent(id)}${anchor ? `#${anchor}` : ""}`;
}
