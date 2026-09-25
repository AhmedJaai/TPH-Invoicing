import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardCheck, TrendingUp } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Badge, DataTable, EmptyState, LinkButton, NoAccess, Section, type Column } from "@/components/ui";
import { VarianceSplit, formatWeek } from "@/components/inventory-ui";
import { loadInventorySetup, setupProgress } from "@/services/inventory-overview.service";
import { Money } from "@/components/money";
import { listCounts, type CountSummary } from "@/services/inventory.service";
import { formatBp } from "@/lib/inventory/equation";
import { READINESS_LABEL } from "@/lib/inventory/coverage";

export const dynamic = "force-dynamic";

/**
 * سجلُّ الجرد — كلُّ أسبوعٍ بسطر.
 *
 * والفرقُ يُعرَض بالريال وبالنسبة معاً: ‏٢٬١٠٠ ريالاً من ‏٧٤٬٢١٠ غيرُها
 * من ‏١٨٬٠٠٠. والرقمُ المطلق وحده يُخيف أو يُطمئن بلا وجه.
 */
export default async function InventoryHistoryPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/history");
  if (!can(user.role, "inventory:view") || !can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="سجلّ الجرد">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const [rows, setup] = await Promise.all([listCounts(), loadInventorySetup()]);
  const latest = rows.find((r) => r.status === "FINALISED") ?? null;
  const progress = setupProgress(setup);

  const columns: readonly Column<CountSummary>[] = [
    {
      key: "period", header: "الفترة", primary: true,
      cell: (r) => (
        <span className="block min-w-0">
          <Link href={`/inventory/counts/${r.id}`} className="font-bold hover:text-accent">
            أسبوع {formatWeek(r.periodStart, r.periodEnd)}
          </Link>
          {r.branchName && <span className="mt-0.5 block text-[11px] font-normal text-muted">{r.branchName}</span>}
        </span>
      ),
    },
    {
      key: "status", header: "الحال",
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={r.status === "FINALISED" ? undefined : "accent"} dot>
            {r.status === "FINALISED" ? "مقفَل" : "مسوّدة"}
          </Badge>
          {r.readiness && r.readiness !== "READY" && (
            <Badge tone={r.readiness === "BLOCKED" ? "danger" : "warn"}>
              {READINESS_LABEL[r.readiness]}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "sales", header: "مبيعاتُ الفترة", numeric: true,
      cell: (r) => (r.salesMinor === null ? <span className="text-muted">غير معروف</span> : <Money minor={r.salesMinor} />),
    },
    /*
      ── النقصُ والزيادةُ عمودان لا عمودٌ صافٍ ──

      نقصٌ بألفٍ وزيادةٌ بألفٍ صافيهما صفر — «لا مشكلة» في أسبوعٍ فيه
      مشكلتان. فالنقصُ أوّلاً، والزيادةُ بجانبه، والصافي ثانويّ.
    */
    {
      key: "shortage", header: "النقص", numeric: true,
      cell: (r) => (
        r.summary.linesMeasured === 0
          ? <span className="text-muted">غير معروف</span>
          : r.summary.linesShort === 0 ? <span className="text-muted">لا نقص</span>
            : <Money minor={r.summary.shortageCostMinor} tone="danger" />
      ),
    },
    {
      key: "overage", header: "الزيادة", numeric: true,
      cell: (r) => (
        r.summary.linesMeasured === 0
          ? <span className="text-muted">غير معروف</span>
          : r.summary.linesOver === 0 ? <span className="text-muted">لا زيادة</span>
            : <span className="text-info"><Money minor={r.summary.overageCostMinor} /></span>
      ),
    },
    {
      key: "rate", header: "النقصُ من الاستهلاك", numeric: true,
      cell: (r) => (
        <span className="nums">
          {r.summary.shortageRateBp === null ? "غير محسوبة" : formatBp(-r.summary.shortageRateBp)}
          {!r.summary.consumptionCostComplete && <span className="text-muted"> *</span>}
        </span>
      ),
    },
    {
      key: "net", header: "الصافي", numeric: true, secondary: true,
      cell: (r) => r.summary.linesMeasured === 0 ? <span className="text-muted">—</span> : <Money minor={r.summary.netCostMinor} />,
    },
    {
      key: "items", header: "أصنافٌ عُدّت", numeric: true, secondary: true,
      cell: (r) => <span className="nums">{r.itemsCounted} من {r.itemsInScope}</span>,
    },
  ];

  return (
    <PageShell
      user={user}
      width="wide"
      title="سجلّ الجرد"
      intro="كلُّ جردٍ مقفَل يبقى كما أُقفل — لا تغيّره وصفةٌ تُعدَّل بعده ولا فاتورةٌ تصل."
      actions={setup.finalised > 0 ? <LinkButton href="/inventory/trend" size="sm" icon={TrendingUp}>الاتّجاه</LinkButton> : undefined}
    >
      {latest && (
        <Section title={`آخرُ جردٍ مقفَل — أسبوع ${formatWeek(latest.periodStart, latest.periodEnd)}`} className="mb-10 mt-0!">
          <VarianceSplit
            shortage={latest.summary.shortageCostMinor}
            overage={latest.summary.overageCostMinor}
            linesShort={latest.summary.linesShort}
            linesOver={latest.summary.linesOver}
            showAmounts
            measured={latest.summary.linesMeasured > 0}
          />
        </Section>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        hrefOf={(r) => `/inventory/counts/${r.id}`}
        searchOf={(r) => `${formatWeek(r.periodStart, r.periodEnd)} ${r.periodStart} ${r.branchName ?? ""}`}
        searchLabel="ابحث بالأسبوع أو الفرع"
        empty={
          <EmptyState
            icon={ClipboardCheck}
            title="لا جردَ في السجلّ بعد."
            hint={setup.openCountId
              ? "عندك جردٌ مفتوح — أكمله وأقفِله فيظهر هنا بأرقامه مجمَّدة."
              : progress.next === "catalog"
                ? "يمتلئ السجلّ بأوّل جردٍ يُقفَل. والطريقُ إليه يبدأ بكتالوج فودكس، ثمّ ملفّ المبيعات، ثمّ العدّ."
                : progress.next === "sales"
                  ? "الكتالوجُ عندك — بقي ملفُّ مبيعات الأسبوع، ثمّ تبدأ أوّلَ جرد."
                  : "كلُّ ما يلزم عندك — ابدأ أوّلَ جردٍ أسبوعيّ وأقفِله، فيظهر هنا."}
            action={
              setup.openCountId ? <LinkButton href="/inventory" variant="primary" size="sm">أكمِل الجرد المفتوح</LinkButton>
                : progress.next === "catalog" ? <LinkButton href="/inventory/import#catalog" variant="primary" size="sm">ارفع كتالوج فودكس</LinkButton>
                  : progress.next === "sales" ? <LinkButton href="/inventory/import#sales" variant="primary" size="sm">ارفع ملفّ المبيعات</LinkButton>
                    : <LinkButton href="/inventory#start" variant="primary" size="sm">ابدأ جرداً</LinkButton>
            }
          />
        }
      />
      {rows.some((r) => !r.summary.consumptionCostComplete) && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          * مقامُ النسبة ناقص: بعضُ الاستهلاك في ذلك الأسبوع لا تُعرَف كلفتُه، فالنسبةُ على ما عُرف وحده.
        </p>
      )}
    </PageShell>
  );
}
