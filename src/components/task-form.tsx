"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";
import {
  TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_REPEATS, TASK_REPEAT_LABEL, isTaskPriority, isTaskRepeat, taskProblem,
  type Task, type TaskPriority, type TaskRepeat,
} from "@/lib/tasks";
import { ActionButton, Field, Input, Sheet, toast } from "./ui-client";
import { buttonClass, fieldClass } from "./ui-tokens";

/** اختصاراتُ الموعد القادم — الماضي لا يُعرَض لمهمّة. */
function dayChips() {
  const today = todayInRiyadh();
  return [
    { label: "اليوم", value: today },
    { label: "غداً", value: addDays(today, 1) },
    { label: "بعد أسبوع", value: addDays(today, 7) },
  ];
}

/**
 * نموذجُ المهمّة — يضيف واحدةً أو يعدّل قائمة. يُفتح في لوح، والخطأ بجانب حقله،
 * والخادمُ يعيد الفحص. وما كُتب يبقى إن فشل الحفظ.
 */
export function TaskForm({ existing, defaultDue }: { existing?: Task; defaultDue?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [priority, setPriority] = useState<TaskPriority>(existing?.priority ?? "NORMAL");
  const [dueOn, setDueOn] = useState(existing?.dueOn ?? defaultDue ?? "");
  const [remindOn, setRemindOn] = useState(existing?.remindOn ?? "");
  const [repeat, setRepeat] = useState<TaskRepeat>(existing?.repeat ?? "NONE");
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleError = title.trim().length < 2 ? "اكتب عنوان المهمّة" : null;
  const problem = taskProblem({ dueOn: dueOn || null, remindOn: remindOn || null, repeat });

  async function save(): Promise<boolean> {
    setTried(true);
    setError(null);
    if (titleError || problem) return false;
    const r = await postJson<{ message?: string }>("/api/task", {
      action: existing ? "update" : "create",
      ...(existing ? { id: existing.id } : {}),
      title: title.trim(), note, priority, dueOn: dueOn || null, remindOn: remindOn || null, repeat,
    });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast({ tone: "ok", title: typeof r.data.message === "string" ? r.data.message : "حُفظ" });
    setOpen(false);
    if (!existing) {
      setTitle(""); setNote(""); setPriority("NORMAL"); setDueOn(defaultDue ?? ""); setRemindOn(""); setRepeat("NONE"); setTried(false);
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(existing ? "quiet" : "primary", existing ? "sm" : "md")}>
        {existing ? <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> : <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />}
        {existing ? "تعديل" : "مهمّة جديدة"}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={existing ? `تعديل «${existing.title}»` : "مهمّة جديدة"}
        description="اكتب ما يجب فعله، وحدّد موعده إن كان له موعد. وإن أردت أن يُذكَّر بها قبل الموعد فاختر يوم التذكير."
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("quiet")}>إلغاء</button>
            <ActionButton onAction={save} variant="primary">احفظ</ActionButton>
          </>
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="ما المطلوب؟" required error={tried ? titleError : null}>
              {({ invalid, ...p }) => <Input {...p} invalid={invalid} value={title} maxLength={160} autoFocus onChange={(e) => setTitle(e.target.value)} />}
            </Field>
          </div>
          <Field label="الموعد" hint="اتركه فارغاً لمهمّة بلا موعد.">
            {({ invalid, ...p }) => (
              <>
                <Input {...p} invalid={invalid} type="date" dir="ltr" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {dayChips().map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      aria-pressed={dueOn === c.value}
                      onClick={() => setDueOn(c.value)}
                      className={`min-h-11 rounded-full border px-2.5 text-[11px] font-bold transition-colors sm:min-h-8 ${
                        dueOn === c.value ? "border-accent-line bg-accent-soft text-accent" : "border-line bg-raised text-ink-soft hover:bg-hover"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </span>
              </>
            )}
          </Field>
          <Field label="ذكّرني في" hint="يظهر في «يحتاج قرارك» وإشعار الصباح من هذا اليوم حتى تُنجَز." error={tried ? problem : null}>
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} type="date" dir="ltr" value={remindOn} onChange={(e) => setRemindOn(e.target.value)} />}
          </Field>
          <Field label="الأهمّية">
            {(p) => (
              <select id={p.id} aria-label="أهمّية المهمّة" value={priority} onChange={(e) => setPriority(isTaskPriority(e.target.value) ? e.target.value : "NORMAL")} className={fieldClass("md", false)}>
                {TASK_PRIORITIES.map((k) => <option key={k} value={k}>{TASK_PRIORITY_LABEL[k]}</option>)}
              </select>
            )}
          </Field>
          <Field label="التكرار" hint="تُنشأ المهمّة التالية حين تُنجز هذه.">
            {(p) => (
              <select id={p.id} aria-label="تكرار المهمّة" value={repeat} onChange={(e) => setRepeat(isTaskRepeat(e.target.value) ? e.target.value : "NONE")} className={fieldClass("md", false)}>
                {TASK_REPEATS.map((k) => <option key={k} value={k}>{TASK_REPEAT_LABEL[k]}</option>)}
              </select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="ملاحظة">
              {({ invalid, ...p }) => <Input {...p} invalid={invalid} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{error}</p>}
      </Sheet>
    </>
  );
}
