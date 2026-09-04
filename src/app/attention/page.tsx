import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { AttentionList } from "@/components/attention-list";
import { buildAttention, countBySeverity } from "@/lib/attention";
import { gatherAttentionFacts } from "@/lib/attention-facts";

export const dynamic = "force-dynamic";

export default async function AttentionPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "reports:view")) {
    return (
      <PageShell user={user} title="ما يحتاج انتباهك">
        <Empty message="دورك لا يشمل التقارير المالية، فهذه الصفحة محجوبة عنك." />
      </PageShell>
    );
  }

  const items = buildAttention(await gatherAttentionFacts());
  const counts = countBySeverity(items);

  return (
    <PageShell
      user={user}
     
      title="ما يحتاج انتباهك"
      intro="كل الاستثناءات في مكان واحد، مرتّبةً بالأهمّ. ولكلٍّ منها خطوة ومكانٌ يُعالَج فيه."
    >
      {items.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-danger/40 bg-danger-bg px-4 py-3">
            <p className="text-xs text-muted">حرج</p>
            <p className="nums mt-1 text-2xl font-bold text-danger">{counts.CRITICAL}</p>
          </div>
          <div className="rounded-xl border border-warn/40 bg-warn-bg px-4 py-3">
            <p className="text-xs text-muted">عالٍ</p>
            <p className="nums mt-1 text-2xl font-bold text-warn">{counts.HIGH}</p>
          </div>
          <div className="rounded-xl border border-line bg-raised px-4 py-3">
            <p className="text-xs text-muted">متوسّط</p>
            <p className="nums mt-1 text-2xl font-bold">{counts.MEDIUM}</p>
          </div>
        </div>
      )}

      <AttentionList items={items} />
    </PageShell>
  );
}
