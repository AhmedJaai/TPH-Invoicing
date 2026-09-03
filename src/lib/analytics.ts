/**
 * حسابات التدقيق والتحليل.
 *
 * كلها دوال خالصة تأخذ صفوفاً وتُرجع نتائج — لا تلمس قاعدة البيانات،
 * فتُختبر كلها. الاستعلام مسؤولية الصفحة، والحساب مسؤولية هذا الملف.
 */
import { detectPriceChange, normalizeItem, type PriceChange } from "./items";

/* ───────────────────────── حالة السداد ───────────────────────── */

export type PaymentState = "PAID" | "PARTIAL" | "UNPAID" | "OVERPAID";

export interface InvoicePaymentRow {
  invoiceId: string;
  totalMinor: number;
  allocatedMinor: number;
}

export interface PaymentStatus {
  state: PaymentState;
  paidMinor: number;
  remainingMinor: number;
}

/**
 * حالة سداد فاتورة.
 * التسامح بهللة واحدة مقصود: فروق التقريب لدى المورّد لا يجوز أن تُظهر
 * فاتورة مسدَّدة كأنّها ناقصة هللة.
 */
export function paymentStatus(row: InvoicePaymentRow): PaymentStatus {
  const remaining = row.totalMinor - row.allocatedMinor;
  const state: PaymentState =
    row.allocatedMinor <= 0
      ? "UNPAID"
      : remaining > 1
        ? "PARTIAL"
        : remaining < -1
          ? "OVERPAID"
          : "PAID";
  return { state, paidMinor: row.allocatedMinor, remainingMinor: remaining };
}

/* ───────────────────────── أعمار الذمم ───────────────────────── */

export type AgeBucket = "current" | "d30" | "d60" | "d90" | "older";

export const AGE_LABEL: Record<AgeBucket, string> = {
  current: "أقل من ٣٠ يوماً",
  d30: "٣٠ إلى ٥٩ يوماً",
  d60: "٦٠ إلى ٨٩ يوماً",
  d90: "٩٠ إلى ١١٩ يوماً",
  older: "١٢٠ يوماً فأكثر",
};

export function ageBucket(invoiceDate: Date, asOf: Date): AgeBucket {
  const days = Math.floor((asOf.getTime() - invoiceDate.getTime()) / 86_400_000);
  if (days < 30) return "current";
  if (days < 60) return "d30";
  if (days < 90) return "d60";
  if (days < 120) return "d90";
  return "older";
}

export interface AgingRow {
  supplierId: string;
  supplierName: string;
  invoiceDate: Date;
  outstandingMinor: number;
}

export interface SupplierAging {
  supplierId: string;
  supplierName: string;
  buckets: Record<AgeBucket, number>;
  totalMinor: number;
  oldestDays: number;
}

export function buildAging(rows: readonly AgingRow[], asOf: Date): SupplierAging[] {
  const map = new Map<string, SupplierAging>();

  for (const row of rows) {
    if (row.outstandingMinor <= 0) continue;
    const entry =
      map.get(row.supplierId) ??
      {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        buckets: { current: 0, d30: 0, d60: 0, d90: 0, older: 0 },
        totalMinor: 0,
        oldestDays: 0,
      };

    entry.buckets[ageBucket(row.invoiceDate, asOf)] += row.outstandingMinor;
    entry.totalMinor += row.outstandingMinor;
    entry.oldestDays = Math.max(
      entry.oldestDays,
      Math.floor((asOf.getTime() - row.invoiceDate.getTime()) / 86_400_000),
    );
    map.set(row.supplierId, entry);
  }

  return [...map.values()].sort((a, b) => b.totalMinor - a.totalMinor);
}

/* ───────────────────────── تحليل الاستهلاك ───────────────────────── */

