import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { AttentionList } from "@/components/attention-list";
import { IMPACT_LABEL, buildAttention, countBySeverity, impactByKind } from "@/lib/attention";
import { Money } from "@/components/money";
import { ITEM, countNoun } from "@/lib/arabic";
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
  const impact = impactByKind(items);

  // تُعرض الأنواع ذات المبلغ وحدها؛ ونوعٌ بلا مبلغ لا يستحقّ بطاقة
  const money = (["RECOVERABLE", "AT_RISK", "ANNUAL", "OWED"] as const)
    .map((kind) => ({ kind, ...(impact[kind] ?? { amountMinor: 0, count: 0 }) }))
    .filter((x) => x.amountMinor > 0);

  return (
    <PageShell
      user={user}
      title="ما يحتاج انتباهك"
      intro="كل الاستثناءات في مكان واحد، مرتّبةً بالأهمّ. ولكلٍّ منها خطوة ومكانٌ يُعالَج فيه."
    >
      {money.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {money.map((m) => (
            <div key={m.kind} className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
              <p className="text-xs text-muted">{IMPACT_LABEL[m.kind]}</p>
              <p className="mt-1.5 text-xl font-bold leading-none">
                <Money minor={m.amountMinor} />
              </p>
              <p className="mt-1.5 text-[11px] text-muted">{countNoun(m.count, ITEM)}</p>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <p className="mb-6 text-xs leading-relaxed text-muted">
          {counts.CRITICAL} حرج · {counts.HIGH} عالٍ · {counts.MEDIUM} متوسّط
          {counts.OPPORTUNITY > 0 && ` · ${counts.OPPORTUNITY} فرصة`}. والمبالغ أعلاه لا
          تُجمع بعضها إلى بعض: ريالٌ قد يُسترد ليس كريالٍ معرَّض للرفض وليس كتقديرٍ سنويّ.
        </p>
      )}

      <AttentionList items={items} limit={3} />
    </PageShell>
  );
}
