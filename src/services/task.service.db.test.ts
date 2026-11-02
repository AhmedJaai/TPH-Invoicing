import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { tasks, users } from "@/db/schema";
import { caught, pgErrorOf, withRollback } from "@/test/db";
import { closeTask, createTask, reopenTask, updateTask, type TaskInput } from "./task.service";
import type { Tx } from "./types";

const TODAY = "2099-03-10";
const input = (o: Partial<TaskInput> = {}): TaskInput => ({
  title: "اتصل بمورّد الحليب", note: null, priority: "NORMAL", dueOn: null, remindOn: null, repeat: "NONE", ...o,
});

async function actor(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `task-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

const rows = async (tx: Tx, title: string) =>
  tx.select().from(tasks).where(eq(tasks.title, title)).orderBy(tasks.dueOn);

describe("المهامّ على المخطّط الحقيقيّ", () => {
  it("تُنجَز مرّةً: النقرة الثانية لا تغيّر شيئاً ولا تلد ثانية", () =>
    withRollback(async (tx) => {
      const a = await actor(tx);
      const id = await createTask(input({ title: "t-once", dueOn: TODAY, repeat: "DAILY" }), a, tx);
      const first = await closeTask(id, "DONE", a, TODAY, tx);
      const second = await closeTask(id, "DONE", a, TODAY, tx);
      expect(first).toEqual({ found: true, changed: true, nextDueOn: "2099-03-11" });
      expect(second).toEqual({ found: true, changed: false, nextDueOn: null });
      expect(await rows(tx, "t-once")).toHaveLength(2);
    }));

  it("المكرَّرة تلد تاليتها بتذكيرها، والتراجع يمسح التالية ويعيد الأصل", () =>
    withRollback(async (tx) => {
      const a = await actor(tx);
      const id = await createTask(input({ title: "t-rep", dueOn: TODAY, remindOn: "2099-03-08", repeat: "WEEKLY" }), a, tx);
      await closeTask(id, "DONE", a, TODAY, tx);
      const [open] = (await rows(tx, "t-rep")).filter((r) => !r.closedAt);
      expect(open).toMatchObject({ dueOn: "2099-03-17", remindOn: "2099-03-15", repeat: "WEEKLY" });
      expect(await reopenTask(id, a, tx)).toBe(true);
      const after = await rows(tx, "t-rep");
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ id, closedAt: null, outcome: null, successorId: null });
    }));

  it("الإسقاط لا يلد تالية، والإغلاق يرفض التعديل", () =>
    withRollback(async (tx) => {
      const a = await actor(tx);
      const id = await createTask(input({ title: "t-drop", dueOn: TODAY, repeat: "DAILY" }), a, tx);
      expect(await closeTask(id, "DROPPED", a, TODAY, tx)).toMatchObject({ changed: true, nextDueOn: null });
      expect(await rows(tx, "t-drop")).toHaveLength(1);
      expect(await updateTask(id, input({ title: "t-drop" }), a, tx)).toBe(false);
    }));

  it("غير الموجودة تُقال لا تُخمَّن", () =>
    withRollback(async (tx) => {
      const a = await actor(tx);
      expect(await closeTask("لا-وجود", "DONE", a, TODAY, tx)).toEqual({ found: false });
      expect(await reopenTask("لا-وجود", a, tx)).toBe(false);
    }));

  it("القاعدة ترفض ما يخالف القيد: تكرارٌ بلا موعد، وتذكيرٌ بصيغةٍ فاسدة، وإغلاقٌ بلا سبب", () =>
    withRollback(async (tx) => {
      const a = await actor(tx);
      const insert = (v: Record<string, unknown>) => tx.transaction((t) => t.insert(tasks).values({ title: "t-bad", createdById: a, ...v }));
      expect(pgErrorOf(await caught(insert({ repeat: "DAILY" })))?.message).toMatch(/tasks_repeat_needs_due_check/);
      expect(pgErrorOf(await caught(insert({ remindOn: "غداً" })))?.message).toMatch(/remind_on_check/);
      expect(pgErrorOf(await caught(insert({ closedAt: new Date() })))?.message).toMatch(/tasks_closed_outcome_check/);
      expect(pgErrorOf(await caught(insert({ priority: "URGENT" })))?.message).toMatch(/priority_check/);
    }));

  it("كلّ كتابةٍ في سجلّ التدقيق", () =>
    withRollback(async (tx) => {
      const a = await actor(tx);
      const id = await createTask(input({ title: "t-audit" }), a, tx);
      await closeTask(id, "DONE", a, TODAY, tx);
      const n = Number((await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from audit_logs where entity_type = 'task' and entity_id = ${id}`)).rows[0].n);
      expect(n).toBe(2);
    }));
});
