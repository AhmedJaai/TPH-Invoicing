/**
 * رأسُ ملفّ المورّد — «ما حالي معه؟» في جوابٍ واحد، دوالَّ خالصة.
 *
 * لا يحسب هذا الملفّ «عليك» ولا «متأخّراً» ولا «تغيّر السعر»: الأوّلُ من
 * `supplier-balances.ts`، والثاني من `pastDueOf` (`supplier-edit.ts`)، والثالثُ
 * من `price-watch.ts`. وما يفعله أن يجمعها استثناءاتٍ لكلٍّ منها فعلُه، وأن
 * يرصف المصروفَ شهراً بشهر، ويقول آخرَ تغيّرٍ في السعر جملةً.
 */
import { addMonths, monthsBetween } from "./filing";
import { formatMonth } from "./riyadh-time";
import { countNoun, DAY, INVOICE, PRODUCT } from "./arabic";
import type { PriceState } from "./price-watch";

/* ───────────────────────── الاستثناءات ───────────────────────── */

export interface SupplierFacts {
  supplierId: string;
  slug: string;
  /** «عليك له» من مصدر الأرصدة وحده */
  owedMinor: number;
  /** `pastDueOf` — `null` حين يُجهل أجلُه */
  pastDue: { count: number; totalMinor: number; oldestDays: number } | null;
  /** عمرُ أقدم ما عليك (`ageOwed`) — `null` إن لم يبقَ شيء */
  oldestOwedDays: number | null;
  /** حالُ المقارنة بكشفه (`buildSupplierAccount`) */
  statementStatus: string;
  statementDifferenceMinor: number | null;
  /** أصنافٌ ارتفع سعرُها ارتفاعاً مؤكَّداً (`isRealMove`) */
  risingItems: number;
  /** سقفُ التنبيه الذي كتبه صاحبُ المقهى — `null` بلا سقف */
  alertMinor: number | null;
  issuesStatements: boolean;
  statementCount: number;
  invoiceCount: number;
  canPay: boolean;
}

export interface SupplierException {
  id: "PAST_DUE" | "OLD_DEBT" | "OVER_ALERT" | "STATEMENT_DIFFERS" | "NO_STATEMENT" | "PRICE_RISE";
  tone: "warn" | "danger" | "info";
  title: string;
  /** مبلغٌ يُعرض بجانب الجملة — `null` إن لم يكن */
  amountMinor: number | null;
  action: { label: string; href: string } | null;
}

/** ما جاوز هذا من العمر بلا أجلٍ معروف يُقال — كما في شرائح الأعمار (أكثر من ٦٠). */
export const OLD_DEBT_DAYS = 60;

/**
 * ما يحتاج فعلاً عند هذا المورّد، الأهمُّ أوّلاً، وبجانب كلٍّ بابُه.
 * المالُ المستحقّ أوّلاً، ثمّ ما يخالف كشفَه، ثمّ ما ينقص، ثمّ الأسعار.
 */
export function supplierExceptions(f: SupplierFacts): SupplierException[] {
  const out: SupplierException[] = [];
  const base = `/suppliers/${encodeURIComponent(f.slug)}`;
  const pay = f.canPay ? { label: "جهّز سداده", href: `/payments?supplier=${encodeURIComponent(f.supplierId)}` } : null;

  if (f.owedMinor > 0 && f.pastDue && f.pastDue.count > 0) {
    out.push({
      id: "PAST_DUE",
      /* للعلم لا للتنبيه (أحمد، ٢٤ أكتوبر ٢٠٢٦): المورّدون يُسدَّدون في دفعة آخر الشهر */
      tone: "info",
      title: `للعلم: ${countNoun(f.pastDue.count, INVOICE)} تجاوزت أجله، أقدمها بـ${countNoun(f.pastDue.oldestDays, DAY)}`,
      amountMinor: f.pastDue.totalMinor,
      action: pay,
    });
  } else if (f.owedMinor > 0 && f.pastDue === null && f.oldestOwedDays !== null && f.oldestOwedDays > OLD_DEBT_DAYS) {
    /* بلا أجلٍ معروف لا يُقال «متأخّر» — يُقال العمرُ كما هو */
    out.push({
      id: "OLD_DEBT",
      tone: f.oldestOwedDays > 90 ? "danger" : "warn",
      title: `أقدم مبلغ مستحق له منذ ${countNoun(f.oldestOwedDays, DAY)}`,
      amountMinor: null,
      action: pay,
    });
  }
  if (f.alertMinor !== null && f.owedMinor > f.alertMinor) {
    out.push({
      id: "OVER_ALERT",
      tone: "warn",
      title: "المستحق له تجاوز الحد الذي وضعته",
      amountMinor: f.alertMinor,
      action: { label: "عدّل الحد", href: `${base}?tab=profile#detail` },
    });
  }
  if (f.statementStatus === "DIFFERS" && f.statementDifferenceMinor !== null) {
    out.push({
      id: "STATEMENT_DIFFERS",
      tone: "warn",
      title: "رصيد كشفه يخالف سجلاتنا",
      amountMinor: Math.abs(f.statementDifferenceMinor),
      action: { label: "افتح الكشف", href: `/statements?supplier=${encodeURIComponent(f.slug)}` },
    });
  }
  if (f.issuesStatements && f.statementCount === 0 && f.invoiceCount > 0) {
    out.push({
      id: "NO_STATEMENT",
      tone: "info",
      title: "لم يصل منه كشف حساب يُقارن بفواتيرنا",
      amountMinor: null,
      action: { label: "ارفع كشفه", href: `/statements?supplier=${encodeURIComponent(f.slug)}` },
    });
  }
  if (f.risingItems > 0) {
    out.push({
      id: "PRICE_RISE",
      tone: "warn",
      title: `${countNoun(f.risingItems, PRODUCT)} ارتفع سعره ارتفاعاً تأكّد في فاتورتين`,
      amountMinor: null,
      action: { label: "راجع أسعاره", href: `${base}?tab=prices#detail` },
    });
  }
  return out;
}

