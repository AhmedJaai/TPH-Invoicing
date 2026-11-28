/**
 * المهامُ والتذكيرات — قراءتُها وكتابتُها. والحكمُ (متأخّرة؟ ما التالية؟) في `lib/tasks.ts` الخالصة.
 *
 * تُغلَق ولا تُحذف، والإغلاقُ يُنقَض: التراجعُ يعيد المهمّة ويمسح تاليتَها المكرَّرة إن لم
 * يمسّها أحد. والمكرَّرةُ تلد تاليتَها في المعاملة نفسِها فلا تضيع ولا تتكرّر بنقرتين.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks, users } from "@/db/schema";
import type { Conn } from "./types";
import { recordAudit } from "@/lib/audit";
import { pgErrorCode } from "@/lib/pg-error";
import { todayInRiyadh } from "@/lib/riyadh-time";
import {
  isTaskPriority, isTaskRepeat, nextOccurrence, sortTasks, taskLevel, isTaskDue, TASK_REPEAT_LABEL,
  type Task, type TaskLevel,
} from "@/lib/tasks";

type Row = typeof tasks.$inferSelect;

function toTask(r: Row): Task {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    priority: isTaskPriority(r.priority) ? r.priority : "NORMAL",
    dueOn: r.dueOn,
    remindOn: r.remindOn,
    repeat: isTaskRepeat(r.repeat) ? r.repeat : "NONE",
  };
}

/** مَن كتبها — لا إسنادَ في المهامّ، فـ«مهامّي» ما كتبتُه أنا. `null`: لا يُعرف (قديمةٌ أو حسابٌ حُذف). */
export interface TaskAuthor { createdById: string | null; createdBy: string | null }

export interface TasksView {
  open: (Task & TaskAuthor & { level: TaskLevel })[];
  /** آخرُ ما أُغلق — لمن أنجز خطأً، وبمن أغلقها. */
  closed: (Task & TaskAuthor & { outcome: "DONE" | "DROPPED"; closedOn: string; closedById: string | null; closedBy: string | null })[];
}

/** أسماءُ الفريق بمعرّفاتهم — استعلامٌ واحد لكلّ القائمة. والاسمُ الغائب يُكتفى فيه بأوّل البريد. */
async function namesOf(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => x !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name?.trim() || r.email.split("@")[0]]));
}

export async function loadTasks(today = todayInRiyadh()): Promise<TasksView> {
  const [open, closed] = await Promise.all([
    db.select().from(tasks).where(isNull(tasks.closedAt)).orderBy(asc(tasks.dueOn)),
    db.select().from(tasks).where(isNotNull(tasks.closedAt)).orderBy(desc(tasks.closedAt)).limit(15),
  ]);
  const names = await namesOf([...open, ...closed].flatMap((r) => [r.createdById, r.closedById]));
  const author = (r: Row): TaskAuthor => ({ createdById: r.createdById, createdBy: r.createdById ? names.get(r.createdById) ?? null : null });
  return {
    open: sortTasks(open.map((r) => ({ ...toTask(r), ...author(r) })), today).map((t) => ({ ...t, level: taskLevel(t, today) })),
    closed: closed.map((r) => ({
      ...toTask(r),
      ...author(r),
      outcome: r.outcome === "DROPPED" ? "DROPPED" : "DONE",
      closedOn: r.closedAt ? todayInRiyadh(r.closedAt) : "",
      closedById: r.closedById,
      closedBy: r.closedById ? names.get(r.closedById) ?? null : null,
    })),
  };
}

/**
 * ما حلّ اليوم لـ«يحتاج قرارك» وإشعار الصباح. وجدولٌ لم تُطبَّق هجرتُه (`42P01`) يُقرأ
 * «لا مهامّ» لا عطباً — فعدّادُ القشرة يمرّ بكلّ صفحة، ولا تسقط الصفحاتُ لميزةٍ جانبيّة.
 */
export async function loadDueTasks(today = todayInRiyadh()): Promise<(Task & { level: TaskLevel })[]> {
  try {
    const rows = await db.select().from(tasks).where(isNull(tasks.closedAt));
    return sortTasks(rows.map(toTask), today)
      .map((t) => ({ ...t, level: taskLevel(t, today) }))
      .filter((t) => isTaskDue(t.level));
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return [];
    throw e;
  }
}

