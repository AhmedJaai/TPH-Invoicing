/**
 * «هل يكفي المال حتى آخر الشهر؟ ومتى يضيق؟» — جوابٌ مؤرَّخ من تقويم الالتزامات.
 *
 * يمشي يوماً بيوم من آخر رصيدٍ معروف، ويطرح ما سيخرج بمبلغه المعلوم وحده:
 *   • ما فات موعدُه ولم يُنفَّذ (دفعةُ الشهر الماضي، رواتبُ لم تُحوَّل، إقرارٌ فات) يُطرح «الآن».
 *   • والمتكرّرُ الذي مضى يومُه هذا الشهر ولم يُقيَّد دفعُه لا يُطرح — قد يكون دُفع ولم يُربط
 *     (كما في `buildCashOutlook`)، فيُذكر سبباً لنقص الثقة لا رقماً.
 *   • والمتكرّرُ بلا يوم يُطرح أوّلَ شهره احتياطاً (قد يخرج في أيّ يوم)، ويُقال.
 *   • والمبلغُ المجهول لا يُكتب صفراً: يُعدّ ويُنقص الثقة.
 * والداخلُ غير محسوب، فكلُّ رصيدٍ بعده حدٌّ أدنى. دالّةٌ خالصة: أعدادٌ صحيحة بالهللات.
 */
import type { Commitment, Commitments } from "./commitments";
import { addMonths } from "./filing";
import { daysBetween, monthEndDay } from "./riyadh-time";
import { countNoun, DAY_AGO, EXPENSE, ITEM } from "./arabic";