/* ───────────────────────── آخرُ تغيّرٍ في السعر ───────────────────────── */

export interface PriceChangeLine {
  direction: "UP" | "DOWN";
  /** بالمئة مقرَّبة — موجبةٌ دائماً، والاتّجاهُ في `direction` */
  pct: number;
  /** YYYY-MM — أوّلُ فاتورةٍ بالسعر الجديد */
  sinceMonth: string;
  text: string;
}

/**
 * «ارتفع 8٪ منذ أغسطس 2026» — للتغيّر المؤكَّد الذي لا يفسّره غيرُ السعر وحده.
 * ما ينتظر تأكيداً أو يفسّره الضريبةُ أو الوحدة لا يُقال تغيّراً (`PriceStateCell` يقوله).
 */
export function latestPriceChange(state: PriceState): PriceChangeLine | null {
  if (state.kind !== "MOVED" || state.reason !== null) return null;
  const pct = Math.round(Math.abs(state.deltaBp) / 100);
  if (pct === 0) return null;
  const direction = state.deltaBp > 0 ? "UP" : "DOWN";
  const sinceMonth = state.sinceDay.slice(0, 7);
  return {
    direction,
    pct,
    sinceMonth,
    text: `${direction === "UP" ? "ارتفع" : "انخفض"} ${pct}٪ منذ ${formatMonth(sinceMonth)}`,
  };
}

/* ───────────────────────── المصروفُ بالشهر ───────────────────────── */

export interface SpendRow {
  /** YYYY-MM */
  month: string;
  billedMinor: number;
  invoiceCount: number;
  paidMinor: number;
  paymentCount: number;
}

export interface SpendMonth extends SpendRow {
  /** الشهرُ الجاري — لم يكتمل بعد */
  partial: boolean;
}

/**
 * أشهرُ التعامل مرصوفةً من الأحدث، حتى `count` شهراً تنتهي بشهر اليوم.
 * تبدأ من أوّل شهرٍ فيه فاتورةٌ أو دفعة — فمورّدٌ عمرُه ثلاثةُ أشهر لا تُرسم له
 * تسعةُ أشهرٍ فارغة. وشهرٌ بلا قيدٍ بين شهرين صفٌّ بعدده صفراً: لا فاتورةَ مسجّلة،
 * وهذا ما يُقال فيه بالكلمة لا بـ«0.00».
 */
export function spendMonths(rows: readonly SpendRow[], currentMonth: string, count = 12): SpendMonth[] {
  const active = rows.filter((r) => r.invoiceCount > 0 || r.paymentCount > 0);
  if (active.length === 0) return [];
  const first = active.map((r) => r.month).sort()[0];
  const windowStart = addMonths(currentMonth, -(count - 1));
  const start = first > windowStart ? first : windowStart;
  const span = monthsBetween(start, currentMonth);
  if (span < 0) return [];
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const out: SpendMonth[] = [];
  for (let i = span; i >= 0; i--) {
    const month = addMonths(start, i);
    const r = byMonth.get(month);
    out.push({
      month,
      billedMinor: r?.billedMinor ?? 0,
      invoiceCount: r?.invoiceCount ?? 0,
      paidMinor: r?.paidMinor ?? 0,
      paymentCount: r?.paymentCount ?? 0,
      partial: month === currentMonth,
    });
  }
  return out;
}

/* ───────────────────────── الخطُّ الزمنيّ ───────────────────────── */

export type TimelineKind = "INVOICE" | "PAYMENT" | "STATEMENT" | "AUDIT";

export const TIMELINE_FILTERS: readonly { id: "ALL" | TimelineKind; label: string }[] = [
  { id: "ALL", label: "الكل" },
  { id: "INVOICE", label: "فواتير" },
  { id: "PAYMENT", label: "دفعات" },
  { id: "STATEMENT", label: "كشوف" },
  { id: "AUDIT", label: "قرارات" },
];

/** عددُ كلّ نوعٍ في الخطّ — والمرشِّحُ الفارغ لا يُعرض زرّاً يفتح لا شيء. */
export function timelineCounts(kinds: readonly TimelineKind[]): Record<"ALL" | TimelineKind, number> {
  const out = { ALL: kinds.length, INVOICE: 0, PAYMENT: 0, STATEMENT: 0, AUDIT: 0 };
  for (const k of kinds) out[k]++;
  return out;
}
