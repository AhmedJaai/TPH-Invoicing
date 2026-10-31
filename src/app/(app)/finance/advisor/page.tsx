import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { NoAccess } from "@/components/ui";
import { AdvisorWorkspace } from "@/components/advisor-chat";
import { ADVISOR_STARTERS } from "@/lib/advisor/persona";
import { timeAgo } from "@/lib/arabic";
import { listPlan, listThreads, loadThreadMessages } from "@/services/advisor.service";

export const dynamic = "force-dynamic";

/**
 * المستشار — مديرٌ ماليٌّ ومستشارُ نموّ يعرف المقهى من دفاتره، ويكتب مع صاحبه خطّةً
 * يتابعها (أحمد، ٣١ أكتوبر ٢٠٢٦: «موظّفٌ ذكيّ لا صفحةُ أرقام»). المحادثةُ تُحفَظ، والأرقامُ
 * تُوسَم بأصلها. والذكاءُ يصرف رصيداً ويكتب، فبصلاحيّة كتابة المالية.
 */
export default async function AdvisorPage({ searchParams }: { searchParams: Promise<{ t?: string; new?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/advisor");
  if (!can(user.role, "month:close")) {
    return <PageShell user={user} title="المستشار"><NoAccess what="المستشار" /></PageShell>;
  }
  const sp = await searchParams;
  const [threads, plan] = await Promise.all([listThreads(), listPlan()]);
  /* بلا اختيار: آخرُ محادثة — و«جديدة» صفحةٌ فارغة */
  const threadId = sp.new ? null : (sp.t && threads.some((t) => t.id === sp.t) ? sp.t : threads[0]?.id ?? null);
  const messages = threadId ? await loadThreadMessages(threadId) : [];

  return (
    <PageShell user={user} width="wide" title="المستشار" intro="مديرك المالي ومستشار النمو: يعرف المقهى من دفاترك، ويجيب ويدرس ويخطط معك، ويتابع ما اتفقتما عليه.">
      <AdvisorWorkspace
        key={threadId ?? "new"}
        threadId={threadId}
        messages={messages.map((m) => ({ id: m.id, role: m.role, content: m.content, verified: m.verified, tools: m.tools }))}
        threads={threads.map((t) => ({ id: t.id, title: t.title, updatedLabel: timeAgo(t.updatedAt) }))}
        plan={plan.map((p) => ({ id: p.id, title: p.title, detail: p.detail, horizonDays: p.horizonDays, metric: p.metric, status: p.status }))}
        starters={ADVISOR_STARTERS}
      />
    </PageShell>
  );
}
