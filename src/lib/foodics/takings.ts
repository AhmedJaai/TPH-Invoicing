/**
 * ما قبضه فودكس أمام ما دخل البنك — دفعةً بدفعة للبطاقات، وشهراً بشهر للنقد.
 *
 * ── البطاقات: دفعةُ الجهاز مقطعٌ متّصلٌ من الزمن، وحدُّه لا يُفترَض ──
 *
 * الجهازُ يجمع عمليّاته في «دفعة» يُقفلها ثمّ يودعها البنكُ برقمها وتاريخها. فكلُّ
 * دفعةٍ = بطاقاتُ فودكس من إقفالٍ إلى الذي يليه. والإقفالُ قيس على حساب المقهى
 * قبل أن يُكتب (١١ أكتوبر ٢٠٢٦):
 *
 *   حتى يوليو — آليٌّ عند منتصف الليل تماماً: جُرّبت كلُّ دقيقة، فتطابقت أيّامٌ
 *   كاملة إلى الهللة (‏٥٬٨٤٧٫٦٤ = ‏٥٬٨٤٧٫٦٤).
 *   منذ أغسطس — بيدِ من يُغلق المقهى، بين الثانية والثالثة فجراً، ويتغيّر كلَّ ليلة.
 *
 * فساعةٌ ثابتة تُخطئ كلَّ ليلةٍ بما بِيع حول الحدّ. **فيُبحَث عن الحدّ**: تُمشى دفعاتُ
 * البطاقة بترتيب وقتها، ولكلّ دفعة بنكٍ يُختار موضعُ القطع — داخل نافذةٍ حول ليلتها —
 * الذي يجعل مجموعَ المقطع أقربَ ما يكون إلى مبلغها. إن وُجد موضعٌ يساويه فقد ثبت
 * اليومُ إلى الهللة؛ وإن لم يوجد فالباقي **فرقُ ذلك اليوم بعينه**: عمليّةٌ في الجهاز
 * لم تُسجَّل في فودكس، أو سُجّلت فيه «بطاقة» ودُفعت بغيرها، أو دفعةٌ لم تصل.
 *
 * **ولا يُسمّى الفرقُ ضياعاً**: يُقال «فودكس قبض كذا ووصل البنكَ كذا»، والحكمُ لصاحبه.
 * ودفعاتُ الأيّام الأخيرة قد لا تكتمل (أمريكان إكسبرس تتأخّر أيّاماً) فلا يُحكَم فيها.
 */
import { addDays } from "@/lib/riyadh-time";

/** الرياضُ ثلاثُ ساعاتٍ شرقَ التوقيت العالميّ، بلا توقيتٍ صيفيّ. */
const RIYADH_OFFSET_MS = 3 * 3_600_000;
const HOUR_MS = 3_600_000;
/**
 * نافذةُ البحث عن الإقفال حول منتصف ليل تاريخ الدفعة: ثلاثُ ساعاتٍ قبله إلى ستٍّ بعده.
 * أوسعُ منها يجد «تطابقاً» بالمصادفة بين عمليّات الصباح، فيُخفي فرقاً حقيقيّاً.
 */
const CLOSE_WINDOW_BEFORE_MS = 3 * HOUR_MS;
const CLOSE_WINDOW_AFTER_MS = 6 * HOUR_MS;
/** فرقُ دفعةٍ دون هذا تقريبٌ لا يُقال. */
export const CARD_TOLERANCE_MINOR = 100;
/**
 * وفرقٌ دون هذا «صغير» — يُعرَض ولا يُنبَّه عليه وحده. موضعُ الإقفال يُقدَّر، فعمليّةٌ
 * على حدّه تظهر زائدةً في دفعةٍ وناقصةً في جارتها؛ والشهرُ — حيث تتقاصّ — هو الحكم.
 */
export const CARD_SMALL_MINOR = 100_00;
/** فرقُ الشهر دون هذا لا يُقال. */
export const CARD_MONTH_TOLERANCE_MINOR = 50_00;
/** كم يوماً قبل آخر الكشف تُعدّ الدفعةُ «قد لا تكتمل» — بعضُ الشبكات تودع بعد أيّام. */
export const CARD_RECENT_DAYS = 4;

export interface CardPayment {
  /** لحظةُ الدفع — ملّي ثانية منذ البدء. */
  atMs: number;
  /** سالبٌ لما رُدّ على البطاقة. */
  amountMinor: number;
}

export interface BankBatchDay {
  /** تاريخُ الدفعة كما في وصف البنك (أو يومُ القيمة إن لم يحمله). */
  day: string;
  settlementMinor: number;
  /** الوصفُ لا يحمل تاريخَ الدفعة — نُسبت إلى يوم وصولها، فمقارنتُها تقريب. */
  byValueDate: boolean;
}

