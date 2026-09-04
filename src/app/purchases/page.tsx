import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { HubGrid, type HubTile } from "@/components/hub";

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="المشتريات">
        <Empty message="دورك لا يشمل الأرقام المالية، فهذه الصفحة محجوبة عنك." />
      </PageShell>
    );
  }

  const [f] = (
    await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from invoices)                                     as invoices,
        (select coalesce(sum(total_minor),0)::bigint from invoices)              as billed,
        (select count(*)::int from suppliers where is_active)                    as suppliers,
        (select count(distinct normalized_description)::int from invoice_lines)  as items,
        (select count(*)::int from statements)                                   as statements,
        (select count(*)::int from supplier_products)                            as sp_total,
        (select count(*)::int from supplier_products where product_id is not null) as sp_mapped,
        (select count(distinct supplier_id)::int from invoices)                  as active_suppliers,
        (select count(distinct supplier_id)::int from statements)                as with_statements,
        (select coalesce(sum(greatest(0, total_minor - coalesce((
            select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
          ),0))),0)::bigint from invoices)                                       as outstanding,
        (select count(*)::int from invoices where tax_status = 'INVALID')        as not_valid,
        (select count(*)::int from invoices where tax_status = 'UNKNOWN')        as unknown_tax
    `)
  ).rows;

  const missing = Math.max(0, Number(f?.active_suppliers ?? 0) - Number(f?.with_statements ?? 0));

  const tiles: HubTile[] = [
    {
      href: "/documents?kind=TAX_INVOICE",
      title: "الفواتير",
      value: String(f?.invoices ?? 0),
      detail: `بقيمة ${((Number(f?.billed ?? 0)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ريال`,
    },
    {
      href: "/suppliers",
      title: "المورّدون",
      value: String(f?.suppliers ?? 0),
      detail: `${f?.active_suppliers ?? 0} منهم لهم فواتير`,
    },
    {
      href: "/purchases/products",
      title: "الأصناف",
      value: `${f?.sp_mapped ?? 0} / ${f?.sp_total ?? 0}`,
      detail: "مربوطة بصنف معياري — الربط أساس كل تحليل تكلفة لاحق",
      tone: Number(f?.sp_mapped ?? 0) === 0 ? "warn" : undefined,
    },
    {
      href: "/performance",
      title: "الأسعار",
      value: String(f?.items ?? 0),
      detail: "صنفاً تُتبَّع أسعاره عند مورّده",
    },
    {
      href: "/payments",
      title: "المستحقّات",
      amountMinor: Number(f?.outstanding ?? 0),
      detail: "غير مسدَّد للمورّدين",
      tone: Number(f?.outstanding ?? 0) > 0 ? "warn" : "ok",
    },
    {
      href: "/statements",
      title: "كشوف المورّدين",
      value: String(f?.statements ?? 0),
      detail:
        missing > 0
          ? `${missing} مورّداً لم يصل كشفه — الكشف يكشف الفاتورة الضائعة`
          : "كشوف كل المورّدين وصلت",
      tone: missing > 0 ? "warn" : "ok",
    },
    {
      href: "/attention",
      title: "الحالة الضريبية",
      value: `${f?.not_valid ?? 0} / ${f?.unknown_tax ?? 0}`,
      detail: "لا تصلح للخصم / لم تُقرأ بعد — والعلاجان مختلفان",
      tone: Number(f?.not_valid ?? 0) > 0 ? "warn" : undefined,
    },
  ];

  return (
    <PageShell
      user={user}
     
      title="المشتريات"
      intro="ما اشتريتَه ومن اشتريتَه منه وما بقي عليك — وكشوف مورّديك التي تكشف ما لم يصلك."
    >
      <HubGrid tiles={tiles} />
    </PageShell>
  );
}
