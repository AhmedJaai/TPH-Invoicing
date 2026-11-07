import { redirect } from "next/navigation";
import Link from "next/link";
import { Archive, EyeOff, Inbox, Lightbulb, MessageCircleWarning, MessageSquareText } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { PostAction } from "@/components/post-action";
import { TeamReplyForm } from "@/components/payroll/team-reply";
import { Badge, EmptyState, NoAccess, Section } from "@/components/ui";
import { formatDay, todayInRiyadh } from "@/lib/riyadh-time";
import { clock12, riyadhClock } from "@/lib/payroll/attendance";
import { TEAM_APP_NAME } from "@/lib/team-app";
import { loadTeamMessages, TEAM_MESSAGE_LABEL, type TeamMessageView } from "@/services/team.service";
import type { TeamMessageKind } from "@/db/schema";

export const dynamic = "force-dynamic";

const ICON: Record<TeamMessageKind, typeof Lightbulb> = { SUGGESTION: Lightbulb, COMPLAINT: MessageCircleWarning, OTHER: MessageSquareText };

/**
 * رسائلُ الفريق — ما أرسله الموظّفون من «TPH Team»: اقتراحٌ أو شكوى أو طلب. الجديدةُ في «يحتاج قرارك»
 * حتى تُقرأ، والردُّ يصل صاحبَ الرسالة في تطبيقه، والمعالَجةُ تُغلَق ولا تُحذف.
 */
export default async function TeamMessagesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/payroll/messages");
  if (!can(user.role, "payroll:view")) {
    return <PageShell user={user} title="رسائل الفريق"><NoAccess what="رسائل الفريق" /></PageShell>;
  }
  const canEdit = can(user.role, "payroll:edit");
  const { open, closed } = await loadTeamMessages();
  const unread = open.filter((m) => m.readAt === null).length;

  return (
    <PageShell user={user} title="رسائل الفريق"
      intro={`ما يرسله الموظفون من تطبيق ${TEAM_APP_NAME}: اقتراح يحسّن العمل، أو شكوى تحتاج حلاً. ردّك يصل صاحب الرسالة في تطبيقه، إلا من أرسل دون اسمه.`}>
      <Section title="مفتوحة" icon={Inbox} count={open.length} hint={unread > 0 ? `${unread} لم تُقرأ بعد. علّمها مقروءة أو رُدّ عليها فتخرج من «يحتاج قرارك».` : undefined}>
        {open.length === 0 ? (
          <EmptyState icon={Inbox} title="لا رسائل مفتوحة." hint={`يرسلها الموظفون من تبويب «رسالة للإدارة» في ${TEAM_APP_NAME}.`}
            action={<Link href="/payroll/attendance" className="text-sm font-bold text-accent hover:underline">روابط الموظفين في الحضور</Link>} />
        ) : (
          <ul className="space-y-3">{open.map((m) => <MessageCard key={m.id} m={m} canEdit={canEdit} />)}</ul>
        )}
      </Section>

      {closed.length > 0 && (
        <Section title="عولجت" icon={Archive} count={closed.length} hint="آخر ما أغلقته. تعيد فتح أي منها إن عادت المشكلة.">
          <ul className="space-y-3">{closed.map((m) => <MessageCard key={m.id} m={m} canEdit={canEdit} />)}</ul>
        </Section>
      )}
    </PageShell>
  );
}

function MessageCard({ m, canEdit }: { m: TeamMessageView; canEdit: boolean }) {
  const Icon = ICON[m.kind];
  const sameDay = todayInRiyadh(m.createdAt) === todayInRiyadh();
  return (
    <li className={`rounded-2xl border bg-raised p-4 shadow-raised ${m.readAt === null && m.closedAt === null ? "border-accent-line" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Icon className={`h-4 w-4 ${m.kind === "COMPLAINT" ? "text-warn" : "text-accent"}`} aria-hidden />{TEAM_MESSAGE_LABEL[m.kind]}
        </span>
        <span className="text-xs text-ink-soft">
          {m.employeeId === null ? <span className="inline-flex items-center gap-1"><EyeOff className="h-3.5 w-3.5" aria-hidden />دون اسم</span>
            : <>من <Link href={`/payroll/employee/${m.employeeId}`} className="font-bold hover:underline">{m.employeeName ?? "موظف"}</Link></>}
          {" · "}{sameDay ? <>اليوم <span className="nums">{clock12(riyadhClock(m.createdAt))}</span></> : formatDay(todayInRiyadh(m.createdAt))}
        </span>
        <span className="ms-auto">
          {m.closedAt ? <Badge tone="ok">عولجت</Badge> : m.reply ? <Badge tone="accent">رددت عليها</Badge> : m.readAt ? <Badge tone="muted">قُرئت</Badge> : <Badge tone="warn">جديدة</Badge>}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{m.body}</p>
      {m.reply && (
        <div className="mt-3 rounded-lg border-s-4 border-accent bg-accent-soft/40 px-3 py-2">
          <p className="text-[11px] font-bold text-accent">ردّك{m.repliedAt && ` · ${formatDay(todayInRiyadh(m.repliedAt))}`}</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{m.reply}</p>
        </div>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {m.closedAt === null && m.employeeId !== null && <TeamReplyForm id={m.id} current={m.reply} />}
          {m.closedAt === null && m.readAt === null && (
            <PostAction url="/api/payroll/messages" body={{ action: "read", id: m.id }} variant="quiet" done="عُلّمت مقروءة">علّمها مقروءة</PostAction>
          )}
          {m.closedAt === null
            ? <PostAction url="/api/payroll/messages" body={{ action: "close", id: m.id }} undo={{ body: { action: "reopen", id: m.id } }} variant="quiet" done="أُغلقت الرسالة">عولجت، أغلقها</PostAction>
            : <PostAction url="/api/payroll/messages" body={{ action: "reopen", id: m.id }} variant="quiet" done="أُعيد فتحها">أعد فتحها</PostAction>}
        </div>
      )}
    </li>
  );
}
