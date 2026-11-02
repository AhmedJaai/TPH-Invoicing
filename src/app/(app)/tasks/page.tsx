import { redirect } from "next/navigation";
import { Archive, CalendarClock, CircleCheck, ListChecks, Repeat, RotateCcw, TriangleAlert, type LucideIcon } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { PostAction } from "@/components/post-action";
import { TaskCheck } from "@/components/task-check";
import { TaskForm } from "@/components/task-form";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { Badge, EmptyState, KeyFigure, NoAccess, Section } from "@/components/ui";
import { formatDay, todayInRiyadh } from "@/lib/riyadh-time";
import { TASK_REPEAT_LABEL, describeDue, type Task, type TaskLevel } from "@/lib/tasks";
import { loadTasks } from "@/services/task.service";

export const dynamic = "force-dynamic";

/**
 * المهام والتذكيرات — ما على الفريق فعلُه، المتأخّرُ أوّلاً.
 *
 * يكتبها الفريقُ بيده، وما حلّ منها (متأخّر · اليوم · تذكيرٌ حلّ) يظهر في «يحتاج قرارك»
 * وإشعار الصباح. ولا يُقال «لا شيء عليك» قبل أن تُكتب مهمّةٌ واحدة.
 */
export default async function TasksPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/tasks");
  if (!can(user.role, "task:view")) {
    return (
      <PageShell user={user} width="wide" title="المهام">
        <NoAccess what="المهام والتذكيرات" />
      </PageShell>
    );
  }

  const canEdit = can(user.role, "task:edit");
  const today = todayInRiyadh();
  const view = await loadTasks(today);
  const overdue = view.open.filter((t) => t.level === "OVERDUE");
  const todays = view.open.filter((t) => t.level === "TODAY" || t.level === "REMINDER");
  const later = view.open.filter((t) => t.level === "UPCOMING" || t.level === "UNDATED");

  if (view.open.length === 0 && view.closed.length === 0) {
    return (
      <PageShell user={user} width="page" title="المهام" intro="ما يجب فعله، ومتى، وتذكيرٌ به قبل أن يفوت.">
        <EmptyState
          icon={ListChecks}
          title="لا مهامّ بعد."
          hint="اكتب أول مهمّة: اتصال بمورّد، أو مراجعة فاتورة، أو شيء تكرّره كلّ أسبوع. وما حلّ موعده يظهر لك في «يحتاج قرارك» وإشعار الصباح."
          action={canEdit ? <TaskForm /> : undefined}
        />
        {canEdit && <div className="mt-6"><TaskQuickAdd /></div>}
      </PageShell>
    );
  }

  return (
    <PageShell
      user={user}
      width="page"
      title="المهام"
      intro="ما يجب فعله، ومتى. الضغط على الدائرة يُنجز المهمّة، ويمكنك التراجع."
      actions={canEdit ? <TaskForm /> : undefined}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={TriangleAlert}
          tone={overdue.length > 0 ? "danger" : "ok"}
          label="متأخّرة"
          value={<span className="nums nums-count">{overdue.length}</span>}
          sub={overdue.length > 0 ? overdue.slice(0, 3).map((t) => t.title).join("، ") : "لا مهمّة فات موعدها."}
        />
        <KeyFigure
          icon={CalendarClock}
          tone={todays.length > 0 ? "warn" : undefined}
          label="اليوم وتذكيراته"
          value={<span className="nums nums-count">{todays.length}</span>}
          sub={todays.length > 0 ? todays.slice(0, 3).map((t) => t.title).join("، ") : "لا شيء يحلّ اليوم."}
        />
        <KeyFigure
          icon={CircleCheck}
          label="قادمة أو بلا موعد"
          value={<span className="nums nums-count">{later.length}</span>}
          sub={later.length > 0 ? "تظهر هنا حتى يحلّ موعدها." : "لا شيء آخر ينتظر."}
        />
      </div>

      {canEdit && <div className="mt-6"><TaskQuickAdd /></div>}

      <TaskSection title="متأخّرة" icon={TriangleAlert} rows={overdue} today={today} canEdit={canEdit} hint="فات موعدها. أنجزها، أو غيّر موعدها، أو أسقطها." />
      <TaskSection title="اليوم وما حلّ تذكيره" icon={CalendarClock} rows={todays} today={today} canEdit={canEdit} />
      <TaskSection title="قادمة وبلا موعد" icon={ListChecks} rows={later} today={today} canEdit={canEdit} />

      {view.open.length === 0 && (
        <p className="mt-8 flex items-center gap-2 text-sm font-bold text-ok">
          <CircleCheck className="h-4 w-4" strokeWidth={2} aria-hidden />أنجزت كلّ ما في القائمة.
        </p>
      )}

      {view.closed.length > 0 && (
        <Section title="أُغلقت مؤخّراً" icon={Archive} count={view.closed.length} hint="آخر ما أُنجز أو أُسقط. أعد ما أُغلق خطأً.">
          <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
            {view.closed.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 truncate text-muted">
                  <span className="font-bold line-through decoration-muted/60">{t.title}</span>
                  <span className="ms-2 text-[11px]">{t.outcome === "DONE" ? "أُنجزت" : "أُسقطت"} · <bdi>{formatDay(t.closedOn)}</bdi></span>
                </span>
                {canEdit && (
                  <PostAction url="/api/task" body={{ action: "reopen", id: t.id }} variant="quiet">
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />أعدها
                  </PostAction>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageShell>
  );
}

function TaskSection({ title, icon, rows, today, canEdit, hint }: {
  title: string;
  icon: LucideIcon;
  rows: (Task & { level: TaskLevel })[];
  today: string;
  canEdit: boolean;
  hint?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Section title={title} icon={icon} count={rows.length} hint={hint} className="mt-8">
      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
        {rows.map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-1.5 ps-2 pe-3">
            {canEdit ? <TaskCheck id={t.id} title={t.title} /> : <span className="h-11 w-3 shrink-0 sm:h-8" aria-hidden />}
            <div className="min-w-0 flex-1 py-1">
              <p dir="auto" className="truncate text-[14px] font-bold">{t.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                {t.dueOn && <span><bdi>{formatDay(t.dueOn)}</bdi> · {describeDue(t.dueOn, today)}</span>}
                {t.level === "REMINDER" && t.remindOn && <Badge tone="info" dot>تذكير منذ <bdi>{formatDay(t.remindOn)}</bdi></Badge>}
                {t.repeat !== "NONE" && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" strokeWidth={2} aria-hidden />{TASK_REPEAT_LABEL[t.repeat]}</span>}
                {t.note && <span dir="auto" className="truncate">{t.note}</span>}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1">
              {t.priority === "HIGH" && <Badge tone="warn">مهمّة</Badge>}
              {t.level === "OVERDUE" && <Badge tone="danger" dot>متأخّرة</Badge>}
              {canEdit && (
                <>
                  <TaskForm existing={t} />
                  <PostAction url="/api/task" body={{ action: "drop", id: t.id }} undo={{ body: { action: "reopen", id: t.id } }} variant="quiet" done="أُسقطت">
                    <Archive className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />أسقط
                  </PostAction>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
