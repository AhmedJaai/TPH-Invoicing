/**
 * حسابات التدقيق والتحليل.
 *
 * كلها دوال خالصة تأخذ صفوفاً وتُرجع نتائج — لا تلمس قاعدة البيانات،
 * فتُختبر كلها. الاستعلام مسؤولية الصفحة، والحساب مسؤولية هذا الملف.
 */
import { detectPriceChange, normalizeItem, type PriceChange } from "./items";
import type { InputVatStatus } from "./validation";

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
  /** المفتاح: المورّد ثمّ الصنف — الاسم وحده لا يعرّف صنفاً */
  key: string;
  supplierId: string | null;
  supplierName: string;
  normalized: string;
  /** أوضح صيغة للاسم — الأطول عادةً أوفاها وصفاً */
  displayName: string;
  orderCount: number;
  totalQuantity: number;
  totalSpentMinor: number;
  averageUnitPriceMinor: number;
  lastUnitPriceMinor: number;
  lastOrderedAt: Date | null;
  firstOrderedAt: Date | null;
  /** متوسط الأيام بين طلبين — يكشف دورة إعادة الطلب */
  averageDaysBetweenOrders: number | null;
  /** تغيّر السعر عند هذا المورّد */
  priceChange: PriceChange | null;
}

/**
 * تجميع الأصناف — **لكل مورّد على حدة**.
 *
 * الدمج عبر المورّدين على الاسم وحده كان خطأً جسيماً: «عنب» عند المحمصة
 * الغربية كيلو بنّ بمئة وخمسة وخمسين ريالاً، و«عنب» عند لافا زجاجة كمبوتشا
 * بثلاثة عشر. فدمجهما أنتج «صنف واحد بسعرين» و«توفير ممكن» لا وجود له.
 *
 * الاسم لا يعرّف صنفاً. والمورّد مع الاسم أقرب، وإن بقي ناقصاً — فالمورّد
 * الواحد قد يكتب الصنف نفسه بصيغتين («عنب» و«كولومبي عنب»). لكن الخطأ في
 * هذا الاتجاه يُفرّق ما هو واحد، وذلك أهون من أن يجمع ما ليس واحداً ثمّ
 * يبني عليه توصية بالمال.
 */
