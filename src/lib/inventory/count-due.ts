/**
 * جردُ الأسبوع الماضي متأخّر؟ — للمقهى الذي اعتاد الجرد أسبوعيّاً (الأحد إلى السبت).
 *
 * كان جردُ ١٥–٢١ نوفمبر مسوّدةً بعد أربعة أيّام من آخر يومٍ فيه ولا يذكّر به شيء؛ وكلُّ يومٍ يتأخّر
 * يُبعد العدَّ عن يومه فيكبر الفرقُ الذي لا يُفسَّر. فيُقال بعد يومين من نهاية الأسبوع.
 * ولا يُقال لمقهى لا يجرد أسبوعيّاً (جردان مقفلان على الأقلّ في ستّة أسابيع).
 *
 * دالّةٌ خالصة. الأيّامُ نصوص `YYYY-MM-DD` بتوقيت الرياض.
 */
export interface CountRow { status: string; periodStart: string; periodEnd: string }

export interface LateCount { weekStart: string; weekEnd: string; daysLate: number; draft: boolean }

/** يمهَل يومين بعد السبت — العدُّ مساءَ السبت أو صباحَ الأحد عادة. */
export const COUNT_GRACE_DAYS = 2;

export function lateWeeklyCount(today: string, counts: readonly CountRow[], addDays: (d: string, n: number) => string): LateCount | null {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  let weekEnd = addDays(today, -((dow + 1) % 7));
  if (weekEnd === today) weekEnd = addDays(today, -7);
  const weekStart = addDays(weekEnd, -6);
  const daysLate = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${weekEnd}T12:00:00Z`)) / 86_400_000);
  if (daysLate < COUNT_GRACE_DAYS) return null;
  const since = addDays(today, -42);
  const habit = counts.filter((c) => c.status === "FINALISED" && c.periodEnd >= since).length >= 2;
  if (!habit) return null;
  if (counts.some((c) => c.status === "FINALISED" && c.periodEnd === weekEnd)) return null;
  return { weekStart, weekEnd, daysLate, draft: counts.some((c) => c.status !== "FINALISED" && c.periodEnd === weekEnd) };
}
