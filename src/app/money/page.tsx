import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { HubGrid, type HubTile } from "@/components/hub";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} active="/money" title="المال">
        <Empty message="هذه الصفحة محجوبة عن دورك." />
      </PageShell>
    );
  }

  const [f] = (
    await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from bank_transactions)                            as tx,
        (select count(*)::int from bank_transactions where category='UNKNOWN')   as unclassified,
        (select count(*)::int from bank_imports)                                 as imports,
        (select coalesce(sum(greatest(0, total_minor - coalesce((
            select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
          ),0))),0)::bigint from invoices)                                       as outstanding,
        (select coalesce(sum(vat_minor),0)::bigint from invoices
           where input_vat_status='ELIGIBLE')                                    as recoverable,
        (select coalesce(sum(vat_minor),0)::bigint from invoices
           where input_vat_status='NOT_ELIGIBLE' and vat_minor > 0)              as at_risk,
        (select count(*)::int from invoices where input_vat_status='UNKNOWN')    as vat_unknown,
        (select count(*)::int from payments)                                     as payments
    `)
  ).rows;

  // المصروف حسب تصنيفه — من كشف البنك، وهو الموجود فعلاً
  const byCategory = (
    await db.execute<{ category: string; n: number; s: string }>(sql`
      select category::text as category, count(*)::int as n, sum(amount_minor)::bigint as s
      from bank_transactions
      where direction = 'DEBIT' and category not in ('INTERNAL','UNKNOWN','SUPPLIER')
      group by 1 order by s desc
    `)
  ).rows;

  const tiles: HubTile[] = [
    {
      href: "/bank",
      title: "كشف البنك",
      value: String(f?.tx ?? 0),
      detail:
        Number(f?.unclassified ?? 0) > 0
          ? `${f?.unclassified} حركة لم تُصنَّف — صنّفها مرّة وتسري القاعدة بعدها`
          : `${f?.imports ?? 0} عملية استيراد · كلّها مصنَّفة`,
      tone: Number(f?.unclassified ?? 0) > 0 ? "warn" : "ok",
    },
    {
      href: "/payments",
      title: "المستحقّ للمورّدين",
      amountMinor: Number(f?.outstanding ?? 0),
      detail: `${f?.payments ?? 0} دفعة مسجّلة`,
      tone: Number(f?.outstanding ?? 0) > 0 ? "warn" : "ok",
    },
    {
      href: "/performance",
      title: "ضريبة قابلة للاسترداد",
      amountMinor: Number(f?.recoverable ?? 0),
      detail: "من فواتير ضريبية كاملة",
      tone: "ok",
    },
    {
      href: "/attention",
      title: "ضريبة معرّضة للضياع",
      amountMinor: Number(f?.at_risk ?? 0),
      detail:
        Number(f?.vat_unknown ?? 0) > 0
          ? `و${f?.vat_unknown} فاتورة لم يُقرأ تفصيلها بعد`
          : "من فواتير لا تصلح للخصم",
      tone: Number(f?.at_risk ?? 0) > 0 ? "danger" : "ok",
    },
    {
      href: "/close",
      title: "إقفال الشهر",
      value: "القائمة",
      detail: "قائمة تحقّق تُقرأ قبل أن يُقفل الشهر",
    },
    {
      href: "/money/statement",
      title: "التدفّق النقدي وقائمة الدخل",
      value: "اعرضها",
      detail: "من كشف بنكك وفواتيرك — وما يحتاج مبيعات معروضٌ بسببه لا بصفر",
    },
  ];

  return (
    <PageShell
      user={user}
      active="/money"
      title="المال"
      intro="أين ذهب المال وما بقي عليك — من كشف بنكك وفواتيرك، لا من تقدير."
    >
      <HubGrid tiles={tiles} />

      <section className="mt-10">
        <h2 className="mb-1 text-base font-bold">المصروف حسب نوعه</h2>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          من كشف البنك، بحسب ما صنّفتَه بنفسك. وسداد المورّدين مستثنى — له صفحته.
        </p>
        {byCategory.length === 0 ? (
          <Empty message="لا حركات مصنَّفة بعد. صنّف حركاتك من صفحة كشف البنك." />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
            {byCategory.map((c) => (
              <li key={c.category} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {CATEGORY_LABEL[c.category as TxCategory] ?? c.category}
                  </span>
                  <span className="block text-[11px] text-muted">{c.n} حركة</span>
                </span>
                <span className="shrink-0 text-sm font-bold">
                  <Money minor={Number(c.s)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
