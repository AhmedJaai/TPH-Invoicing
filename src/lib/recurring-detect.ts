/**
 * كاشفُ الخصومات المتكرّرة — من كشف البنك وحده.
 *
 * `recurring_expenses` يكتبه الإنسان بيده، فبقي فارغاً وبقي «النقد القادم»
 * بلا إيجارٍ ولا اشتراك. والبنكُ يحمل الجواب: جهةٌ واحدة، مبلغٌ متقارب،
 * كلَّ شهر. فتُقترَح السلسلةُ ويُقرّها صاحبُها بضغطة — **اقتراحٌ لا قيد**:
 * لا يُكتب متكرّرٌ من نفسه.
 *
 * ومن السلسلة نفسها ثلاثُ ملاحظات:
 *   - خُصم مرّتين في شهرٍ واحد (والمعتادُ مرّة)؛
 *   - ارتفع عن عادته بأكثر من ١٠٪ (`MATCH_TOLERANCE_PCT` نفسها)؛
 *   - غاب في شهرٍ يغطّيه الكشف.
 *
 * دالّةٌ خالصة. والحدودُ نسبٌ صحيحة لا كسور.
 */
import { payeeKey } from "./bank/double-paid";
import { MATCH_TOLERANCE_PCT, isExpenseCategory } from "./expenses";
import type { TxCategory } from "./bank/rules";
import { dayNumber, daysInMonth } from "@/lib/riyadh-time";
import { addMonths } from "./filing";

export interface DebitTx {
  id: string;
  /** يومُ القيمة بتوقيت الرياض — YYYY-MM-DD. */
  day: string;
  amountMinor: number;
  category: TxCategory;
  description: string | null;
  beneficiaryRaw: string | null;
}

/** أبوابٌ تتكرّر بطبيعتها مع كلّ عمليّة — رسومٌ لا اشتراكات. */
const FEES: ReadonlySet<TxCategory> = new Set<TxCategory>(["BANK_FEE", "BANK_VAT", "POS_FEE", "POS_VAT", "POS_SETTLEMENT"]);

/** كم شهراً يلزم لتُسمّى سلسلة. */
export const SERIES_MIN_MONTHS = 3;
/** ما دون هذا لا يُقترَح: رسومٌ صغيرة لا تغيّر النقدَ القادم. */
export const SERIES_FLOOR_MINOR = 20_00;
/** فوق كم مثلٍ من العادة لا يُسمّى «ارتفاعاً»: ذاك دفعٌ من نوعٍ آخر (مكافأة، قسطٌ مجمَّع) لا سعرٌ تغيّر. */
const ROSE_MAX_MULTIPLE = 3;
/** الفاصلُ المقبول بين خصمين متتاليين ليُعدّا «شهريّاً». */
const GAP_MIN_DAYS = 24;
const GAP_MAX_DAYS = 38;

export interface SeriesCharge {
  id: string;
  day: string;
  amountMinor: number;
}

export type SeriesNote =
  | { kind: "TWICE"; month: string; extra: SeriesCharge[]; excessMinor: number }
  | { kind: "ROSE"; day: string; fromMinor: number; toMinor: number; diffMinor: number }
  | { kind: "MISSING"; month: string };