export interface TaskInput {
  title: string;
  note: string | null;
  priority: Task["priority"];
  dueOn: string | null;
  remindOn: string | null;
  repeat: Task["repeat"];
}

const shape = (t: TaskInput) => ({
  العنوان: t.title, ملاحظة: t.note, الأهمّية: t.priority === "HIGH" ? "مهمّة" : "عادية",
  الموعد: t.dueOn, التذكير: t.remindOn, التكرار: TASK_REPEAT_LABEL[t.repeat],
});

export async function createTask(input: TaskInput, actorId: string, conn: Conn = db): Promise<string> {
  return conn.transaction(async (t) => {
    const [row] = await t.insert(tasks).values({ ...input, createdById: actorId }).returning({ id: tasks.id });
    await recordAudit({ actorId, action: "TASK_SAVED", entityType: "task", entityId: row.id, after: shape(input) }, t);
    return row.id;
  });
}

/** `false` إن لم توجد أو أُغلقت — تعديلُ المغلقة يمرّ بإعادتها أوّلاً. */
export async function updateTask(id: string, input: TaskInput, actorId: string, conn: Conn = db): Promise<boolean> {
  return conn.transaction(async (t) => {
    const [before] = await t.select().from(tasks).where(eq(tasks.id, id)).for("update");
    if (!before || before.closedAt) return false;
    await t.update(tasks).set({ ...input, updatedAt: new Date() }).where(eq(tasks.id, id));
    await recordAudit({ actorId, action: "TASK_SAVED", entityType: "task", entityId: id, before: shape(toTask(before)), after: shape(input) }, t);
    return true;
  });
}

export type CloseResult = { found: false } | { found: true; changed: boolean; nextDueOn: string | null };

/**
 * أنجزها أو أسقطها. المغلقةُ مرّةً لا تُغلَق ثانيةً (نقرتان لا تلدان تاليتين). وإنجازُ
 * المكرَّرة — لا إسقاطُها — يلد تاليتَها؛ فمن أسقطها قال «كفى».
 */
export async function closeTask(id: string, outcome: "DONE" | "DROPPED", actorId: string, today = todayInRiyadh(), conn: Conn = db): Promise<CloseResult> {
  return conn.transaction(async (t) => {
    const [row] = await t.select().from(tasks).where(eq(tasks.id, id)).for("update");
    if (!row) return { found: false };
    if (row.closedAt) return { found: true, changed: false, nextDueOn: null };
    const task = toTask(row);
    const next = outcome === "DONE" ? nextOccurrence(task, today) : null;
    let successorId: string | null = null;
    if (next) {
      const [created] = await t.insert(tasks).values({
        title: task.title, note: task.note, priority: task.priority, repeat: task.repeat,
        dueOn: next.dueOn, remindOn: next.remindOn, createdById: actorId,
      }).returning({ id: tasks.id });
      successorId = created.id;
    }
    await t.update(tasks)
      .set({ closedAt: new Date(), closedById: actorId, outcome, successorId, updatedAt: new Date() })
      .where(eq(tasks.id, id));
    await recordAudit({
      actorId, action: "TASK_CLOSED", entityType: "task", entityId: id,
      after: { العنوان: task.title, الحال: outcome === "DONE" ? "أُنجزت" : "أُسقطت", التالية: next?.dueOn ?? null },
    }, t);
    return { found: true, changed: true, nextDueOn: next?.dueOn ?? null };
  });
}

/** التراجع: تعود مفتوحةً، وتاليتُها المكرَّرة تُمسَح إن بقيت مفتوحةً كما وُلدت. */
export async function reopenTask(id: string, actorId: string, conn: Conn = db): Promise<boolean> {
  return conn.transaction(async (t) => {
    const [row] = await t.select().from(tasks).where(eq(tasks.id, id)).for("update");
    if (!row) return false;
    if (!row.closedAt) return true;
    if (row.successorId) {
      await t.delete(tasks).where(and(eq(tasks.id, row.successorId), isNull(tasks.closedAt)));
    }
    await t.update(tasks)
      .set({ closedAt: null, closedById: null, outcome: null, successorId: null, updatedAt: new Date() })
      .where(eq(tasks.id, id));
    await recordAudit({ actorId, action: "TASK_CLOSED", entityType: "task", entityId: id, after: { العنوان: row.title, الحال: "أُعيدت" } }, t);
    return true;
  });
}