export function summarizeItems(rows: readonly LineRow[]): ItemSummary[] {
  const groups = new Map<string, LineRow[]>();
  for (const row of rows) {
    const normalized = row.normalizedDescription || normalizeItem(row.description);
    if (!normalized) continue;
    const key = `${row.supplierId ?? "—"}::${normalized}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const summaries: ItemSummary[] = [];

  for (const [key, list] of groups) {
    const dated = list
      .filter((r) => r.invoiceDate)
      .sort((a, b) => a.invoiceDate!.getTime() - b.invoiceDate!.getTime());

    const totalQuantity = list.reduce((s, r) => s + r.quantity, 0);
    const totalSpentMinor = list.reduce((s, r) => s + r.lineTotalMinor, 0);

    // الأطول اسماً أوفى وصفاً غالباً: «حليب طازج كامل الدسم ٢ لتر» خير من «حليب»
    const displayName = list.reduce(
      (best, r) => (r.description.length > best.length ? r.description : best),
      list[0].description,
    );

    // متوسط الفترة بين الطلبات — يُحسب من التواريخ الفريدة لا من كل سطر
    const uniqueDays = [...new Set(dated.map((r) => r.invoiceDate!.toISOString().slice(0, 10)))].sort();
    let averageDaysBetweenOrders: number | null = null;
    if (uniqueDays.length >= 2) {
      const first = new Date(`${uniqueDays[0]}T00:00:00Z`).getTime();
      const last = new Date(`${uniqueDays[uniqueDays.length - 1]}T00:00:00Z`).getTime();
      averageDaysBetweenOrders = Math.round((last - first) / 86_400_000 / (uniqueDays.length - 1));
    }

    const latest = dated[dated.length - 1] ?? list[list.length - 1];

    summaries.push({
      key,
      supplierId: list[0].supplierId,
      supplierName: list[0].supplierName ?? "—",
      normalized: key.split("::")[1] ?? "",
      displayName,
      orderCount: list.length,
      totalQuantity,
      totalSpentMinor,
      averageUnitPriceMinor: totalQuantity > 0 ? Math.round(totalSpentMinor / totalQuantity) : 0,
      lastUnitPriceMinor: latest.unitPriceMinor,
      lastOrderedAt: dated.length ? dated[dated.length - 1].invoiceDate : null,
      firstOrderedAt: dated.length ? dated[0].invoiceDate : null,
      averageDaysBetweenOrders,
      priceChange: detectPriceChange(
        dated.map((r) => ({ date: r.invoiceDate!, unitPriceMinor: r.unitPriceMinor })),
      ),
    });
  }

  return summaries.sort((a, b) => b.totalSpentMinor - a.totalSpentMinor);
}

/**
 * أصناف تحمل الاسم نفسه عند مورّدين مختلفين.
 *
 * مرشّحة للمراجعة لا نتيجة مؤكَّدة. تطابق الاسم لا يعني تطابق الصنف —
 * ودرس «العنب» يمنعنا من أن نبني على ذلك رقماً نسمّيه توفيراً. فيُعرض
 * الاسمان والمورّدان والسعران، ويقرّر الإنسان أهما صنف واحد أم لا.
 */
export interface SameNameCandidate {
  normalized: string;
  cheaper: ItemSummary;
  dearer: ItemSummary;
  gapMinor: number;
  gapRatio: number;
}

export function findSameNameCandidates(
  items: readonly ItemSummary[],
  minRatio = 0.05,
): SameNameCandidate[] {
  const byName = new Map<string, ItemSummary[]>();
  for (const i of items) {
    if (!i.normalized || !i.supplierId) continue;
    const list = byName.get(i.normalized) ?? [];
    list.push(i);
    byName.set(i.normalized, list);
  }

  const out: SameNameCandidate[] = [];

  for (const [normalized, list] of byName) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.lastUnitPriceMinor - b.lastUnitPriceMinor);
    const cheaper = sorted[0];
    const dearer = sorted[sorted.length - 1];
    const gapMinor = dearer.lastUnitPriceMinor - cheaper.lastUnitPriceMinor;
    if (gapMinor <= 0 || cheaper.lastUnitPriceMinor === 0) continue;

    const gapRatio = gapMinor / cheaper.lastUnitPriceMinor;
    if (gapRatio < minRatio) continue;

    out.push({ normalized, cheaper, dearer, gapMinor, gapRatio });
  }

  return out.sort((a, b) => b.gapRatio - a.gapRatio);
}

/* ───────────────────────── ضريبة المدخلات المعرّضة ───────────────────────── */

export interface VatRiskRow {
  invoiceId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: Date;
  /** `null` تعني «لم يُقرأ» لا «صفر» */
  vatMinor: number | null;
  inputVatStatus: InputVatStatus;
}

export interface VatRisk {
  /** ضريبة معلومة على فاتورة معلوم أنّها لا تصلح للخصم */
  atRiskMinor: number;
  recoverableMinor: number;
  atRiskCount: number;
  /** فواتير لم يُقرأ تفصيلها — لا يُدّعى عنها شيء */
  unknownCount: number;
  unknownTotalMinor: number;
  rows: VatRiskRow[];
}

/**
 * كم ضريبة مدخلات نخسرها.
 *
 * المجهول يُعدّ على حدة ولا يدخل «المعرّض». كانت مئة فاتورة لم يُقرأ
 * تفصيلها تُحسب صفراً، فتقول اللوحة «صفر ريال معرّضة» — وذلك أسوأ من
 * الفراغ لأنّه يُطمئن كذباً.
 */
export function vatAtRisk(
  rows: readonly VatRiskRow[],
  unknownTotals: readonly number[] = [],
): VatRisk {
  const atRisk = rows.filter(
    (r) => r.inputVatStatus === "NOT_ELIGIBLE" && r.vatMinor !== null && r.vatMinor > 0,
  );
  const unknown = rows.filter((r) => r.inputVatStatus === "UNKNOWN");

  return {
    atRiskMinor: atRisk.reduce((s, r) => s + (r.vatMinor ?? 0), 0),
    recoverableMinor: rows
      .filter((r) => r.inputVatStatus === "ELIGIBLE")
      .reduce((s, r) => s + (r.vatMinor ?? 0), 0),
    atRiskCount: atRisk.length,
    unknownCount: unknown.length,
    unknownTotalMinor: unknownTotals.reduce((s, v) => s + v, 0),
    rows: [...atRisk].sort((a, b) => (b.vatMinor ?? 0) - (a.vatMinor ?? 0)),
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

/**
 * اتّجاه المشتريات شهراً عن شهر — والشهر الجاري يُقارَن بمثله.
 *
 * كان الشهر الجاري يُجمَع كما هو ويُقارَن بشهرٍ تامّ قبله، فتقول
 * الصفحة في السادس من سبتمبر «▼ ٩٨٪ عن أغسطس». والنقص يومٌ لا سلوك،
 * والإنذار الكاذب الذي يتكرّر كل أوّل شهر يُفقد الثقة بما عداه.
 *
 * فإن كان الشهر الأحدث هو شهر اليوم، قُصّ الشهر السابق عند اليوم نفسه:
 * أوّل ستّة أيّامٍ بأوّل ستّة. و`basisDays` تقول ما قِيس كي يُعلَن.
 */
export interface SpendTrend {
  /** نسبة التغيّر كسراً — أو `null` إن لا أساس يُقاس عليه. */
  pct: number | null;
  /** عدد أيّام الشهر الجاري المقيسة، أو `null` إن كان تامّاً. */
  basisDays: number | null;
  prevMonth: string | null;
}

export function spendTrend(
  rows: readonly { periodMonth: string; invoiceDate: Date; totalMinor: number }[],
  today: Date,
): SpendTrend {
  const months = [...new Set(rows.map((r) => r.periodMonth))].sort();
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  if (!cur || !prev) return { pct: null, basisDays: null, prevMonth: prev ?? null };

  const runningMonth = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const basisDays = cur === runningMonth ? today.getUTCDate() : null;

  const sum = (month: string, capDay: number | null) =>
    rows
      .filter((r) => r.periodMonth === month && (capDay === null || r.invoiceDate.getUTCDate() <= capDay))
      .reduce((s, r) => s + r.totalMinor, 0);

  const curTotal = sum(cur, null);
  const prevTotal = sum(prev, basisDays);
  if (prevTotal <= 0) return { pct: null, basisDays, prevMonth: prev };

  return { pct: (curTotal - prevTotal) / prevTotal, basisDays, prevMonth: prev };
}
