import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";

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
      <PageShell user={user} active="/suppliers" title="المورّدون">
        <Empty message="لا مورّدين بعد. شغّل npm run db:seed لتأسيس السجل." />
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
      active="/suppliers"
      title="المورّدون"
      intro="سجلّ كل مورّد: بياناته الضريبية، ودورة فوترته، وما فُوتر وما سُدّد، والأسماء البديلة التي يُعرف بها في البنك."
    >
      {needAttention.length > 0 && (
        <div className="mb-6 rounded-xl border border-warn/40 bg-warn-bg p-4">
          <h2 className="text-sm font-bold text-warn">
            {needAttention.length} مورّد يحتاج عقد توريد
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            {needAttention.map((r) => r.nameAr).join(" · ")} — لا يصدرون فواتير ضريبية، وبلا عقد
            مكتوب لا خصم ضريبة ولا إثبات مصروف.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-sunken text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-right font-medium">المورّد</th>
              <th className="px-3 py-2 text-right font-medium">التصنيف</th>
              <th className="px-3 py-2 text-right font-medium">الرقم الضريبي</th>
              <th className="px-3 py-2 text-right font-medium">الفواتير</th>
              {showAmounts && <th className="px-3 py-2 text-right font-medium">المفوتر</th>}
              {showAmounts && <th className="px-3 py-2 text-right font-medium">الرصيد</th>}
              <th className="px-3 py-2 text-right font-medium">الكشوف</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-raised">
            {rows.map((r) => {
              const balance = Number(r.billedMinor) - Number(r.paidMinor);
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{r.nameAr}</p>
                    <p className="font-mono text-[11px] text-muted" dir="ltr">
                      {r.slug}
                      {Number(r.aliasCount) > 0 && ` · ${r.aliasCount} اسم بديل`}
                    </p>
                    {!r.issuesInvoices && (
                      <span className="mt-1 inline-block rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-bold text-warn">
                        بلا فواتير
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-soft">{CATEGORY[r.category] ?? r.category}</td>
                  <td className="px-3 py-2.5">
                    {r.vatNumber ? (
                      <span className="nums text-xs" dir="ltr">{r.vatNumber}</span>
                    ) : (
                      <span className="text-xs text-warn">ناقص</span>
                    )}
                  </td>
                  <td className="nums px-3 py-2.5">{r.invoiceCount}</td>
                  {showAmounts && (
                    <td className="px-3 py-2.5"><Money minor={Number(r.billedMinor)} /></td>
                  )}
                  {showAmounts && (
                    <td className="px-3 py-2.5 font-medium">
                      <Money minor={balance} tone={balance > 0 ? "warn" : "ok"} />
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    {Number(r.statementCount) > 0 ? (
                      <span className="nums text-xs">{r.statementCount}</span>
                    ) : (
                      <span className="text-xs text-warn">لا كشوف</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!showAmounts && (
        <p className="mt-4 text-xs text-muted">
          الأرقام المالية محجوبة عن دورك — تظهر لك بيانات المورّدين دون مبالغها.
        </p>
      )}
    </PageShell>
  );
}
