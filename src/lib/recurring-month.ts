/**
 * «هذا الشهر: ما كان متوقَّعاً، وما وصل» — للخصومات المتكرّرة.
 *
 * المتوقَّعُ من مصدرين لا يتكرّر بينهما شيء: المتكرّرُ المسجَّل (`occursIn` في شهره)،
 * وما كشفه الكشفُ ولم يُسجَّل. والوصولُ من مصدرين كذلك: مصروفٌ قُيِّد مربوطاً به هذا
 * الشهر، أو خصمٌ للسلسلة المطابقة في الكشف. والحكمُ على الغائب بآخر يومٍ في الكشف لا
 * بالتقويم: ما موعدُه بعد آخر الكشف «لا يُعرف بعد»، لا «تأخّر». دالّةٌ خالصة.
 */
import { occursIn, type RecurringInput } from "./cash-outlook";
import type { RecurringSeries } from "./recurring-detect";
import { daysInMonth } from "./riyadh-time";

export type MonthStatus = "ARRIVED" | "LATE" | "NOT_SEEN" | "UPCOMING";

export interface MonthRow {
  key: string;
  label: string;
  category: string | null;
  /** المتوقَّعُ بالهللات. */
  expectedMinor: number;
  /** يومُ الاستحقاق في الشهر — `null` غير محدّد. */
  dueDay: string | null;
  status: MonthStatus;
  /** ما وصل فعلاً — يومُه ومبلغُه ومن أين عُرف. */
  arrived: { day: string | null; amountMinor: number; via: "EXPENSE" | "BANK" } | null;
  /** مسجَّلٌ متكرّراً (فيدخل النقدَ القادم) أم مكتشَفٌ من الكشف وحده. */
  registeredId: string | null;
  /** مفتاحُ السلسلة في الكشف إن وُجدت — به تُفتح حركاتُها ويُسكَت تنبيهُها. */
  seriesKey: string | null;
}

export interface MonthWatch {
  month: string;
  rows: MonthRow[];
  expectedMinor: number;
  arrivedMinor: number;
  late: MonthRow[];
  /** آخرُ يومٍ يغطّيه الكشف — `null` بلا كشف. */
  lastBankDay: string | null;
}

export interface MonthWatchInput {
  month: string;
  today: string;
  lastBankDay: string | null;
  registered: readonly RecurringInput[];
  /** مصروفاتُ الشهر المربوطة بمتكرّرٍ مسجَّل. */
  paid: readonly { recurringExpenseId: string; day: string; amountMinor: number }[];
  series: readonly (Pick<RecurringSeries, "key" | "label" | "category" | "usualMinor" | "dayOfMonth" | "charges"> & { registered: { id: string } | null; suggestionSilenced?: boolean })[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * الغائبُ: «تأخّر» إن غطّى الكشفُ موعدَه، و«لم يصل الكشف إليه» إن مضى موعدُه بعد آخر الكشف،
 * و«قادم» إن لم يحن. وبلا يومٍ يُحكم عليه بآخر يومٍ في الشهر.
 */
function statusOf(dueDay: string | null, month: string, today: string, lastBankDay: string | null): MonthStatus {
  const due = dueDay ?? `${month}-${pad(daysInMonth(month))}`;
  if (lastBankDay !== null && due <= lastBankDay) return "LATE";
  return due <= today ? "NOT_SEEN" : "UPCOMING";
}

export function buildMonthWatch(input: MonthWatchInput): MonthWatch {
  const rows: MonthRow[] = [];
  const usedSeries = new Set<string>();
  const inMonth = (day: string) => day.slice(0, 7) === input.month;

  for (const r of input.registered) {
    const o = occursIn(r, input.month);
    if (!o.occurs) continue;
    const dueDay = o.day === null ? null : `${input.month}-${pad(Math.min(o.day, daysInMonth(input.month)))}`;
    const series = input.series.find((s) => s.registered?.id === r.id);
    if (series) usedSeries.add(series.key);
    const expense = input.paid.filter((p) => p.recurringExpenseId === r.id);
    const charges = series?.charges.filter((c) => inMonth(c.day)) ?? [];
    const arrived = expense.length > 0
      ? { day: expense[0].day, amountMinor: expense.reduce((s, p) => s + p.amountMinor, 0), via: "EXPENSE" as const }
      : charges.length > 0
        ? { day: charges[0].day, amountMinor: charges.reduce((s, c) => s + c.amountMinor, 0), via: "BANK" as const }
        : null;
    rows.push({
      key: `rec:${r.id}`, label: r.label, category: r.category ?? null, expectedMinor: r.amountMinor, dueDay,
      status: arrived ? "ARRIVED" : statusOf(dueDay, input.month, input.today, input.lastBankDay),
      arrived, registeredId: r.id, seriesKey: series?.key ?? null,
    });
  }

  for (const s of input.series) {
    if (usedSeries.has(s.key) || s.registered || s.suggestionSilenced) continue;
    const dueDay = `${input.month}-${pad(Math.min(s.dayOfMonth, daysInMonth(input.month)))}`;
    const charges = s.charges.filter((c) => inMonth(c.day));
    const arrived = charges.length > 0 ? { day: charges[0].day, amountMinor: charges.reduce((x, c) => x + c.amountMinor, 0), via: "BANK" as const } : null;
    rows.push({
      key: `ser:${s.key}`, label: s.label, category: s.category, expectedMinor: s.usualMinor, dueDay,
      status: arrived ? "ARRIVED" : statusOf(dueDay, input.month, input.today, input.lastBankDay),
      arrived, registeredId: null, seriesKey: s.key,
    });
  }

  const order: Record<MonthStatus, number> = { LATE: 0, NOT_SEEN: 1, UPCOMING: 2, ARRIVED: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.dueDay ?? "9").localeCompare(b.dueDay ?? "9") || b.expectedMinor - a.expectedMinor);
  return {
    month: input.month,
    rows,
    expectedMinor: rows.reduce((s, r) => s + r.expectedMinor, 0),
    arrivedMinor: rows.reduce((s, r) => s + (r.arrived?.amountMinor ?? 0), 0),
    late: rows.filter((r) => r.status === "LATE"),
    lastBankDay: input.lastBankDay,
  };
}