export interface RecurringSeries {
  /** مفتاحٌ يُشتقّ من هويّة الجهة — به يُحفظ قرارُ الإنسان. */
  key: string;
  label: string;
  category: TxCategory;
  /** وسيطُ ما سبق آخرَ خصم — «عادتُه». */
  usualMinor: number;
  /** آخرُ خصمٍ كما وقع. */
  lastMinor: number;
  lastDay: string;
  /** يومُ الشهر المعتاد (وسيطُ أيّام الخصم). */
  dayOfMonth: number;
  months: number;
  /** العادةُ × ١٢ — تقديرٌ سنويّ لا مبلغٌ واقع. */
  annualMinor: number;
  charges: SeriesCharge[];
  notes: SeriesNote[];
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function within(amountMinor: number, usualMinor: number): boolean {
  return Math.abs(amountMinor - usualMinor) * 100 <= usualMinor * MATCH_TOLERANCE_PCT;
}

function labelOf(tx: DebitTx): string {
  return tx.beneficiaryRaw?.trim() || (tx.description ?? "").trim().slice(0, 40) || "جهةٌ غير مسمّاة";
}

/** مفتاحُ قرار الإنسان في اقتراحٍ أو ملاحظة — من هويّة الجهة لا من معرّف صفّ. */
export function seriesKey(tx: Pick<DebitTx, "description" | "beneficiaryRaw">): string {
  return payeeKey({
    id: "", valueDate: new Date(0), amountMinor: 0, direction: "DEBIT", category: "",
    description: tx.description, beneficiaryRaw: tx.beneficiaryRaw, operationRef: null,
  });
}

export function suggestionKey(series: Pick<RecurringSeries, "key">): string {
  return `recurring-suggest:${series.key}`;
}

export function noteKey(series: Pick<RecurringSeries, "key">, note: SeriesNote): string {
  const at = note.kind === "ROSE" ? note.day : note.month;
  return `recurring-${note.kind.toLowerCase()}:${series.key}:${at}`;
}

/**
 * يستخرج السلاسلَ الشهريّة من الصادر.
 *
 * السلسلة: جهةٌ واحدة (`payeeKey`)، لها في ثلاثة أشهرٍ على الأقلّ خصمٌ
 * قريبٌ من وسيطها (١٠٪)، وبين خصمين متتاليين منها نحوُ شهر مرّتين على
 * الأقلّ. فجهةٌ يُحوَّل لها كيفما اتّفق ليست اشتراكاً.
 *
 * و`lastBankDay` آخرُ يومٍ في الكشف: «غاب هذا الشهر» لا يُقال إلّا لشهرٍ
 * انقضى في الكشف، وإلّا فالغيابُ غيابُ الكشف لا غيابُ الخصم.
 */
export function detectRecurring(rows: readonly DebitTx[], lastBankDay: string | null): RecurringSeries[] {
  const groups = new Map<string, DebitTx[]>();
  for (const tx of rows) {
    if (!isExpenseCategory(tx.category) || FEES.has(tx.category)) continue;
    if (tx.amountMinor < SERIES_FLOOR_MINOR) continue;
    const key = seriesKey(tx);
    groups.set(key, [...(groups.get(key) ?? []), tx]);
  }

  const out: RecurringSeries[] = [];
  for (const [key, all] of groups) {
    const list = [...all].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
    const overall = median(list.map((t) => t.amountMinor));
    if (overall <= 0) continue;

    /* خصمُ كلّ شهر: الأقربُ إلى الوسيط ممّا هو في حدوده */
    const byMonth = new Map<string, DebitTx[]>();
    for (const tx of list) {
      if (!within(tx.amountMinor, overall) && tx.amountMinor < overall) continue;
      const month = tx.day.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), tx]);
    }
    const primaries: DebitTx[] = [];
    for (const month of [...byMonth.keys()].sort()) {
      const inMonth = byMonth.get(month) ?? [];
      const close = inMonth.filter((t) => within(t.amountMinor, overall));
      const pick = (close.length > 0 ? close : inMonth)
        .slice()
        .sort((a, b) => Math.abs(a.amountMinor - overall) - Math.abs(b.amountMinor - overall) || a.day.localeCompare(b.day))[0];
      if (pick) primaries.push(pick);
    }
    const regular = primaries.filter((t) => within(t.amountMinor, overall));
    if (regular.length < SERIES_MIN_MONTHS) continue;

    let monthlyGaps = 0;
    for (let i = 1; i < primaries.length; i++) {
      const gap = dayNumber(primaries[i].day) - dayNumber(primaries[i - 1].day);
      if (gap >= GAP_MIN_DAYS && gap <= GAP_MAX_DAYS) monthlyGaps++;
    }
    if (monthlyGaps < SERIES_MIN_MONTHS - 1) continue;

    const last = primaries[primaries.length - 1];
    const before = primaries.slice(0, -1).filter((t) => within(t.amountMinor, overall));
    const usualMinor = before.length > 0 ? median(before.map((t) => t.amountMinor)) : overall;
    const notes: SeriesNote[] = [];

    /* ارتفع: آخرُ خصمٍ فوق عادته بأكثر من الحدّ */
    if (last.amountMinor > usualMinor && !within(last.amountMinor, usualMinor) && last.amountMinor <= usualMinor * ROSE_MAX_MULTIPLE) {
      notes.push({ kind: "ROSE", day: last.day, fromMinor: usualMinor, toMinor: last.amountMinor, diffMinor: last.amountMinor - usualMinor });
    }

    /* مرّتين: في شهر آخر خصمٍ أكثرُ من خصمٍ في حدود العادة — وما قبله مرّةٌ في الشهر */
    const lastMonth = last.day.slice(0, 7);
    const sameMonth = (byMonth.get(lastMonth) ?? []).filter((t) => t.id !== last.id && within(t.amountMinor, usualMinor));
    const usuallyOnce = [...byMonth.entries()]
      .filter(([m]) => m !== lastMonth)
      .every(([, txs]) => txs.filter((t) => within(t.amountMinor, usualMinor)).length <= 1);
    if (sameMonth.length > 0 && usuallyOnce) {
      notes.push({
        kind: "TWICE",
        month: lastMonth,
        extra: sameMonth.map((t) => ({ id: t.id, day: t.day, amountMinor: t.amountMinor })),
        excessMinor: sameMonth.reduce((s, t) => s + t.amountMinor, 0),
      });
    }

    /* غاب: الشهرُ التالي لآخر خصمٍ انقضى كلُّه في الكشف ولا خصمَ فيه */
    if (lastBankDay) {
      const next = addMonths(lastMonth, 1);
      if (lastBankDay.slice(0, 7) > next) notes.push({ kind: "MISSING", month: next });
    }

    const days = regular.map((t) => Number(t.day.slice(8, 10)));
    out.push({
      key,
      label: labelOf(last),
      category: last.category,
      usualMinor,
      lastMinor: last.amountMinor,
      lastDay: last.day,
      dayOfMonth: median(days),
      months: regular.length,
      annualMinor: usualMinor * 12,
      charges: primaries.map((t) => ({ id: t.id, day: t.day, amountMinor: t.amountMinor })),
      notes,
    });
  }

  return out.sort((a, b) => b.usualMinor - a.usualMinor || a.key.localeCompare(b.key));
}

