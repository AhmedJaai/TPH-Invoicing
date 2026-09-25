import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { History } from "lucide-react";
import { LinkButton, NoAccess } from "@/components/ui";
import { formatWeek, isStepId } from "@/components/inventory-ui";
import { InventoryWorkspace } from "@/components/inventory-workspace";
import { loadWorkspaceInputs } from "@/services/inventory-workspace.service";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { loadCountHeader, loadScope, readFrozenReport, recomputeCount } from "@/services/inventory.service";

export const dynamic = "force-dynamic";

/**
 * تقريرُ جردٍ بعينه.
 *
 * والمقفَلُ **يُقرأ من أسطره** ولا يُعاد حسابُه: ذاك هو الفرق بين
 * تقريرٍ تاريخيّ واستعلامٍ عن الماضي — الثاني يتغيّر كلّما عُدّلت
 * وصفةٌ أو رُبط صنف.
 */
export default async function CountReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step } = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/login?from=/inventory/counts/${id}`);
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} width="wide" title="تقرير الجرد">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const header = await loadCountHeader(id);
  if (!header) notFound();

  const report = header.status === "FINALISED"
    ? await readFrozenReport(header)
    : await recomputeCount(header.id);
  const [scope, inputs] = await Promise.all([loadScope(header.id), loadWorkspaceInputs(header)]);
  const locked = header.status === "FINALISED";

  return (
    <PageShell
      user={user}
      width="wide"
      title="تقرير الجرد"
      eyebrow={`${locked ? "جردٌ مقفَل" : "جردٌ مفتوح"}${header.branchName ? ` · ${header.branchName}` : ""}`}
      intro={`أسبوع ${formatWeek(header.periodStart, header.periodEnd)}`}
      actions={can(user.role, "amounts:view")
        ? <LinkButton href="/inventory/history" size="sm" icon={History}>سجلّ الجرد</LinkButton>
        : undefined}
    >
      <InventoryWorkspace
        header={header}
        report={report}
        canCount={can(user.role, "inventory:count")}
        canReopen={can(user.role, "inventory:reopen")}
        showAmounts={can(user.role, "amounts:view")}
        scopeInherited={scope.inherited}
        {...inputs}
        today={todayInRiyadh()}
        initialStep={isStepId(step) ? step : null}
      />
    </PageShell>
  );
}
