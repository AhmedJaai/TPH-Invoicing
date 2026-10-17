/**
 * «أجِّله إلى…» — بندُ الطابور الذي لا يُحسم اليوم يخرج من العدّ ويعود في يومه.
 *
 * كان البندُ مفتوحاً أو محسوماً ولا ثالث؛ فما ينتظر ردَّ مورّدٍ أو آخرَ الشهر يبقى
 * أحمرَ كلَّ صباح، ويتعلّم صاحبُه تجاهلَ القائمة كلِّها. فصار له أن يؤجّله بسببٍ
 * يكتبه — **ولا يُخفى**: المؤجَّلُ يظهر في سطرٍ يُفتح، بيوم عودته وزرّ «أعِده الآن».
 *
 * والمفتاحُ يُشتقّ من البند ومبلغه وعدده: فإن تغيّر ما أُجِّل (حوالةٌ ثانية، فاتورةٌ
 * جديدة) تغيّر المفتاح **وعاد البندُ قبل يومه** — تأجيلُ ما كان لا يُسكت ما استجدّ.
 */
import type { AttentionItem } from "./attention";
import { snoozeDay } from "./signal-decisions";
import { addDays, isoDay } from "@/lib/riyadh-time";

/** أبعدُ تأجيل: شهر — ما يُؤجَّل أبعدَ منه يُنسى، وذلك حسمٌ لا تأجيل. */
export const SNOOZE_MAX_DAYS = 31;

export function snoozeKey(item: Pick<AttentionItem, "id" | "count" | "amountMinor">): string {
  return `attn:${item.id}:${item.amountMinor ?? "-"}:${item.count}`;
}

/** بادئةُ كلّ تأجيلٍ لبندٍ بعينه — للحذف عند «أعِده الآن» مهما كان مبلغُه حين أُجِّل. */
export function snoozePrefix(itemId: string): string {
  return `attn:${itemId}:`;
}

export interface SnoozeRow {
  key: string;
  decision: string;
  note: string | null;
}

export interface SnoozedItem {
  item: AttentionItem;
  /** يومُ العودة `YYYY-MM-DD` — يعود صباحَه. */
  until: string;
  note: string | null;
}

/** المؤجَّلُ صامتٌ حتى اليوم السابق ليوم عودته، ويعود في يومه نفسِه. */
export function partitionSnoozed(
  items: readonly AttentionItem[],
  rows: readonly SnoozeRow[],
  today: string,
): { active: AttentionItem[]; snoozed: SnoozedItem[] } {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const active: AttentionItem[] = [];
  const snoozed: SnoozedItem[] = [];
  for (const item of items) {
    const row = byKey.get(snoozeKey(item));
    const until = row ? snoozeDay(row.decision) : null;
    if (row && until !== null && today < until) snoozed.push({ item, until, note: row.note });
    else active.push(item);
  }
  return { active, snoozed };
}

export function validSnoozeDay(day: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day > today && day <= addDays(today, SNOOZE_MAX_DAYS);
}

/** اختياراتُ التأجيل الجاهزة — غداً، بعد ثلاثة، بعد أسبوع، وأوّلُ الشهر القادم. */
export function snoozeOptions(today: string): { label: string; day: string }[] {
  const [y, m] = today.split("-").map(Number);
  const nextMonth = isoDay(new Date(Date.UTC(y, m, 1)));
  const options = [
    { label: "غداً", day: addDays(today, 1) },
    { label: "بعد ٣ أيام", day: addDays(today, 3) },
    { label: "بعد أسبوع", day: addDays(today, 7) },
    { label: "أول الشهر القادم", day: nextMonth },
  ];
  /* أوّلُ الشهر قد يكون غداً أو بعد ثلاثة — لا يُعرض اليومُ نفسُه مرّتين */
  return options.filter((o, i) => options.findIndex((x) => x.day === o.day) === i && validSnoozeDay(o.day, today));
}
