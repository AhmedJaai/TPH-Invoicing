/**
 * مهمّةٌ أو تذكير — إضافةٌ وتعديلٌ وإنجازٌ وإسقاطٌ وإعادة.
 *
 * لا مالَ هنا. والتواريخُ تُفحص واقعيّتُها («٣٠ فبراير» يُردّ) والتذكيرُ لا يتأخّر عن الموعد؛
 * والإغلاقُ لا يحذف ويُنقَض، وكلُّ كتابةٍ في سجلّ التدقيق.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { TASK_PRIORITIES, TASK_REPEATS, isRealDay, taskProblem } from "@/lib/tasks";
import { closeTask, createTask, reopenTask, updateTask, type TaskInput } from "@/services/task.service";

export const runtime = "nodejs";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "المعرّف غير صالح");
const Day = z.string().refine(isRealDay, "التاريخ غير صالح").nullish();

const Fields = z.object({
  title: z.string().trim().min(2, "اكتب عنوان المهمّة").max(160),
  note: z.string().max(1000).nullish(),
  priority: z.enum(TASK_PRIORITIES).default("NORMAL"),
  dueOn: Day,
  remindOn: Day,
  repeat: z.enum(TASK_REPEATS).default("NONE"),
});

const Body = z.discriminatedUnion("action", [
  Fields.extend({ action: z.literal("create") }),
  Fields.extend({ action: z.literal("update"), id: Id }),
  z.object({ action: z.literal("done"), id: Id }),
  z.object({ action: z.literal("drop"), id: Id }),
  z.object({ action: z.literal("reopen"), id: Id }),
]);

function toInput(f: z.infer<typeof Fields>): TaskInput {
  return {
    title: f.title, note: f.note?.trim() || null, priority: f.priority,
    dueOn: f.dueOn || null, remindOn: f.remindOn || null, repeat: f.repeat,
  };
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("task", "task:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body = read.body;

  try {
    if (body.action === "create" || body.action === "update") {
      const input = toInput(body);
      const problem = taskProblem(input);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      if (body.action === "create") {
        const id = await createTask(input, user.id);
        return NextResponse.json({ ok: true, id, message: `أُضيفت «${input.title}»` });
      }
      const found = await updateTask(body.id, input, user.id);
      if (!found) return NextResponse.json({ error: "المهمّة غير موجودة أو أُغلقت. حدّث الصفحة." }, { status: 404 });
      return NextResponse.json({ ok: true, message: "حُفظ التعديل" });
    }

    if (body.action === "reopen") {
      const found = await reopenTask(body.id, user.id);
      if (!found) return NextResponse.json({ error: "المهمّة غير موجودة. حدّث الصفحة." }, { status: 404 });
      return NextResponse.json({ ok: true, message: "أُعيدت المهمّة" });
    }

    const r = await closeTask(body.id, body.action === "done" ? "DONE" : "DROPPED", user.id);
    if (!r.found) return NextResponse.json({ error: "المهمّة غير موجودة. حدّث الصفحة." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      message: body.action === "drop" ? "أُسقطت المهمّة" : r.nextDueOn ? `أُنجزت، وتتكرّر في ${r.nextDueOn}` : "أُنجزت",
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
