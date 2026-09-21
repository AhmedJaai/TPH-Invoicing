import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Badge, DataTable, EmptyState, NoAccess, buttonClass, type Column } from "@/components/ui";
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

  const rows = await listCounts();

  const columns: readonly Column<CountSummary>[] = [
    {
      key: "period", header: "الفترة", primary: true,
      cell: (r) => (
        <Link href={`/inventory/counts/${r.id}`} className="nums font-bold hover:underline">
          {r.periodStart} → {r.periodEnd}
        </Link>
      ),
    },
    {
      key: "status", header: "الحال",
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={r.status === "FINALISED" ? "ok" : "warn"}>
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
    {
      key: "variance", header: "كلفةُ فرق الجرد", numeric: true,
      cell: (r) => (
        r.varianceCostMinor === null
          ? <span className="text-muted">غير معروف</span>
          : <Money minor={r.varianceCostMinor} tone={r.varianceCostMinor < 0 ? "danger" : undefined} />
      ),
    },
    {
      key: "pct", header: "من المبيعات", numeric: true,
      cell: (r) => <span className="nums">{formatBp(r.varianceBp)}</span>,
    },
    {
      key: "items", header: "أصنافٌ عُدّت", numeric: true, secondary: true,
      cell: (r) => <span className="nums">{r.itemsCounted}</span>,
    },
  ];

  return (
    <PageShell
      user={user}
      width="wide"
      title="سجلّ الجرد"
      intro="كلُّ جردٍ مقفَل يبقى كما أُقفل — لا تغيّره وصفةٌ تُعدَّل بعده ولا فاتورةٌ تصل."
      actions={<Link href="/inventory/trend" className={buttonClass("secondary", "sm")}>الاتّجاه</Link>}
    >
      <DataTable
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        hrefOf={(r) => `/inventory/counts/${r.id}`}
        empty={
          <EmptyState
            title="لا جردَ مسجَّل بعد."
            hint="يمتلئ حين تُقفل أوّل جردٍ أسبوعيّ."
            action={<Link href="/inventory" className={buttonClass("primary", "sm")}>ابدأ جرداً جديداً</Link>}
          />
        }
      />
    </PageShell>
  );
}