export interface LineRow {
  normalizedDescription: string;
  description: string;
  supplierId: string | null;
  supplierName?: string | null;
  invoiceDate: Date | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface ItemSummary {
  key: string;
  /** أوضح صيغة للاسم — الأطول عادةً أوفاها وصفاً */
  displayName: string;
  orderCount: number;
  totalQuantity: number;
  totalSpentMinor: number;
  averageUnitPriceMinor: number;
  lastOrderedAt: Date | null;
  firstOrderedAt: Date | null;
  /** متوسط الأيام بين طلبين — يكشف دورة إعادة الطلب */
  averageDaysBetweenOrders: number | null;
  suppliers: { supplierId: string; supplierName: string; lastUnitPriceMinor: number; orderCount: number }[];
  /**
   * تغيّر السعر عند المورّد الذي اشتريتَ منه آخر مرة.
   *
   * المقارنة داخل المورّد الواحد عمداً: لو قارنّا عبر المورّدين لظهر
   * الانتقال من مورّد غالٍ إلى رخيص كأنّه «انخفاض سعر»، وهو ليس كذلك.
   */
  priceChange: PriceChange | null;
  /** اسم المورّد الذي تخصّه المقارنة أعلاه */
  priceChangeSupplierName: string | null;
}

export function summarizeItems(rows: readonly LineRow[]): ItemSummary[] {
  const groups = new Map<string, LineRow[]>();
  for (const row of rows) {
    const key = row.normalizedDescription || normalizeItem(row.description);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const summaries: ItemSummary[] = [];

  for (const [key, list] of groups) {
    const dated = list.filter((r) => r.invoiceDate).sort(
      (a, b) => a.invoiceDate!.getTime() - b.invoiceDate!.getTime(),
    );

    const totalQuantity = list.reduce((s, r) => s + r.quantity, 0);
    const totalSpentMinor = list.reduce((s, r) => s + r.lineTotalMinor, 0);

    // الأطول اسماً أوفى وصفاً غالباً: «حليب طازج كامل الدسم ٢ لتر» خير من «حليب»
    const displayName = list.reduce((best, r) =>
      r.description.length > best.length ? r.description : best, list[0].description);

    // متوسط الفترة بين الطلبات — يُحسب من التواريخ الفريدة لا من كل سطر
    const uniqueDays = [...new Set(dated.map((r) => r.invoiceDate!.toISOString().slice(0, 10)))].sort();
    let averageDaysBetweenOrders: number | null = null;
    if (uniqueDays.length >= 2) {
      const first = new Date(`${uniqueDays[0]}T00:00:00Z`).getTime();
      const last = new Date(`${uniqueDays[uniqueDays.length - 1]}T00:00:00Z`).getTime();
      averageDaysBetweenOrders = Math.round((last - first) / 86_400_000 / (uniqueDays.length - 1));
    }

    // تجميع المورّدين لهذا الصنف — يكشف شراء الصنف نفسه بسعرين
    const bySupplier = new Map<string, { supplierId: string; supplierName: string; lastUnitPriceMinor: number; orderCount: number; lastDate: number }>();
    for (const r of list) {
      if (!r.supplierId) continue;
      const t = r.invoiceDate?.getTime() ?? 0;
      const prev = bySupplier.get(r.supplierId);
      if (!prev) {
        bySupplier.set(r.supplierId, {
          supplierId: r.supplierId,
          supplierName: r.supplierName ?? "—",
          lastUnitPriceMinor: r.unitPriceMinor,
          orderCount: 1,
          lastDate: t,
        });
      } else {
        prev.orderCount++;
        if (t >= prev.lastDate) {
          prev.lastUnitPriceMinor = r.unitPriceMinor;
          prev.lastDate = t;
        }
      }
    }

    summaries.push({
      key,
      displayName,
      orderCount: list.length,
      totalQuantity,
      totalSpentMinor,
      averageUnitPriceMinor: totalQuantity > 0 ? Math.round(totalSpentMinor / totalQuantity) : 0,
      lastOrderedAt: dated.length ? dated[dated.length - 1].invoiceDate : null,
      firstOrderedAt: dated.length ? dated[0].invoiceDate : null,
      averageDaysBetweenOrders,
      suppliers: [...bySupplier.values()]
        .map(({ supplierId, supplierName, lastUnitPriceMinor, orderCount }) => ({
          supplierId, supplierName, lastUnitPriceMinor, orderCount,
        }))
        .sort((a, b) => a.lastUnitPriceMinor - b.lastUnitPriceMinor),
      priceChange: null,
      priceChangeSupplierName: null,
    });

    // المقارنة تجري على تاريخ المورّد الأحدث شراءً وحده
    const latest = dated[dated.length - 1];
    const summary = summaries[summaries.length - 1];
    if (latest?.supplierId) {
      const sameSupplier = dated.filter((r) => r.supplierId === latest.supplierId);
      summary.priceChange = detectPriceChange(
        sameSupplier.map((r) => ({ date: r.invoiceDate!, unitPriceMinor: r.unitPriceMinor })),
      );
      summary.priceChangeSupplierName = latest.supplierName ?? null;
    }
  }

  return summaries.sort((a, b) => b.totalSpentMinor - a.totalSpentMinor);
}

/**
 * الأصناف التي تُشترى من أكثر من مورّد بأسعار مختلفة.
 * هذه أسرع طريقة لتوفير مال في مقهى: نفس الصنف، سعران.
 */
export interface PriceGap {
  item: ItemSummary;
  cheapest: ItemSummary["suppliers"][number];
  dearest: ItemSummary["suppliers"][number];
  gapMinor: number;
  gapRatio: number;
  /** التوفير المقدَّر لو اشتُري كله من الأرخص */
  potentialSavingMinor: number;
}

export function findPriceGaps(items: readonly ItemSummary[], minRatio = 0.05): PriceGap[] {
  const gaps: PriceGap[] = [];

  for (const item of items) {
    if (item.suppliers.length < 2) continue;
    const cheapest = item.suppliers[0];
    const dearest = item.suppliers[item.suppliers.length - 1];
    const gapMinor = dearest.lastUnitPriceMinor - cheapest.lastUnitPriceMinor;
    if (gapMinor <= 0 || cheapest.lastUnitPriceMinor === 0) continue;

    const gapRatio = gapMinor / cheapest.lastUnitPriceMinor;
    if (gapRatio < minRatio) continue;

    gaps.push({
      item,
      cheapest,
      dearest,
      gapMinor,
      gapRatio,
      potentialSavingMinor: Math.round(gapMinor * item.totalQuantity),
    });
  }

  return gaps.sort((a, b) => b.potentialSavingMinor - a.potentialSavingMinor);
}

/* ───────────────────────── ضريبة المدخلات المعرّضة ───────────────────────── */

export interface VatRiskRow {
  invoiceId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: Date;
  vatMinor: number;
  inputVatEligible: boolean;
}

export interface VatRisk {
  atRiskMinor: number;
  recoverableMinor: number;
  atRiskCount: number;
  rows: VatRiskRow[];
}

/** كم ضريبة مدخلات نخسرها لأنّ الفواتير ليست ضريبية كاملة. */
export function vatAtRisk(rows: readonly VatRiskRow[]): VatRisk {
  const atRisk = rows.filter((r) => !r.inputVatEligible && r.vatMinor > 0);
  return {
    atRiskMinor: atRisk.reduce((s, r) => s + r.vatMinor, 0),
    recoverableMinor: rows.filter((r) => r.inputVatEligible).reduce((s, r) => s + r.vatMinor, 0),
    atRiskCount: atRisk.length,
    rows: [...atRisk].sort((a, b) => b.vatMinor - a.vatMinor),
  };
}

/* ───────────────────────── المصروف حسب الشهر ───────────────────────── */

export interface MonthlySpend {
  month: string;
  totalMinor: number;
  invoiceCount: number;
}

export function spendByMonth(
  rows: readonly { periodMonth: string; totalMinor: number }[],
): MonthlySpend[] {
  const map = new Map<string, MonthlySpend>();
  for (const r of rows) {
    const entry = map.get(r.periodMonth) ?? { month: r.periodMonth, totalMinor: 0, invoiceCount: 0 };
    entry.totalMinor += r.totalMinor;
    entry.invoiceCount++;
    map.set(r.periodMonth, entry);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}
