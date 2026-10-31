/**
 * أداءُ المقهى — مؤشّراتُ الشهر بنسبتها من الإيراد، ومرجعُ الصناعة بجانبها.
 *
 * حسابٌ نقيّ فوق ما حسبته الدفاتر (`loadPnl`): لا يُنشئ رقماً ولا يصحّحه، يقسم ما
 * عُرف على ما عُرف. والمجهولُ يبقى مجهولاً: شهرٌ بلا رواتب في الكشف لا «تكلفة عمالة
 * صفر» — يقول ذلك ولا يُقارَن.
 *
 * والمرجعُ **عامّ** لا قياسٌ لهذا المقهى: نطاقاتٌ شائعة لمقاهي القهوة المختصّة يتداولها
 * أهلُ الصناعة. تُعرض بجانب الرقم ليُرى بعدُه عن المعتاد، ولا تُكتب حكماً.
 */

export interface KpiInput {
  month: string;
  /** الإيراد بلا ضريبة — `null` لا مبيعات مقروءة. */
  revenueMinor: number | null;
  /** ما دفعه الزبائن شاملاً الضريبة، والبطاقةُ منه. */
  paidMinor: number | null;
  cardMinor: number | null;
  orders: number | null;
  cogsMinor: number | null;
  /** المصروفُ بأبوابه كما في الربح — موجب. */
  opex: ReadonlyMap<string, number>;
  /** أبوابٌ لم تظهر في الشهر وهي منتظَرة — «غير معروف» لا صفر. */
  missing: ReadonlySet<string>;
  profitMinor: number | null;
  profitLabel: string;
  complete: boolean;
  open: boolean;
  discountMinor: number;
  refundsMinor: number;
  staffListMinor: number;
}

export interface MonthKpi {
  month: string;
  open: boolean;
  complete: boolean;
  revenueMinor: number | null;
  orders: number | null;
  /** متوسّطُ الطلب شاملاً الضريبة. */
  ticketMinor: number | null;
  /** النسبُ بنقاط الأساس من الإيراد بلا ضريبة — `null` مجهولةٌ أو لا إيراد. */
  cogsBp: number | null;
  labourBp: number | null;
  rentBp: number | null;
  primeBp: number | null;
  utilitiesBp: number | null;
  /** رسومُ الشبكة وضريبتُها من مقبوض البطاقة. */
  cardFeeBp: number | null;
  profitMinor: number | null;
  profitLabel: string;
  netMarginBp: number | null;
  discountBp: number | null;
  refundsBp: number | null;
  staffListMinor: number;
}

const ratio = (part: number | null, whole: number | null): number | null =>
  part === null || whole === null || whole <= 0 ? null : Math.round((part * 10_000) / whole);

/** بابٌ منتظَرٌ لم يظهر مجهول؛ وما لم يُنتظَر ولم يظهر صفرٌ حقيقيّ. */
function opexOf(input: KpiInput, category: string): number | null {
  if (input.missing.has(category)) return null;
  return input.opex.get(category) ?? 0;
}

export function monthKpi(input: KpiInput): MonthKpi {
  const rev = input.revenueMinor;
  const labour = opexOf(input, "SALARY");
  const rent = opexOf(input, "RENT");
  const fees = (input.opex.get("POS_FEE") ?? 0) + (input.opex.get("POS_VAT") ?? 0);
  return {
    month: input.month,
    open: input.open,
    complete: input.complete,
    revenueMinor: rev,
    orders: input.orders,
    ticketMinor: input.orders && input.orders > 0 && input.paidMinor !== null ? Math.round(input.paidMinor / input.orders) : null,
    cogsBp: ratio(input.cogsMinor, rev),
    labourBp: ratio(labour, rev),
    rentBp: ratio(rent, rev),
    primeBp: input.cogsMinor === null || labour === null ? null : ratio(input.cogsMinor + labour, rev),
    utilitiesBp: ratio(opexOf(input, "UTILITY"), rev),
    /* بلا مقبوضِ بطاقةٍ لا نسبة؛ وبلا رسومٍ في الكشف لا «صفر٪» — قد لم يُستورد الكشف */
    cardFeeBp: fees > 0 ? ratio(fees, input.cardMinor) : null,
    profitMinor: input.profitMinor,
    profitLabel: input.profitLabel,
    netMarginBp: ratio(input.profitMinor, rev),
    discountBp: ratio(input.discountMinor, input.paidMinor),
    refundsBp: ratio(input.refundsMinor, input.paidMinor),
    staffListMinor: input.staffListMinor,
  };
}

