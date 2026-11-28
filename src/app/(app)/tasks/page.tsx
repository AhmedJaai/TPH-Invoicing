import { redirect } from "next/navigation";
import { Archive, CalendarClock, CalendarOff, CircleCheck, ListChecks, Repeat, RotateCcw, TriangleAlert, UserRound, type LucideIcon } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { PostAction } from "@/components/post-action";
import { TaskCheck } from "@/components/task-check";
import { TaskForm } from "@/components/task-form";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { Badge, Callout, EmptyState, LinkTabs, NoAccess, Section, type Tone } from "@/components/ui";
import { countNoun, TASK } from "@/lib/arabic";
import { formatDay, todayInRiyadh } from "@/lib/riyadh-time";
import { TASK_REPEAT_LABEL, describeDue, type TaskLevel } from "@/lib/tasks";
import { loadTasks, type TasksView } from "@/services/task.service";

export const dynamic = "force-dynamic";

type OpenTask = TasksView["open"][number];
type Who = "all" | "mine" | "others";
const asWho = (v: string | undefined): Who => (v === "mine" || v === "others" ? v : "all");

/**
 * المهام والتذكيرات — ما على الفريق فعلُه، المتأخّرُ أوّلاً.
 *
 * رأسُ الصفحة جملةٌ تجيب «ماذا عليّ اليوم؟» (لا ثلاثةُ أصفارٍ كبيرة)، ثمّ الإضافةُ السريعة،
 * ثمّ «كتبتُها · كتبها غيري» — لا إسنادَ في المهامّ، فالكاتبُ هو ما يُعرف. وكلُّ سطرٍ بموعده
 * بلونه (متأخّرة · اليوم · بعد كذا · بلا موعد)، وبكاتبه إن لم يكن أنت. وما حلّ منها يظهر في
 * «يحتاج قرارك» وإشعار الصباح.
 */
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
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
  const [view, q] = await Promise.all([loadTasks(today), searchParams]);

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

  /* «لي» ما كتبتُه — والمجهولُ كاتبُه ليس لأحد، فيبقى في «الكلّ» وحده */
  const mineCount = view.open.filter((t) => t.createdById === user.id).length;
  const othersCount = view.open.filter((t) => t.createdById !== null && t.createdById !== user.id).length;
  const hasOthers = othersCount > 0 || view.closed.some((t) => t.createdById !== null && t.createdById !== user.id);
  const who = hasOthers ? asWho(q.who) : "all";
  const shown = view.open.filter((t) => who === "all" || (who === "mine" ? t.createdById === user.id : t.createdById !== null && t.createdById !== user.id));

  const overdue = shown.filter((t) => t.level === "OVERDUE");
  const todays = shown.filter((t) => t.level === "TODAY" || t.level === "REMINDER");
  const later = shown.filter((t) => t.level === "UPCOMING" || t.level === "UNDATED");
  const answer = headline(overdue, todays, later, today);

  return (
    <PageShell
      user={user}
      width="page"
      title="المهام"
      intro="الضغط على الدائرة يُنجز المهمّة، ويمكنك التراجع من الإشعار."
      actions={canEdit ? <TaskForm /> : undefined}
    >
      <Callout tone={answer.tone} icon={answer.icon} title={answer.title}>{answer.body}</Callout>

      {canEdit && <div className="mt-4"><TaskQuickAdd /></div>}

      {hasOthers && (
        <div className="mt-5">
          <LinkTabs label="مهامّ مَن" items={[
            { href: "/tasks", label: "الكل", count: view.open.length, active: who === "all" },
            { href: "/tasks?who=mine", label: "كتبتُها", count: mineCount, active: who === "mine" },
            { href: "/tasks?who=others", label: "كتبها غيري", count: othersCount, active: who === "others" },
          ]} />
        </div>
      )}

      {shown.length === 0 && view.open.length > 0 && (
        <div className="mt-6">
          <EmptyState compact icon={UserRound} title={who === "mine" ? "لا مهامّ مفتوحة كتبتَها أنت." : "لا مهامّ مفتوحة كتبها غيرك."} hint="الباقي في «الكل»." />
        </div>
      )}

      <TaskSection title="متأخّرة" icon={TriangleAlert} rows={overdue} today={today} canEdit={canEdit} me={user.id} hint="فات موعدها. أنجزها، أو غيّر موعدها، أو أسقطها." />
      <TaskSection title="اليوم وما حلّ تذكيره" icon={CalendarClock} rows={todays} today={today} canEdit={canEdit} me={user.id} />
      <TaskSection title="قادمة وبلا موعد" icon={ListChecks} rows={later} today={today} canEdit={canEdit} me={user.id} hint="تبقى هنا حتى يحلّ موعدها، ثمّ تظهر في «يحتاج قرارك»." />

      {view.open.length === 0 && (
        <p className="mt-8 flex items-center gap-2 text-sm font-bold text-ok">
          <CircleCheck className="h-4 w-4" strokeWidth={2} aria-hidden />أنجزت كلّ ما في القائمة.
        </p>
      )}

      {view.closed.length > 0 && (
        <Section title="أُغلقت مؤخّراً" icon={Archive} count={view.closed.length} hint="آخر ما أُنجز أو أُسقط، وبمن. أعد ما أُغلق خطأً.">
          <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
            {view.closed.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-[13px]">
                <span className="min-w-0 flex-1 basis-56 break-words text-muted">
                  <span dir="auto" className="font-bold line-through decoration-muted/60">{t.title}</span>
                  <span className="ms-2 text-[11px]">
                    {t.outcome === "DONE" ? "أُنجزت" : "أُسقطت"} · <bdi>{formatDay(t.closedOn)}</bdi>
                    {t.closedBy && <> · {t.closedById === user.id ? "أنت" : t.closedBy}</>}
                  </span>
                </span>
                {canEdit && (
                  <PostAction url="/api/task" body={{ action: "reopen", id: t.id }} variant="quiet" done="أُعيدت">
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

/** جوابُ «ماذا عليّ اليوم؟» بجملة — أقدمُ متأخّرةٍ باسمها، لا عددٌ وحده. */
function headline(overdue: OpenTask[], todays: OpenTask[], later: OpenTask[], today: string): { tone: Tone; icon: LucideIcon; title: string; body: string } {
  if (overdue.length > 0) {
    const oldest = overdue[0];
    return {
      tone: "danger", icon: TriangleAlert,
      title: overdue.length === 1 ? "مهمّة واحدة فات موعدها" : `${countNoun(overdue.length, TASK)} فات موعدها`,
      body: `أقدمها «${oldest.title}»${oldest.dueOn ? ` — ${describeDue(oldest.dueOn, today)}` : ""}.${todays.length > 0 ? ` و${countNoun(todays.length, TASK)} تحلّ اليوم.` : ""}`,
    };
  }
  if (todays.length > 0) {
    return {
      tone: "warn", icon: CalendarClock,
      title: todays.length === 1 ? `اليوم: «${todays[0].title}»` : `${countNoun(todays.length, TASK)} تحلّ اليوم`,
      body: todays.length === 1 ? "لا شيء متأخّر." : `أوّلها «${todays[0].title}». لا شيء متأخّر.`,
    };
  }
  const next = later.find((t) => t.dueOn);
  return {
    tone: "ok", icon: CircleCheck,
    title: "لا شيء متأخّر ولا يحلّ اليوم",
    body: later.length === 0 ? "القائمة فارغة." : next?.dueOn ? `التالية «${next.title}» ${describeDue(next.dueOn, today)}.` : `${countNoun(later.length, TASK)} بلا موعد — حدّد لها موعداً ليذكّرك بها النظام.`,
  };
}

const DUE_TONE: Record<TaskLevel, Tone | undefined> = { OVERDUE: "danger", TODAY: "warn", REMINDER: "info", UPCOMING: undefined, UNDATED: undefined };

function TaskSection({ title, icon, rows, today, canEdit, me, hint }: {
  title: string;
  icon: LucideIcon;
  rows: OpenTask[];
  today: string;
  canEdit: boolean;
  me: string;
  hint?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Section title={title} icon={icon} count={rows.length} hint={hint} className="mt-8">
      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
        {rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-start gap-x-2 py-1.5 ps-2 pe-3 sm:flex-nowrap">
            {canEdit ? <TaskCheck id={t.id} title={t.title} /> : <span className="h-11 w-3 shrink-0 sm:h-8" aria-hidden />}
            <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] py-1.5 sm:basis-0">
              <p dir="auto" className="break-words text-[14px] font-bold">
                {t.title}
                {t.priority === "HIGH" && <span className="ms-2 align-middle"><Badge tone="warn">مهمّة</Badge></span>}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                {t.dueOn
                  ? <Badge tone={DUE_TONE[t.level]} dot={t.level === "OVERDUE" || t.level === "TODAY"}>{describeDue(t.dueOn, today)} · <bdi>{formatDay(t.dueOn)}</bdi></Badge>
                  : <span className="inline-flex items-center gap-1"><CalendarOff className="h-3 w-3" strokeWidth={2} aria-hidden />بلا موعد</span>}
                {t.level === "REMINDER" && t.remindOn && <Badge tone="info" dot>تذكير منذ <bdi>{formatDay(t.remindOn)}</bdi></Badge>}
                {t.repeat !== "NONE" && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" strokeWidth={2} aria-hidden />{TASK_REPEAT_LABEL[t.repeat]}</span>}
                {t.createdBy && t.createdById !== me && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" strokeWidth={2} aria-hidden />كتبها {t.createdBy}</span>}
              </p>
              {t.note && <p dir="auto" className="mt-1 line-clamp-3 break-words text-xs text-ink-soft">{t.note}</p>}
            </div>
            {canEdit && (
              /* على الجوّال تحت العنوان لا بجانبه — العنوانُ لا يُعصر عموداً من كلمتين */
              <span className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto sm:pt-1">
                <TaskForm existing={t} />
                <PostAction url="/api/task" body={{ action: "drop", id: t.id }} undo={{ body: { action: "reopen", id: t.id } }} variant="quiet" done="أُسقطت">
                  <Archive className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />أسقط
                </PostAction>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
