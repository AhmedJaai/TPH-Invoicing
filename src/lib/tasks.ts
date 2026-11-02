/**
 * قائمةُ المهام والتذكيرات — الحكمُ الخالص: أيُّ مهمّةٍ متأخّرة؟ ما يحلّ اليوم؟ ماذا يلي
 * المكرَّرة؟ لا قاعدةَ ولا مال. والأيّامُ نصٌّ YYYY-MM-DD بتوقيت الرياض (`today` يُمرَّر).
 *
 * التذكيرُ يوم، لا ساعة: التشغيلُ اليوميّ مرّةٌ في الصباح، فمهمّةٌ «ذكّرني ٣ عصراً» وعدٌ
 * لا يوفيه شيء. والتذكيرُ يظهر في «يحتاج قرارك» من يومه حتى تُغلَق المهمّة.
 */
import { addDays, daysBetween, daysInMonth, isoDay } from "@/lib/riyadh-time";

export const TASK_PRIORITIES = ["NORMAL", "HIGH"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { NORMAL: "عادية", HIGH: "مهمّة" };

export const TASK_REPEATS = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type TaskRepeat = (typeof TASK_REPEATS)[number];
export const TASK_REPEAT_LABEL: Record<TaskRepeat, string> = {
  NONE: "لا تتكرّر", DAILY: "كلّ يوم", WEEKLY: "كلّ أسبوع", MONTHLY: "كلّ شهر",
};

export interface Task {
  id: string;
  title: string;
  note: string | null;
  priority: TaskPriority;
  dueOn: string | null;
  remindOn: string | null;
  repeat: TaskRepeat;
}

export type TaskLevel = "OVERDUE" | "TODAY" | "REMINDER" | "UPCOMING" | "UNDATED";

export const TASK_LEVEL_LABEL: Record<TaskLevel, string> = {
  OVERDUE: "متأخّرة", TODAY: "اليوم", REMINDER: "تذكير", UPCOMING: "قادمة", UNDATED: "بلا موعد",
};

export function isTaskPriority(v: string): v is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(v);
}
export function isTaskRepeat(v: string): v is TaskRepeat {
  return (TASK_REPEATS as readonly string[]).includes(v);
}

/**
 * حالُ المهمّة المفتوحة اليوم. الموعدُ الفائت يغلب، ثمّ اليوم، ثمّ التذكيرُ الذي حلّ
 * (موعدُه بعد اليوم أو بلا موعد)، وما سوى ذلك قادمةٌ أو بلا موعد.
 */
export function taskLevel(t: Pick<Task, "dueOn" | "remindOn">, today: string): TaskLevel {
  if (t.dueOn && t.dueOn < today) return "OVERDUE";
  if (t.dueOn === today) return "TODAY";
  if (t.remindOn && t.remindOn <= today) return "REMINDER";
  return t.dueOn ? "UPCOMING" : "UNDATED";
}

/** ما يستحقّ نظرةَ اليوم: المتأخّر وما يحلّ اليوم وما حلّ تذكيرُه. */
export function isTaskDue(level: TaskLevel): boolean {
  return level === "OVERDUE" || level === "TODAY" || level === "REMINDER";
}

const LEVEL_ORDER: Record<TaskLevel, number> = { OVERDUE: 0, TODAY: 1, REMINDER: 2, UPCOMING: 3, UNDATED: 4 };

/** المتأخّر أوّلاً، ثمّ الأقدمُ موعداً، والمهمُّ قبل العاديّ، ثمّ الاسم — ترتيبٌ ثابت. */
export function sortTasks<T extends Task>(list: readonly T[], today: string): T[] {
  return [...list].sort((a, b) => {
    const la = LEVEL_ORDER[taskLevel(a, today)], lb = LEVEL_ORDER[taskLevel(b, today)];
    if (la !== lb) return la - lb;
    if (a.dueOn !== b.dueOn) return (a.dueOn ?? "9999") < (b.dueOn ?? "9999") ? -1 : 1;
    if (a.priority !== b.priority) return a.priority === "HIGH" ? -1 : 1;
    return a.title.localeCompare(b.title, "ar");
  });
}

/** يومُ الشهر نفسُه في الشهر التالي، ويُقصّ عند آخره (٣١ يناير ← ٢٨ فبراير). */
function addMonth(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const month = `${ny}-${String(nm).padStart(2, "0")}`;
  return `${month}-${String(Math.min(d, daysInMonth(month))).padStart(2, "0")}`;
}

function step(day: string, repeat: Exclude<TaskRepeat, "NONE">): string {
  return repeat === "DAILY" ? addDays(day, 1) : repeat === "WEEKLY" ? addDays(day, 7) : addMonth(day);
}

/**
 * موعدُ المكرَّرة التالية: خطوةٌ من موعدها، وتُكرَّر حتى تتجاوز اليوم — مهمّةٌ تأخّر إنجازُها
 * أسبوعاً لا تلد أخرى متأخّرة سلفاً. والتذكيرُ يُنقَل بالمسافة نفسها قبل الموعد.
 */
export function nextOccurrence(
  t: Pick<Task, "dueOn" | "remindOn" | "repeat">,
  today: string,
): { dueOn: string; remindOn: string | null } | null {
  if (t.repeat === "NONE" || !t.dueOn) return null;
  let due = step(t.dueOn, t.repeat);
  while (due <= today) due = step(due, t.repeat);
  const lead = t.remindOn ? daysBetween(t.remindOn, t.dueOn) : null;
  return { dueOn: due, remindOn: lead !== null && lead > 0 ? addDays(due, -lead) : null };
}

/** «اليوم» · «غداً» · «بعد ٣ أيام» · «متأخّرة يومين» — بلا أرقامٍ سالبة. */
export function describeDue(dueOn: string, today: string): string {
  const left = daysBetween(today, dueOn);
  if (left === 0) return "اليوم";
  if (left === 1) return "غداً";
  if (left === 2) return "بعد يومين";
  if (left > 0) return left <= 10 ? `بعد ${left} أيام` : `بعد ${left} يوماً`;
  const late = -left;
  return late === 1 ? "متأخّرة يوماً" : late === 2 ? "متأخّرة يومين" : late <= 10 ? `متأخّرة ${late} أيام` : `متأخّرة ${late} يوماً`;
}

/** صحّةُ اليوم — يُرفض «٣٠ فبراير». */
export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDay(d) === day;
}

/** ما يصحّ حفظُه: التذكيرُ لا يتأخّر عن الموعد، والتكرارُ يحتاج موعداً. `null` إن صحّ. */
export function taskProblem(t: Pick<Task, "dueOn" | "remindOn" | "repeat">): string | null {
  if (t.dueOn && !isRealDay(t.dueOn)) return "الموعد غير صالح";
  if (t.remindOn && !isRealDay(t.remindOn)) return "يوم التذكير غير صالح";
  if (t.dueOn && t.remindOn && t.remindOn > t.dueOn) return "يوم التذكير يجب أن يسبق الموعد أو يوافقه";
  if (t.repeat !== "NONE" && !t.dueOn) return "المهمّة المتكرّرة تحتاج موعداً";
  return null;
}
