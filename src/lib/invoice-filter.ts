/**
 * مُرشِّحات قائمة الفواتير.
 *
 * كان التنبيه يقول «٦٥ فاتورة ينقصها ركن» ثمّ يرسل إلى صفحة عامّة يبحث
 * فيها المستخدم من جديد — وهذا نقضٌ لمعنى التنبيه. فصار لكل حالة رابطٌ
 * يفتح **تلك الفواتير بعينها**.
 *
 * والمُرشِّحات هنا دوالّ خالصة تُبنى منها الروابط وتُقرأ منها، فلا
 * يُكتب اسم مُرشِّح في مكانين ويُنسى أحدهما.
 */

export type TaxFilter = "VALID" | "INVALID" | "UNKNOWN" | "NOT_APPLICABLE";
export type PaidFilter = "UNPAID" | "PARTIAL" | "PAID";

export interface InvoiceFilters {
  month?: string;
  supplier?: string;
  tax?: TaxFilter;
  paid?: PaidFilter;
  /** فواتير بلا بنود مقروءة */
  noLines?: boolean;
  /** مضى على استحقاقها أكثر من الحدّ */
  overdue?: boolean;
  page: number;
}

export const OVERDUE_DAYS = 60;
export const PAGE_SIZE = 40;

const TAX_VALUES: readonly string[] = ["VALID", "INVALID", "UNKNOWN", "NOT_APPLICABLE"];
const PAID_VALUES: readonly string[] = ["UNPAID", "PARTIAL", "PAID"];
const MONTH_RE = /^\d{4}-\d{2}$/;

export function parseFilters(raw: Record<string, string | undefined>): InvoiceFilters {
  const page = Number(raw.page);
  return {
    month: raw.month && MONTH_RE.test(raw.month) ? raw.month : undefined,
    supplier: raw.supplier?.trim() || undefined,
    tax: TAX_VALUES.includes(raw.tax ?? "") ? (raw.tax as TaxFilter) : undefined,
    paid: PAID_VALUES.includes(raw.paid ?? "") ? (raw.paid as PaidFilter) : undefined,
    noLines: raw.noLines === "1",
    overdue: raw.overdue === "1",
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

/** يبني رابطاً بتعديلٍ على المُرشِّحات القائمة. الصفحة تعود إلى الأولى. */
export function linkTo(
  current: InvoiceFilters,
  patch: Partial<InvoiceFilters>,
  base = "/purchases/invoices",
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();

  if (next.month) params.set("month", next.month);
  if (next.supplier) params.set("supplier", next.supplier);
  if (next.tax) params.set("tax", next.tax);
  if (next.paid) params.set("paid", next.paid);
  if (next.noLines) params.set("noLines", "1");
  if (next.overdue) params.set("overdue", "1");

  const page = patch.page ?? 1;
  if (page > 1) params.set("page", String(page));

  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

/** هل من مُرشِّح فعّال؟ يُستعمل لعرض زرّ «امسح الترشيح». */
export function hasFilters(f: InvoiceFilters): boolean {
  return Boolean(f.month || f.supplier || f.tax || f.paid || f.noLines || f.overdue);
}

export const TAX_LABEL: Record<TaxFilter, string> = {
  VALID: "مستوفية الأركان",
  INVALID: "ينقصها ركن",
  UNKNOWN: "لم تُقرأ ضريبتها",
  NOT_APPLICABLE: "لا تُقيَّد",
};

export const PAID_LABEL: Record<PaidFilter, string> = {
  UNPAID: "لم تُسدَّد",
  PARTIAL: "سُدّدت جزئياً",
  PAID: "مسدَّدة",
};

/**
 * وصف ما يُعرَض الآن، بجملةٍ تُقرأ.
 *
 * العنوان «الفواتير» فوق قائمةٍ مُرشَّحة يخدع — فيقال ما الذي يُعرض.
 */
export function describe(f: InvoiceFilters): string {
  const parts: string[] = [];
  if (f.tax) parts.push(TAX_LABEL[f.tax]);
  if (f.paid) parts.push(PAID_LABEL[f.paid]);
  if (f.overdue) parts.push(`مضى على استحقاقها ${OVERDUE_DAYS} يوماً`);
  if (f.noLines) parts.push("بلا بنود مقروءة");
  if (f.month) parts.push(`في ${f.month}`);
  return parts.length === 0 ? "كل الفواتير" : parts.join(" · ");
}
