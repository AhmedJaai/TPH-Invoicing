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
import { listCounts, loadCountHeader, loadScope, recomputeCount } from "@/services/inventory.service";
import { loadWorkspaceInputs } from "@/services/inventory-workspace.service";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { lastCompleteWeek } from "@/lib/inventory/week";

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
      const scope = await loadScope(open.id);
      const inputs = await loadWorkspaceInputs(header);
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
            scopeInherited={scope.inherited}
            {...inputs}
            today={todayInRiyadh()}
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
  /* آخرُ أسبوعٍ اكتمل — لا الجاري: الجردُ يقع بعد تقفيلة السبت */
  const week = lastCompleteWeek();

  /*
    ── ثلاثُ خطواتٍ مرتَّبة، لا حالةٌ واحدة ──

    كانت الشاشة تسأل عن المبيعات وحدها، فمن استورد مبيعاته ولا كتالوجَ
    عنده يرى شاشةً هادئةً لا تقول شيئاً — **والجردُ يخرج فارغاً بلا
    سببٍ ظاهر**: لا أصنافَ تُعَدّ، ولا وصفاتٍ تُحسَب بها.

    فتُقرأ الثلاثةُ وتُعرَض بترتيبها: كتالوجٌ يُنشئ الأصناف والوصفات،
    ثمّ مبيعاتٌ تقول ما بِيع، ثمّ جردٌ يُقابلهما.
  */
  const [readiness] = (await db.execute<{ items: number; recipes: number; sales: number }>(sql`
    select (select count(*)::int from products where is_stock_item and is_active) as items,
           (select count(*)::int from recipes) as recipes,
           (select count(*)::int from sales) as sales
  `)).rows;

  const stockItems = Number(readiness?.items ?? 0);
  const recipeCount = Number(readiness?.recipes ?? 0);
  const hasSales = Number(readiness?.sales ?? 0);

  return (
    <PageShell
      user={user}
      width="page"
      title="الجرد الحالي"
      intro="ما كان ينبغي أن يبقى على الرفّ، مقابلَ ما وُجد فعلاً."
    >
      {(recipeCount === 0 || hasSales === 0) && (
        <Card tone="warn">
          <p className="text-sm font-bold">
            {recipeCount === 0
              ? "لا كتالوجَ بعد — ولا وصفةَ واحدة."
              : "الكتالوجُ عندك، ولم تصل المبيعات بعد."}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            الجردُ يُقابل ما وُجد على الرفّ بما كان ينبغي أن يُستهلَك. وذاك يحتاج
            ثلاثةً بترتيبها:
          </p>

          <ol className="mt-3 space-y-2">
            <Step
              done={recipeCount > 0}
              title="ارفع كتالوج فودكس"
              detail={
                recipeCount > 0
                  ? `${stockItems} صنفَ مخزون · ${recipeCount} وصفة`
                  : "ثلاثةُ ملفّات: أصنافُ المخزون، والأصنافُ المباعة، والوصفات — تُنشئ الأصناف والوصفات والربط دفعةً واحدة"
              }
            />
            <Step
              done={hasSales > 0}
              title="ارفع ملفّ المبيعات"
              detail={hasSales > 0 ? `${hasSales} بيعةً مقيَّدة` : "تصديرُ الطلبات من فودكس — وبه يُحسَب ما كان ينبغي أن يُصرَف"}
            />
            <Step done={false} title="ابدأ جردَ الأسبوع" detail="تُدخل العدّ الفعليّ وحده، والباقي محسوب" />
          </ol>

          <Link href="/inventory/import" className={`${buttonClass("primary", "sm")} mt-3`}>
            {recipeCount === 0 ? "ارفع الكتالوج" : "ارفع المبيعات"}
          </Link>
        </Card>
      )}

      <div className="mt-6">
        {can(user.role, "inventory:count") ? (
          <StartCount
            defaultStart={week.start}
            defaultEnd={week.end}
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
                {/* النقصُ والزيادةُ لا يتقاصّان — يُعرضان جنباً إلى جنب */}
                <span className="nums text-xs">
                  نقص <Money minor={c.summary.shortageCostMinor} tone={c.summary.shortageCostMinor > 0 ? "danger" : undefined} />
                </span>
                <span className="nums text-xs text-muted">
                  زيادة <Money minor={c.summary.overageCostMinor} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageShell>
  );
}

/** خطوةٌ في التهيئة — تقول أتمّت أم لا، وبم تمّت. */
function Step({ done, title, detail }: { done: boolean; title: string; detail: string }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className={`mt-0.5 text-xs ${done ? "text-ok" : "text-muted"}`}>
        {done ? "✓" : "○"}
      </span>
      <span className="min-w-0">
        <span className={`text-xs font-bold ${done ? "text-muted line-through" : ""}`}>{title}</span>
        <span className="block text-[11px] leading-relaxed text-muted">{detail}</span>
      </span>
    </li>
  );
}
