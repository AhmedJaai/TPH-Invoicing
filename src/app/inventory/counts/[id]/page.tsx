import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { NoAccess } from "@/components/ui";
import { InventoryWorkspace } from "@/components/inventory-workspace";
import { loadCountHeader, readFrozenReport, recomputeCount } from "@/services/inventory.service";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  return (
    <PageShell
      user={user}
      width="wide"
      title="تقرير الجرد"
      intro={`${header.periodStart} → ${header.periodEnd}`}
    >
      <InventoryWorkspace
        header={header}
        report={report}
        canCount={can(user.role, "inventory:count")}
        canReopen={can(user.role, "month:reopen")}
        showAmounts={can(user.role, "amounts:view")}
      />
    </PageShell>
  );
}
