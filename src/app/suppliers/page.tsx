import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, DataTable, EmptyState, LinkButton } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const showAmounts = can(user.role, "amounts:view");

  const rows = await db
    .select({
      id: suppliers.id,
      slug: suppliers.slug,
      nameAr: suppliers.nameAr,
      driveFolderName: suppliers.driveFolderName,
      vatNumber: suppliers.vatNumber,
      category: suppliers.category,
      billingCycle: suppliers.billingCycle,
      issuesInvoices: suppliers.issuesInvoices,
      contractOnFile: suppliers.contractOnFile,
      // الاستعلامات الفرعية تُسمّي أعمدتها بالجدول صراحةً — بدونها يلتبس
      // عمود id بين الجدول الخارجي والداخلي ويرفض Postgres الاستعلام كله.
      invoiceCount: sql<number>`(
        select count(*)::int from invoices i where i.supplier_id = suppliers.id
      )`,
      billedMinor: sql<number>`(
        select coalesce(sum(i.total_minor), 0)::int from invoices i where i.supplier_id = suppliers.id
      )`,
      paidMinor: sql<number>`(
        select coalesce(sum(pa.amount_minor), 0)::int
        from payment_allocations pa
        join invoices i on i.id = pa.invoice_id
        where i.supplier_id = suppliers.id
      )`,
      statementCount: sql<number>`(
        select count(*)::int from statements st where st.supplier_id = suppliers.id
      )`,
      aliasCount: sql<number>`(
        select count(*)::int from supplier_aliases sa where sa.supplier_id = suppliers.id
      )`,
    })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.nameAr));

  if (rows.length === 0) {
    return (
      <PageShell user={user} width="wide" title="المورّدون">
        <EmptyState
          title="لا مورّدين بعد."
          hint="يُنشَأ المورّد تلقائياً حين تُقرأ أوّل فاتورة منه — أو أضفه بنفسك من الإعدادات."
          action={<LinkButton href="/settings" variant="primary">أضف مورّداً</LinkButton>}
        />
      </PageShell>
    );
  }

  const needAttention = rows.filter((r) => !r.issuesInvoices && !r.contractOnFile);

  const CATEGORY: Record<string, string> = {
    COFFEE: "قهوة", FOOD: "أغذية", PACKAGING: "تغليف", EQUIPMENT: "معدّات",
    WATER: "مياه", UTILITIES: "مرافق", OTHER: "أخرى",
  };

  return (
    <PageShell
      user={user}
     
      title="المورّدون"
      intro="سجلّ كل مورّد: بياناته الضريبية، ودورة فوترته، وما فُوتر وما سُدّد، والأسماء البديلة التي يُعرف بها في البنك."
    >
      {needAttention.length > 0 && (
        <div className="mb-6 rounded-2xl border border-warn/40 bg-warn-bg p-4 shadow-raised sm:p-5">
          <h2 className="text-sm font-bold text-warn">
            {needAttention.length} مورّد يحتاج عقد توريد
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            {needAttention.map((r) => r.nameAr).join(" · ")} — لا يصدرون فواتير ضريبية، وبلا عقد
            مكتوب لا خصم ضريبة ولا إثبات مصروف.
          </p>
        </div>
      )}

      <DataTable
        rows={rows}
        keyOf={(r) => r.id}
        columns={[
          {
            key: "name",
            header: "المورّد",
            primary: true,
            cell: (r) => (
              <span>
                <span className="block font-medium">{r.nameAr}</span>
                <span className="block font-mono text-[11px] text-muted" dir="ltr">
                  {r.slug}
                  {Number(r.aliasCount) > 0 && ` · ${r.aliasCount} اسم بديل`}
                </span>
                {!r.issuesInvoices && (
                  <span className="mt-1 inline-block">
                    <Badge tone="warn">بلا فواتير</Badge>
                  </span>
                )}
              </span>
            ),
          },
          {
            key: "category",
            header: "التصنيف",
            secondary: true,
            cell: (r) => <span className="text-ink-soft">{CATEGORY[r.category] ?? r.category}</span>,
          },
          {
            key: "vat",
            header: "الرقم الضريبي",
            secondary: true,
            cell: (r) =>
              r.vatNumber ? (
                <span className="nums" dir="ltr">{r.vatNumber}</span>
              ) : (
                <span className="text-warn">ناقص</span>
              ),
          },
          {
            key: "invoices",
            header: "الفواتير",
            align: "end",
            cell: (r) => <span className="nums">{r.invoiceCount}</span>,
          },
          ...(showAmounts
            ? [
                {
                  key: "billed",
                  header: "المفوتر",
                  align: "end" as const,
                  cell: (r: (typeof rows)[number]) => <Money minor={Number(r.billedMinor)} />,
                },
                {
                  key: "balance",
                  header: "الرصيد",
                  align: "end" as const,
                  cell: (r: (typeof rows)[number]) => {
                    const balance = Number(r.billedMinor) - Number(r.paidMinor);
                    return (
                      <span className="font-bold">
                        <Money minor={balance} tone={balance > 0 ? "warn" : "ok"} />
                      </span>
                    );
                  },
                },
              ]
            : []),
          {
            key: "statements",
            header: "الكشوف",
            align: "end",
            cell: (r) =>
              Number(r.statementCount) > 0 ? (
                <span className="nums">{r.statementCount}</span>
              ) : (
                <span className="text-warn">لا كشوف</span>
              ),
          },
        ]}
        empty={
          <EmptyState
            title="لا مورّدين بعد."
            hint="يُنشَأ المورّد تلقائياً حين تُقرأ أوّل فاتورة منه، أو أضفه من الإعدادات."
            action={<LinkButton href="/settings" variant="primary">أضف مورّداً</LinkButton>}
          />
        }
      />

      {!showAmounts && (
        <p className="mt-4 text-xs text-muted">
          الأرقام المالية محجوبة عن دورك — تظهر لك بيانات المورّدين دون مبالغها.
        </p>
      )}
    </PageShell>
  );
}