export type CardVerdict =
  /** وُجد موضعُ قطعٍ يساوي مبلغَ الدفعة (داخل السماحة). */
  | "AGREES"
  /** فرقٌ صغير — يُعرَض ولا يُنبَّه عليه وحده. */
  | "SMALL_GAP"
  /** فودكس قبض أكثر ممّا وصل. */
  | "BANK_SHORT"
  /** وصل البنكَ أكثر ممّا سجّله فودكس بطاقةً. */
  | "BANK_OVER"
  /** دفعةٌ حديثة قد لا تكون اكتملت في الكشف — لا حكم. */
  | "RECENT";

export interface CardBatchRow {
  /** تاريخُ الدفعة في البنك. */
  day: string;
  bankMinor: number;
  /** بطاقاتُ فودكس في المقطع الذي نُسب إلى هذه الدفعة. */
  foodicsMinor: number;
  /** فودكس − البنك. */
  gapMinor: number;
  /** أوّلُ وآخرُ دفعةِ بطاقةٍ في المقطع — `null` مقطعٌ فارغ. */
  fromMs: number | null;
  toMs: number | null;
  payments: number;
  verdict: CardVerdict;
  approximate: boolean;
}

export interface CardMonth {
  month: string;
  /** دفعاتٌ حُكم فيها — عليها وحدها يُحسَب الفرق. */
  comparedBatches: number;
  /** وكم منها ثبت إلى الهللة. */
  exactBatches: number;
  foodicsMinor: number;
  bankMinor: number;
  gapMinor: number;
  notable: boolean;
}

export interface CardComparison {
  batches: CardBatchRow[];
  months: CardMonth[];
  /** بطاقاتٌ بعد آخر دفعةٍ قوبلت — لم يبلغها الكشفُ بعد. `null` لا شيء. */
  unsettled: { fromMs: number; toMs: number; foodicsMinor: number; payments: number } | null;
}

/** منتصفُ ليل اليوم بتوقيت الرياض، لحظةً. */
function riyadhMidnightMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - RIYADH_OFFSET_MS;
}

/**
 * يقابل دفعاتِ البنك بمقاطع بطاقات فودكس. الأحدثُ أوّلاً.
 *
 * `lastBankDay` آخرُ يومٍ في الكشف: ما قاربه من الدفعات «حديث» لا يُحكَم فيه.
 * و`foodicsUntilMs` حدُّ ما يعرفه فودكس: ليلةٌ بلا بطاقاتٍ داخله صفرٌ بدليل، وخارجه مجهولة.
 * والنتيجةُ لا تتغيّر بترتيب المدخلات — تُرتَّب هنا.
 */