/** يومٌ يخرج فيه مال — أو «الآن» لما فات موعدُه. */
export interface AnswerDay {
  /** `YYYY-MM-DD`، أو `"now"` لما يُطرح من الرصيد فوراً. */
  day: string;
  items: Commitment[];
  /** ما يخرج بمبلغه المعلوم. */
  outMinor: number;
  /** بنودٌ مبلغُها غير معروف — لا تدخل `outMinor`. */
  unknownCount: number;
  /** الرصيدُ بعد هذا اليوم — `null` إن جُهل الرصيد. */
  afterMinor: number | null;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface CashAnswer {
  balanceMinor: number | null;
  balanceAsOf: string | null;
  /** «الآن» أوّلاً إن وُجد، ثمّ الأيّامُ بترتيبها حتى آخر الأفق. */
  days: AnswerDay[];
  /** الرصيدُ في آخر الشهر الجاري وآخر الذي يليه — `null` إن جُهل الرصيد. */
  monthEnd: { month: string; afterMinor: number | null };
  horizonEnd: { month: string; afterMinor: number | null };
  /** أدنى نقطة يبلغها الرصيد، ويومُها — `null` إن جُهل الرصيد أو لم يخرج شيء. */
  tightest: { day: string; afterMinor: number } | null;
  /** أوّلُ يومٍ ينزل فيه الرصيد تحت الصفر. */
  firstShort: { day: string; shortMinor: number } | null;
  /** أوّلُ يومٍ ينزل فيه تحت الحدّ الأدنى الذي حدّده صاحبُه. */
  firstBelowFloor: { day: string; afterMinor: number } | null;
  confidence: Confidence;
  /** أسبابُ نقص الثقة — تُقال بصوتٍ عالٍ، لا تُخفى خلف رقم. */
  reasons: string[];
  /** متكرّرٌ مضى يومُه هذا الشهر ولم يُقيَّد دفعُه — لم يُطرح. */
  skippedPast: Commitment[];
}

export interface CashAnswerInput {
  commitments: Pick<Commitments, "days" | "undated" | "overdue">;
  today: string;
  balanceMinor: number | null;
  balanceAsOf: string | null;
  withVat: boolean;
  floorMinor: number | null;
}

/** بعد كم يوماً يصير الرصيدُ قديماً ينقص الثقة، وبعد كم يصير ضعيفاً. */
export const BALANCE_FRESH_DAYS = 3;
export const BALANCE_STALE_DAYS = 14;

const unknown = (c: Commitment) => c.amountMinor === null;

export function buildCashAnswer(input: CashAnswerInput): CashAnswer {
  const thisMonth = input.today.slice(0, 7);
  const nextMonth = addMonths(thisMonth, 1);
  const horizon = monthEndDay(nextMonth);
  /* الوثائقُ لا مالَ فيها، والضريبةُ تُستبعد بطلب صاحبها */
  const money = (c: Commitment) => c.kind !== "EXPIRY" && (input.withVat || c.kind !== "VAT");

  const now: Commitment[] = input.commitments.overdue.filter(money);
  const skippedPast: Commitment[] = [];
  const byDay = new Map<string, Commitment[]>();
  const add = (day: string, c: Commitment) => byDay.set(day, [...(byDay.get(day) ?? []), c]);

  for (const d of input.commitments.days) {
    if (d.day > horizon) continue;
    for (const c of d.items.filter(money)) {
      if (d.day >= input.today) add(d.day, c);
      else if (c.kind === "RECURRING") skippedPast.push(c);
      else now.push(c);
    }
  }
  for (const u of input.commitments.undated) {
    if (u.month > nextMonth) continue;
    const items = u.items.filter(money).map((c) => ({ ...c, sub: c.sub ? `${c.sub} · يومه غير محدد` : "يومه غير محدد، فحُسب من أول الشهر احتياطاً" }));
    if (u.month <= thisMonth) now.push(...items);
    else for (const c of items) add(`${u.month}-01`, c);
  }

  const ordered: { day: string; items: Commitment[] }[] = [
    ...(now.length > 0 ? [{ day: "now", items: now }] : []),
    ...[...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => ({ day, items })),
  ];

  let running = input.balanceMinor;
  let tightest: CashAnswer["tightest"] = null;
  let firstShort: CashAnswer["firstShort"] = null;
  let firstBelowFloor: CashAnswer["firstBelowFloor"] = null;
  let monthEndMinor = input.balanceMinor;
  const days: AnswerDay[] = ordered.map(({ day, items }) => {
    const sorted = [...items].sort((a, b) => (b.amountMinor ?? -1) - (a.amountMinor ?? -1));
    const outMinor = sorted.reduce((s, c) => s + Math.max(0, c.amountMinor ?? 0), 0);
    if (running !== null) {
      running -= outMinor;
      if (outMinor > 0 && (tightest === null || running < tightest.afterMinor)) tightest = { day, afterMinor: running };
      if (running < 0 && firstShort === null) firstShort = { day, shortMinor: -running };
      if (input.floorMinor !== null && running < input.floorMinor && firstBelowFloor === null) firstBelowFloor = { day, afterMinor: running };
      if (day === "now" || day.slice(0, 7) <= thisMonth) monthEndMinor = running;
    }
    return { day, items: sorted, outMinor, unknownCount: sorted.filter(unknown).length, afterMinor: running };
  });

  /* ── الثقة: ما يجعل الجوابَ أضعف يُسمّى ── */
  const reasons: string[] = [];
  let level = 0; // 0 عالية · 1 متوسطة · 2 منخفضة
  const lower = (to: number, why: string) => {
    level = Math.max(level, to);
    reasons.push(why);
  };
  if (input.balanceMinor === null) {
    lower(2, "لا يوجد رصيد معروف، فلا يمكن الحكم.");
  } else if (input.balanceAsOf) {
    const age = daysBetween(input.balanceAsOf, input.today);
    if (age > BALANCE_STALE_DAYS) lower(2, `الرصيد من كشف قبل ${countNoun(age, DAY_AGO)}، وما خرج أو دخل بعده غير محسوب.`);
    else if (age > BALANCE_FRESH_DAYS) lower(1, `الرصيد من كشف قبل ${countNoun(age, DAY_AGO)}، وما خرج أو دخل بعده غير محسوب.`);
  } else {
    lower(1, "يوم الرصيد غير معروف.");
  }
  const unknownCount = days.reduce((s, d) => s + d.unknownCount, 0);
  if (unknownCount > 0) lower(2, unknownCount === 1 ? "بند واحد مبلغه غير معروف ولم يُطرح." : `${countNoun(unknownCount, ITEM)} مبالغها غير معروفة ولم تُطرح.`);
  if (skippedPast.length > 0) lower(1, skippedPast.length === 1 ? "مصروف متكرر مضى يومه هذا الشهر ولم يُسجَّل دفعه، فلم يُطرح." : `${countNoun(skippedPast.length, EXPENSE)} متكررة مضى يومها هذا الشهر ولم يُسجَّل دفعها، فلم تُطرح.`);
  if (days.some((d) => d.items.some((c) => c.id === "run:next"))) reasons.push("دفعة المورّدين القادمة من الفواتير المسجّلة حتى اليوم، وتزيد مع كل فاتورة.");
  reasons.push("المال الداخل (المبيعات) غير محسوب، فكل رصيد هنا هو أقل ما يُتوقع.");

  return {
    balanceMinor: input.balanceMinor,
    balanceAsOf: input.balanceAsOf,
    days,
    monthEnd: { month: thisMonth, afterMinor: monthEndMinor },
    horizonEnd: { month: nextMonth, afterMinor: running },
    tightest,
    firstShort,
    firstBelowFloor,
    confidence: level === 0 ? "HIGH" : level === 1 ? "MEDIUM" : "LOW",
    reasons,
    skippedPast,
  };
}
