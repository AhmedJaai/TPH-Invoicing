/**
 * لوحةُ المبيعات — قراءةٌ لما استُورد من ملفّ فودكس الحقيقيّ، لا غير.
 *
 * كانت `sales` و`sale_lines` تمتلئان لأجل الجرد وحده، ولا صفحةَ تقرؤهما مبيعاتٍ.
 * وثلاثةُ أسئلةٍ جوابُها مخزَّن:
 *
 *   ١. كم بِعتُ يوماً بيوم؟ — ومقابل مثل اليوم من الأسابيع الأربعة السابقة.
 *   ٢. ما الذي يُباع وما الذي يحمل المبيعات؟ — وما توقّف بيعُه.
 *   ٣. كم خرج بلا مال؟ — ملغىً ومرتجعاً وضيافة.
 *
 * **واليومُ الذي لم يُستورَد ملفُّه `null` لا صفر**: صفرٌ هنا يقول إنّ المقهى لم
 * يبع شيئاً. والتغطيةُ تُعدّ وتُكتب فوق الأرقام، والمقارنةُ بفترةٍ ناقصةِ التغطية
 * تُحجَب (`null`) ولا تُحسب.
 *
 * دوالُّ خالصة. المالُ بالهللات والكمّيّةُ بالمِلّي، والنِّسبُ بنقاط الأساس.
 */

export interface SalesDay {
  /** يومُ العمل في ملفّ فودكس — YYYY-MM-DD. */
  day: string;
  /** ما بيع (بلا الملغى والمرتجع) كما في الملفّ. */
  salesMinor: number;
  vatMinor: number;
  refundMinor: number;
  /** عددُ الطلبات — صفرٌ في تقرير «مزيج المنتجات» الذي لا يحمل الطلبات. */
  orders: number;
}