export function compareCardTakings(
  payments: readonly CardPayment[],
  bank: readonly BankBatchDay[],
  lastBankDay: string | null,
  /** آخرُ لحظةٍ قُرئ فودكس حتّاها — ما أُقفل بعدها من دفعاتٍ لا يعرفه فودكس بعد. */
  foodicsUntilMs: number | null = null,
): CardComparison {
  const pays = [...payments].sort((a, b) => a.atMs - b.atMs || a.amountMinor - b.amountMinor);
  const batches = [...bank].sort((a, b) => a.day.localeCompare(b.day));
  if (pays.length === 0 || batches.length === 0) return { batches: [], months: [], unsettled: null };

  /* مجموعٌ تراكميّ: `prefix[i]` مجموعُ أوّل `i` دفعة */
  const prefix = new Array<number>(pays.length + 1).fill(0);
  pays.forEach((p, i) => { prefix[i + 1] = prefix[i] + p.amountMinor; });

  const recentFrom = lastBankDay === null ? null : addDays(lastBankDay, -CARD_RECENT_DAYS);
  const rows: CardBatchRow[] = [];

  /* البداية: ما قبل نافذة أوّل دفعةٍ بيومٍ كامل ليس منها — بِيع قبل أن يبدأ الكشف */
  const firstLo = riyadhMidnightMs(batches[0].day) - 24 * HOUR_MS - CLOSE_WINDOW_BEFORE_MS;
  let start = 0;
  while (start < pays.length && pays[start].atMs < firstLo) start++;

  const firstPayMs = pays[0].atMs;

  for (const b of batches) {
    const midnight = riyadhMidnightMs(b.day);
    const lo = midnight - CLOSE_WINDOW_BEFORE_MS;
    const hi = midnight + CLOSE_WINDOW_AFTER_MS;
    /*
      دفعةٌ أُقفلت قبل أوّل ما قُرئ من فودكس، أو بعد آخره: فودكس **لا يعرف** تلك
      الليلة — لا «لم يقبض شيئاً». فلا صفَّ لها ولا فرق؛ المجهولُ ليس صفراً.
    */
    if (hi < firstPayMs || (foodicsUntilMs !== null && lo > foodicsUntilMs)) continue;

    /*
      موضعُ القطع `e`: بين الدفعة `e − 1` والدفعة `e`. يصحّ إن وقع فراغُ ما بينهما
      على شيءٍ من النافذة: ما قبله لا يتجاوز آخرَها، وما بعده لا يسبق أوّلَها.
    */
    let best = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let e = start; e <= pays.length; e++) {
      if (e > start && pays[e - 1].atMs > hi) break;
      if (e < pays.length && pays[e].atMs < lo) continue;
      const gap = Math.abs(prefix[e] - prefix[start] - b.settlementMinor);
      /* عند التساوي يُؤخَذ الأبكر — ترتيبٌ ثابت */
      if (gap < bestGap) { bestGap = gap; best = e; }
    }
    /* لا موضعَ في النافذة (فودكس لم يبلغها): المقطعُ فارغ والفرقُ كلُّ الدفعة */
    const end = best < 0 ? start : best;
    const foodicsMinor = prefix[end] - prefix[start];
    const gapMinor = foodicsMinor - b.settlementMinor;
    const size = Math.abs(gapMinor);
    const recent = recentFrom !== null && b.day > recentFrom;
    rows.push({
      day: b.day,
      bankMinor: b.settlementMinor,
      foodicsMinor,
      gapMinor,
      fromMs: end > start ? pays[start].atMs : null,
      toMs: end > start ? pays[end - 1].atMs : null,
      payments: end - start,
      approximate: b.byValueDate,
      verdict: recent ? "RECENT" : size <= CARD_TOLERANCE_MINOR ? "AGREES" : size <= CARD_SMALL_MINOR ? "SMALL_GAP" : gapMinor > 0 ? "BANK_SHORT" : "BANK_OVER",
    });
    start = end;
  }

  const byMonth = new Map<string, CardMonth>();
  for (const r of rows) {
    if (r.verdict === "RECENT") continue;
    const month = r.day.slice(0, 7);
    const m = byMonth.get(month) ?? { month, comparedBatches: 0, exactBatches: 0, foodicsMinor: 0, bankMinor: 0, gapMinor: 0, notable: false };
    byMonth.set(month, m);
    m.comparedBatches++;
    if (r.verdict === "AGREES") m.exactBatches++;
    m.foodicsMinor += r.foodicsMinor;
    m.bankMinor += r.bankMinor;
    m.gapMinor += r.gapMinor;
  }
  const months = [...byMonth.values()]
    .map((m) => ({ ...m, notable: Math.abs(m.gapMinor) > CARD_MONTH_TOLERANCE_MINOR }))
    .sort((a, b) => b.month.localeCompare(a.month));

  const unsettled = start < pays.length
    ? { fromMs: pays[start].atMs, toMs: pays[pays.length - 1].atMs, foodicsMinor: prefix[pays.length] - prefix[start], payments: pays.length - start }
    : null;

  return { batches: rows.reverse(), months, unsettled };
}

/* ─────────────────────────── النقدُ ومشروباتُ الموظّفين ─────────────────────────── */

export interface CashMonthInput {
  month: string;
  /** نقدٌ قبضه فودكس، صافياً ممّا رُدّ نقداً. */
  cashMinor: number;
  /** ما قُيّد على «House Account» — مشروباتُ الموظّفين: ليست بيعاً ولا ديناً ولا ضريبةَ عليها. */
  staffDrinksMinor: number;
  /** طرقُ دفعٍ أخرى (بطاقةُ هديّة، طرفٌ ثالث). */
  otherMinor: number;
  /** مجموعُ فروق إقفال الصندوق (المعدود − المتوقَّع). `null` لا صناديقَ مقفلة. */
  tillVarianceMinor: number | null;
  /** واردُ البنك من غير تسويات الشبكة — ما قد يكون إيداعَ نقد. */
  bankOtherCreditsMinor: number;
  /** ما كتبه صاحبُ المقهى نقداً للإقرار — `null` لم يُكتب. */
  typedForVatMinor: number | null;
}

export interface CashMonth extends CashMonthInput {
  /** نقدُ فودكس − وارد البنك غير الشبكة: ما قُبض نقداً ولا أثرَ لإيداعه. */
  notBankedMinor: number;
  /** نقدُ فودكس − ما كُتب للإقرار. `null` لم يُكتب. */
  vatTypedGapMinor: number | null;
}

/** النقدُ لا يُقابَل يوماً بيوم: الإيداعُ يجمع أيّاماً. فالشهرُ وحدتُه، والفرقُ يُعرَض ولا يُسمّى. */
export function summariseCash(months: readonly CashMonthInput[]): CashMonth[] {
  return [...months]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((m) => ({
      ...m,
      notBankedMinor: m.cashMinor - m.bankOtherCreditsMinor,
      vatTypedGapMinor: m.typedForVatMinor === null ? null : m.cashMinor - m.typedForVatMinor,
    }));
}