export type BenchmarkKey = "cogs" | "labour" | "prime" | "rent" | "netMargin" | "prepMedian";

export interface Benchmark {
  key: BenchmarkKey;
  label: string;
  /** النطاقُ الشائع — بنقاط الأساس للنسب، وبالثواني للزمن. */
  low: number;
  high: number;
  /** أيّ الاتّجاهين خيرٌ إن خرج عن النطاق. */
  better: "lower" | "higher";
  note: string;
}

/**
 * نطاقاتٌ عامّة لمقاهي القهوة المختصّة — مرجعٌ يتداوله أهلُ الصناعة، لا قياسٌ من دفاترك
 * ولا معيارٌ نظاميّ. وكلُّ مقهى يختلف بموقعه وحجمه؛ فهي «أين أنت من المعتاد» لا «صحّ وخطأ».
 */
export const BENCHMARKS: Record<BenchmarkKey, Benchmark> = {
  cogs: { key: "cogs", label: "تكلفة المبيعات", low: 2500, high: 3500, better: "lower", note: "القهوة المختصّة بين 25٪ و35٪ من الإيراد في الغالب، وتعلو مع الحلويات المشتراة جاهزة" },
  labour: { key: "labour", label: "الرواتب والأجور", low: 2500, high: 3500, better: "lower", note: "بين 25٪ و35٪ من الإيراد في الغالب، وتعلو في أشهر الافتتاح وقلّة الزبائن" },
  prime: { key: "prime", label: "التكلفة الأساسيّة (المبيعات + الرواتب)", low: 5500, high: 6500, better: "lower", note: "ما فوق 65٪ يترك للإيجار والباقي قليلاً، وهو أوّل ما ينظر إليه أهل الصناعة" },
  rent: { key: "rent", label: "الإيجار", low: 600, high: 1200, better: "lower", note: "بين 6٪ و12٪ من الإيراد في الغالب؛ ما فوقه يجعل المقهى رهين حجم المبيعات" },
  netMargin: { key: "netMargin", label: "هامش الربح", low: 1000, high: 1500, better: "higher", note: "المقهى المستقرّ يربح بين 10٪ و15٪ من إيراده في الغالب، وأقلّ من ذلك في سنته الأولى" },
  prepMedian: { key: "prepMedian", label: "زمن التحضير (الوسيط)", low: 180, high: 300, better: "lower", note: "يُستهدف في القهوة المختصّة أن ينتهي أغلب الطلبات بين ثلاث وخمس دقائق" },
};

export type Verdict = "BETTER" | "WITHIN" | "WORSE" | "SUSPECT";

/**
 * أين يقع الرقمُ من النطاق — `null` مجهولٌ لا يُحكَم عليه.
 *
 * و«أفضل» بعيدٌ جدّاً ليس بشرى بل سؤال: هامشُ ربحٍ ٤٢٪ في مقهى (المعتاد ١٠–١٥٪) كان
 * يُقال «أفضل من المعتاد» وهو في الأرجح تكاليفُ غائبة عن الدفاتر — رواتبُ دُفعت من حساب
 * المالك، فواتيرُ لم تُرفع. فما تجاوز الجهةَ الحسنة بكثير (`SUSPECT_FACTOR`) يُقال «تحقّق».
 */
export const SUSPECT_FACTOR = { lower: 0.6, higher: 1.8 } as const;

