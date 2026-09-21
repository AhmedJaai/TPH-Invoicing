import { redirect } from "next/navigation";
import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { branches, inventoryCounts } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Card, NoAccess, Section, buttonClass } from "@/components/ui";
import { Money } from "@/components/money";
import { StartCount } from "@/components/inventory-actions";
import { InventoryWorkspace } from "@/components/inventory-workspace";
import { listCounts, loadCountHeader, recomputeCount } from "@/services/inventory.service";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { formatBp } from "@/lib/inventory/equation";

export const dynamic = "force-dynamic";

/**
 * «الجرد الحالي» — الشاشةُ التي تُفتَح كلّ أسبوع.
 *
 * وإن كان ثمّة جردٌ مفتوح فهو **هذه الصفحة نفسُها**، لا رابطٌ إليه:
 * من فتح «الجرد الحالي» يريد أن يعدّ، لا أن يقرأ فهرساً.
 */
export default async function InventoryPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory");
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} width="wide" title="الجرد الحالي">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const [open] = await db
    .select({ id: inventoryCounts.id })
    .from(inventoryCounts)
    .where(eq(inventoryCounts.status, "DRAFT"))
    .orderBy(desc(inventoryCounts.periodEnd))
    .limit(1);

  if (open) {
    const header = await loadCountHeader(open.id);
    if (header) {
      const report = await recomputeCount(open.id);
      return (
        <PageShell
          user={user}
          width="wide"
          title="الجرد الحالي"
          intro="ما كان ينبغي أن يبقى على الرفّ، مقابلَ ما وُجد فعلاً."
          actions={<Link href="/inventory/history" className={buttonClass("secondary", "sm")}>سجلّ الجرد</Link>}
        >
          <InventoryWorkspace
            header={header}
            report={report}
            canCount={can(user.role, "inventory:count")}
            canReopen={can(user.role, "inventory:reopen")}
            showAmounts={can(user.role, "amounts:view")}
          />
        </PageShell>
      );
    }
  }

  /* لا جردَ مفتوح — فالشاشةُ تبدأ واحداً، وتُري ما سبق بسطر */
  const branchRows = await db
    .select({ id: branches.id, nameAr: branches.nameAr })
    .from(branches)
    .where(eq(branches.isActive, true))
    .orderBy(asc(branches.nameAr));

  const recent = (await listCounts(3)).filter((c) => c.status === "FINALISED");
  const today = todayInRiyadh();
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);

  const hasSales = (await db.execute<{ n: number }>(sql`select count(*)::int as n from sales`)).rows[0]?.n ?? 0;

  return (
    <PageShell
      user={user}
      width="page"
      title="الجرد الحالي"
      intro="ما كان ينبغي أن يبقى على الرفّ، مقابلَ ما وُجد فعلاً."
    >
      {Number(hasSales) === 0 && (
        <Card tone="warn">
          <p className="text-sm font-bold">لا مبيعاتٍ مستوردة بعد.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            الجردُ يُقابل ما وُجد بما كان ينبغي أن يُستهلَك — وذلك يُحسَب من المبيعات
            ووصفاتها. فابدأ باستيراد ملفّ فودكس.
          </p>
          <Link href="/inventory/import" className={`${buttonClass("primary", "sm")} mt-3`}>
            استورِد مبيعات فودكس
          </Link>
        </Card>
      )}

      <div className="mt-6">
        {can(user.role, "inventory:count") ? (
          <StartCount
            defaultStart={weekAgo}
            defaultEnd={today}
            branches={branchRows.map((b) => ({ id: b.id, name: b.nameAr }))}
          />
        ) : (
          <Card>
            <p className="text-xs text-muted">لا جردَ مفتوحاً الآن، وبدءُ الجرد خارج صلاحيتك.</p>
          </Card>
        )}
      </div>

      {recent.length > 0 && (
        <Section title="آخرُ ما أُقفل" action={<Link href="/inventory/history" className={buttonClass("quiet", "sm")}>السجلّ كلّه</Link>}>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
            {recent.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <Link href={`/inventory/counts/${c.id}`} className="nums min-w-0 flex-1 text-xs font-bold hover:underline">
                  {c.periodStart} → {c.periodEnd}
                </Link>
                <span className="nums text-xs">
                  {c.varianceCostMinor === null ? "—" : <Money minor={c.varianceCostMinor} />}
                </span>
                <span className="nums w-16 text-end text-xs text-muted">{formatBp(c.varianceBp)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageShell>
  );
}