function shift(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** نسبةُ التغيّر بنقاط الأساس — `null` بلا أساسٍ يُقاس عليه. */
export function changeBp(nowMinor: number, beforeMinor: number | null): number | null {
  if (beforeMinor === null || beforeMinor <= 0) return null;
  return Math.round(((nowMinor - beforeMinor) * 10_000) / beforeMinor);
}

/** حصّةٌ بنقاط الأساس — `null` بلا مقام. */
export function shareBp(partMinor: number, wholeMinor: number): number | null {
  if (wholeMinor <= 0) return null;
  return Math.round((partMinor * 10_000) / wholeMinor);
}

/* ─────────────────────────── يوماً بيوم ─────────────────────────── */

/** كم أسبوعاً سابقاً يُقارَن به اليوم، وكم منها يلزم مستورَداً. */
export const COMPARE_WEEKS = 4;
export const COMPARE_MIN_WEEKS = 2;

export interface DayRow {
  day: string;
  /** `null`: لم يُستورَد ملفُّ هذا اليوم — لا «لم يُبَع شيء». */
  salesMinor: number | null;
  vatMinor: number | null;
  orders: number | null;
  /** وسيطُ مثل هذا اليوم من الأسابيع الأربعة السابقة — `null` دون أسبوعين مستورَدين. */
  usualMinor: number | null;
  /** الفرقُ عن عادته بنقاط الأساس. */
  vsUsualBp: number | null;
}

export interface DailySeries {
  from: string;
  to: string;
  /** الأحدثُ أوّلاً. */
  rows: DayRow[];
  expectedDays: number;
  coveredDays: number;
  /** مجموعُ الأيّام المستورَدة وحدها — و`null` إن لم يُستورَد منها شيء. */
  salesMinor: number | null;
  vatMinor: number | null;
  orders: number | null;
  /** أيّامٌ من الفترة بلا ملفّ — تُسرَد ولا تُحسب أصفاراً. */
  missingDays: string[];
}

/**
 * سلسلةُ الأيّام من `from` إلى `to` (داخلَين) — و`days` كلُّ ما استُورد (ويشمل ما
 * قبل `from` لتُعرف عادةُ اليوم).
 */
export function buildDailySeries(days: readonly SalesDay[], from: string, to: string): DailySeries {
  const by = new Map(days.map((d) => [d.day, d]));
  const rows: DayRow[] = [];
  const missingDays: string[] = [];
  let covered = 0;
  let sales = 0;
  let vat = 0;
  let orders = 0;
  let expected = 0;

  for (let day = from; day <= to; day = shift(day, 1)) {
    expected++;
    const d = by.get(day);
    const earlier = Array.from({ length: COMPARE_WEEKS }, (_, i) => by.get(shift(day, -7 * (i + 1))))
      .flatMap((x) => (x ? [x.salesMinor] : []));
    const usualMinor = earlier.length >= COMPARE_MIN_WEEKS ? median(earlier) : null;
    if (!d) {
      missingDays.push(day);
      rows.push({ day, salesMinor: null, vatMinor: null, orders: null, usualMinor, vsUsualBp: null });
      continue;
    }
    covered++;
    sales += d.salesMinor;
    vat += d.vatMinor;
    orders += d.orders;
    rows.push({
      day, salesMinor: d.salesMinor, vatMinor: d.vatMinor, orders: d.orders, usualMinor,
      vsUsualBp: changeBp(d.salesMinor, usualMinor),
    });
  }

  return {
    from, to,
    rows: rows.reverse(),
    expectedDays: expected,
    coveredDays: covered,
    salesMinor: covered > 0 ? sales : null,
    vatMinor: covered > 0 ? vat : null,
    orders: covered > 0 ? orders : null,
    missingDays,
  };
}

/** أتُقارَن الفترتان؟ — حين تتطابق تغطيتُهما وتكتمل: مقارنةُ ٢٨ يوماً بـ١٩ تكذب. */
export function comparable(current: Pick<DailySeries, "expectedDays" | "coveredDays">, previous: Pick<DailySeries, "expectedDays" | "coveredDays">): boolean {
  return current.coveredDays === current.expectedDays && previous.coveredDays === previous.expectedDays && current.expectedDays === previous.expectedDays;
}

/* ─────────────────────────── ما يُباع ─────────────────────────── */

export interface ItemSales {
  /** هويّةُ المنتج في نقطة البيع — أو وصفُ السطر إن لم يُربَط. */
  key: string;
  name: string;
  category: string | null;
  quantityMilli: number;
  salesMinor: number;
}

export interface MenuRow extends ItemSales {
  /** حصّتُه من مبيعات الفترة. */
  shareBp: number | null;
  /** حصّةٌ تراكميّة من الأعلى — «أيُّ الأصناف يحمل ٨٠٪؟». */
  cumulativeBp: number | null;
  /** مبيعاتُه في الفترة السابقة — `null` الفترتان لا تُقارَنان. */
  previousMinor: number | null;
  trendBp: number | null;
}

export interface MenuMix {
  rows: MenuRow[];
  totalMinor: number;
  totalQuantityMilli: number;
  /** بيع في الفترة السابقة ولم يُبَع في هذه — `null` الفترتان لا تُقارَنان. */
  stopped: ItemSales[] | null;
  /** كم صنفاً من الأعلى يحمل ٨٠٪ من المبيعات. */
  carry80: number;
}

export function buildMenuMix(current: readonly ItemSales[], previous: readonly ItemSales[], canCompare: boolean): MenuMix {
  const sold = current.filter((i) => i.quantityMilli > 0 || i.salesMinor > 0);
  const totalMinor = sold.reduce((s, i) => s + i.salesMinor, 0);
  const before = new Map(previous.map((i) => [i.key, i]));
  const sorted = [...sold].sort((a, b) => b.salesMinor - a.salesMinor || b.quantityMilli - a.quantityMilli || a.name.localeCompare(b.name));

  let running = 0;
  let carry80 = 0;
  const rows: MenuRow[] = sorted.map((i, index) => {
    running += i.salesMinor;
    const cumulativeBp = shareBp(running, totalMinor);
    if (carry80 === 0 && cumulativeBp !== null && cumulativeBp >= 8_000) carry80 = index + 1;
    const previousMinor = canCompare ? before.get(i.key)?.salesMinor ?? 0 : null;
    return {
      ...i,
      shareBp: shareBp(i.salesMinor, totalMinor),
      cumulativeBp,
      previousMinor,
      trendBp: canCompare ? changeBp(i.salesMinor, previousMinor) : null,
    };
  });

  const now = new Set(sold.map((i) => i.key));
  return {
    rows,
    totalMinor,
    totalQuantityMilli: sold.reduce((s, i) => s + i.quantityMilli, 0),
    stopped: canCompare
      ? previous.filter((i) => i.quantityMilli > 0 && !now.has(i.key)).sort((a, b) => b.salesMinor - a.salesMinor)
      : null,
    carry80,
  };
}

/* ─────────────────────────── ما خرج بلا مال ─────────────────────────── */

export type LeakKind = "VOID" | "REFUND" | "COMP";

export const LEAK_LABEL: Record<LeakKind, string> = {
  VOID: "ملغى",
  REFUND: "مرتجع",
  COMP: "ضيافة ومجّانيّ",
};

export interface LeakDay {
  day: string;
  kind: LeakKind;
  lines: number;
  quantityMilli: number;
  /** الملغى والمرتجعُ بإجماليّ سطرهما، والمجّانيُّ بسعر بيعه × كمّيّته (لا بكلفته). */
  valueMinor: number;
}

export interface LeakTotal {
  kind: LeakKind;
  lines: number;
  quantityMilli: number;
  valueMinor: number;
  /** نسبتُه من مبيعات الفترة. */
  ofSalesBp: number | null;
}

/** كم مثلاً من وسيط الأيّام يُعدّ قفزة، وكم يوماً يلزم ليُعرف الوسيط. */
export const SPIKE_MULTIPLE = 3;
export const SPIKE_MIN_DAYS = 7;
/** ودون هذا لا تُسمّى قفزة: ثلاثةُ أمثال خمسة ريالات ليست خبراً. */
export const SPIKE_FLOOR_MINOR = 100_00;

export interface LeakSpike {
  day: string;
  valueMinor: number;
  usualMinor: number;
}

export interface LeakSummary {
  totals: LeakTotal[];
  valueMinor: number;
  ofSalesBp: number | null;
  /** أيّامٌ خرج فيها أكثرُ من ثلاثة أمثال وسيط الأيّام — الأحدثُ أوّلاً. */
  spikes: LeakSpike[];
}

/**
 * `coveredDays` أيّامُ الفترة المستورَدة: يومٌ مستورَد بلا ملغىً ولا مرتجع قيمتُه صفرٌ
 * **معلوم** فيدخل الوسيط؛ ويومٌ بلا ملفّ لا يدخل.
 */
export function buildLeakSummary(leaks: readonly LeakDay[], salesMinor: number | null, coveredDays: readonly string[]): LeakSummary {
  const kinds: LeakKind[] = ["VOID", "REFUND", "COMP"];
  const totals: LeakTotal[] = kinds.map((kind) => {
    const of = leaks.filter((l) => l.kind === kind);
    const valueMinor = of.reduce((s, l) => s + l.valueMinor, 0);
    return {
      kind,
      lines: of.reduce((s, l) => s + l.lines, 0),
      quantityMilli: of.reduce((s, l) => s + l.quantityMilli, 0),
      valueMinor,
      ofSalesBp: salesMinor === null ? null : shareBp(valueMinor, salesMinor),
    };
  });
  const valueMinor = totals.reduce((s, t) => s + t.valueMinor, 0);

  const perDay = new Map<string, number>(coveredDays.map((d) => [d, 0]));
  for (const l of leaks) if (perDay.has(l.day)) perDay.set(l.day, (perDay.get(l.day) ?? 0) + l.valueMinor);
  const usual = perDay.size >= SPIKE_MIN_DAYS ? median([...perDay.values()]) : null;
  const spikes: LeakSpike[] = usual === null
    ? []
    : [...perDay.entries()]
        .filter(([, v]) => v >= SPIKE_FLOOR_MINOR && v > usual * SPIKE_MULTIPLE)
        .map(([day, v]) => ({ day, valueMinor: v, usualMinor: usual }))
        .sort((a, b) => b.day.localeCompare(a.day));

  return { totals, valueMinor, ofSalesBp: salesMinor === null ? null : shareBp(valueMinor, salesMinor), spikes };
}

/** كمّيّةٌ بالمِلّي عدداً يُقرأ: «‏12» و«‏2.5» — بلا أصفارٍ زائدة. */
export function formatUnits(milli: number): string {
  const sign = milli < 0 ? "−" : "";
  const abs = Math.abs(Math.round(milli));
  const whole = String(Math.floor(abs / 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

/** نقاطُ الأساس نسبةً بخانةٍ واحدة — معزولةً كي لا تنقلب في سطرٍ عربيّ. و`null` «غير معروف». */
export function formatShare(bp: number | null): string {
  if (bp === null) return "غير معروف";
  const abs = Math.abs(bp);
  const tenths = Math.round(abs / 10);
  return `⁦${bp < 0 ? "−" : ""}${Math.floor(tenths / 10)}.${tenths % 10}٪⁩`;
}