export interface RegisteredRecurring {
  id: string;
  label: string;
  category: TxCategory;
  /** حصّةُ الشهر بالهللات. */
  monthlyMinor: number;
}

/**
 * المتكرّرُ المسجَّل الذي يقابل السلسلة — البابُ نفسُه والمبلغُ في حدود ١٠٪،
 * كشرط `matchRecurring`. و`null` «لم يُسجَّل بعد» فيُقترَح.
 */
export function registeredFor(
  series: Pick<RecurringSeries, "category" | "usualMinor">,
  registered: readonly RegisteredRecurring[],
): RegisteredRecurring | null {
  const close = registered
    .filter((r) => r.category === series.category && r.monthlyMinor > 0 && within(series.usualMinor, r.monthlyMinor))
    .sort((a, b) => Math.abs(a.monthlyMinor - series.usualMinor) - Math.abs(b.monthlyMinor - series.usualMinor));
  return close[0] ?? null;
}

/** أوّلُ استحقاقٍ قادمٍ للسلسلة بيومها المعتاد — يُكتب `startsOn` عند إقرارها. */
export function nextDueOn(series: Pick<RecurringSeries, "lastDay" | "dayOfMonth">): string {
  const month = addMonths(series.lastDay.slice(0, 7), 1);
  return `${month}-${String(Math.min(series.dayOfMonth, daysInMonth(month))).padStart(2, "0")}`;
}