export function verdictOf(value: number | null, b: Benchmark): Verdict | null {
  if (value === null) return null;
  if (value >= b.low && value <= b.high) return "WITHIN";
  const above = value > b.high;
  const good = (above && b.better === "higher") || (!above && b.better === "lower");
  if (!good) return "WORSE";
  const far = b.better === "higher" ? value > b.high * SUSPECT_FACTOR.higher : value < b.low * SUSPECT_FACTOR.lower;
  return far ? "SUSPECT" : "BETTER";
}

/* ─────────────────────────── سرعةُ الخدمة ─────────────────────────── */

export interface PrepSample {
  /** ساعةُ وصول الطلب إلى الشاشة بتوقيت الرياض. */
  hour: number;
  seconds: number;
}

export interface ServiceSpeed {
  /** طلباتٌ لها وقتا الشاشة معاً. */
  measured: number;
  /** ما تجاوز الساعة — نُسي إنهاؤه على الشاشة غالباً، فيُعَدّ ولا يدخل الوسيط. */
  forgotten: number;
  medianSec: number | null;
  p90Sec: number | null;
  /** نسبةُ ما تجاوز عشر دقائق — بنقاط الأساس. */
  slowBp: number | null;
  byHour: { hour: number; orders: number; medianSec: number; p90Sec: number }[];
}

/** حدُّ «نُسي على الشاشة» — طلبُ قهوةٍ لا يأخذ ساعة. */
export const FORGOTTEN_SEC = 3600;
export const SLOW_SEC = 600;
/** ساعةٌ بأقلّ من هذا لا يُقال وسيطُها — عيّنةٌ لا تكفي. */
const MIN_HOUR_ORDERS = 15;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function serviceSpeed(samples: readonly PrepSample[]): ServiceSpeed {
  const kept = samples.filter((s) => s.seconds >= 0 && s.seconds < FORGOTTEN_SEC);
  const forgotten = samples.filter((s) => s.seconds >= FORGOTTEN_SEC).length;
  const all = kept.map((s) => s.seconds).sort((a, b) => a - b);
  const hours = new Map<number, number[]>();
  for (const s of kept) hours.set(s.hour, [...(hours.get(s.hour) ?? []), s.seconds]);
  return {
    measured: kept.length,
    forgotten,
    medianSec: all.length ? percentile(all, 0.5) : null,
    p90Sec: all.length ? percentile(all, 0.9) : null,
    slowBp: all.length ? Math.round((all.filter((x) => x > SLOW_SEC).length * 10_000) / all.length) : null,
    byHour: [...hours]
      .filter(([, xs]) => xs.length >= MIN_HOUR_ORDERS)
      .map(([hour, xs]) => {
        const sorted = [...xs].sort((a, b) => a - b);
        return { hour, orders: xs.length, medianSec: percentile(sorted, 0.5), p90Sec: percentile(sorted, 0.9) };
      })
      .sort((a, b) => businessHourOrder(a.hour) - businessHourOrder(b.hour)),
  };
}

/**
 * ترتيبُ ساعات يوم العمل لا يوم الساعة: المقهى يفتح السابعة ويغلق الثالثة فجراً
 * (`opening_from`/`opening_to` في فرع فودكس)، فمنتصفُ الليل آخرُ اليوم لا أوّلُه.
 */
export const BUSINESS_DAY_START_HOUR = 5;
export function businessHourOrder(hour: number): number {
  return (hour - BUSINESS_DAY_START_HOUR + 24) % 24;
}

/** «٧ د ١٢ ث» — زمنُ التحضير بكلماتٍ قصيرة. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} ث`;
  return s === 0 ? `${m} د` : `${m} د ${s} ث`;
}

/** حصّةٌ من كلّ بلا إشارة — «‏28.4٪»، و`null` «غير معروف». معزولةٌ كي لا يقفز «٪». */
export function formatShare(bp: number | null): string {
  if (bp === null) return "غير معروف";
  return `⁦${Math.round(bp / 10) / 10}٪⁩`;
}
