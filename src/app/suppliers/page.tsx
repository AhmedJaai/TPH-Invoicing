import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import Link from "next/link";
import { Badge, Card, DataTable, EmptyState, LinkButton, Section, buttonClass } from "@/components/ui";
import { SUPPLIER, countNoun, ALIAS, PAYMENT_RECORD } from "@/lib/arabic";
import { buildInvoiceRequest, groupUnbackedBySupplier, splitSupplierCredit } from "@/lib/supplier-requests";
import { loadUnbackedPayments } from "@/services/supplier-followups.service";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ unbacked?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/suppliers");

  const showAmounts = can(user.role, "amounts:view");
  /*
    «دفعاتٌ بلا فاتورة» — القائمة التي يفتحها التنبيه (BTN-110). كان يفتح
    هذا الجدول العامّ فلا يجد صاحب العمل دفعةً واحدة مذكورة.
  */
  const unbackedView = (await searchParams).unbacked === "1";
  const unbackedPayments = unbackedView && showAmounts ? await loadUnbackedPayments() : [];
  const unbackedGroups = groupUnbackedBySupplier(unbackedPayments);

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
        select coalesce(sum(i.total_minor), 0)::bigint from invoices i where i.supplier_id = suppliers.id
      )`,
      /*
        كلُّ ما دُفع له فعلاً — لا ما خُصّص على فواتيره وحده. مالٌ دُفع ولم
        يُخصّص كان لا يُرى، فيبدو المورّد مديناً وقد سُدّد.
      */
      paidMinor: sql<number>`(
        select coalesce(sum(p.amount_minor - p.fee_minor), 0)::bigint
        from payments p
        where p.supplier_id = suppliers.id and p.status not in ('REVERSED', 'VOID')
      )`,
      /* المقدَّمة المعلَنة — وحدها تُسمّى «لك عنده» (SCN-105) */
      advanceMinor: sql<number>`(
        select coalesce(sum(p.amount_minor - p.fee_minor), 0)::bigint
        from payments p
        where p.supplier_id = suppliers.id and p.status = 'ADVANCE'
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
          hint="يُنشَأ المورّد حين تُقرأ أوّل فاتورة منه — أو تختاره «مورّداً جديداً» في شاشة الرفع."
          action={<LinkButton href="/upload" variant="primary">ارفع فاتورته</LinkButton>}
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
      {unbackedView && (
        <div id="unbacked" className="mb-8 scroll-mt-28">
          <Section
            title="دفعاتٌ خرجت بلا فاتورة"
            hint={
              showAmounts
                ? `${countNoun(unbackedPayments.length, PAYMENT_RECORD)} عند ${countNoun(unbackedGroups.filter((g) => g.supplierId).length, SUPPLIER)}. اطلب فاتورة كلٍّ منها — بلا فاتورةٍ ضريبية لا يُخصَم مدخلُها. والمورّد الذي لا يصدر فواتير يُعلَن في ملفّه فيُطلَب منه عقد توريد بدلها.`
                : "المبالغ محجوبة عن دورك."
            }
            action={<LinkButton href="/suppliers" size="sm" variant="quiet">كلّ المورّدين</LinkButton>}
          >
            {showAmounts && unbackedGroups.length === 0 && (
              <p className="text-xs text-ok">لا دفعة بلا فاتورة — كلّ ما دُفع له مستندُه.</p>
            )}
            <ul className="space-y-2.5">
              {unbackedGroups.map((g) => (
                <li
                  key={g.supplierId ?? "none"}
                  id={g.supplierSlug ? `unbacked-${g.supplierSlug}` : undefined}
                  className="scroll-mt-28"
                >
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        {g.supplierSlug ? (
                          <Link href={`/suppliers/${g.supplierSlug}`} className="block text-sm font-bold underline-offset-4 hover:underline">
                            {g.supplierName}
                          </Link>
                        ) : (
                          <span className="block text-sm font-bold">{g.supplierName}</span>
                        )}
                        <span className="block text-[11px] text-muted">
                          {countNoun(g.payments.length, PAYMENT_RECORD)}
                          {g.supplierId ? " بلا فاتورة" : " لم تُعرَف جهتها — افتح حركتها وحدّد مورّدها"}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block text-[11px] text-muted">دفعتَ له بلا فاتورة</span>
                        <span className="nums block text-sm font-bold text-warn"><Money minor={g.totalMinor} /></span>
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1 border-s-2 border-line ps-2.5">
                      {g.payments.map((p) => (
                        <li key={p.paymentId} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="min-w-0 text-muted">
                            <bdi className="nums">{p.paidOn}</bdi> · من أصل <Money minor={p.amountMinor} />
                            {p.bankTransactionId && (
                              <>
                                {" · "}
                                <Link href={`/bank?tx=${p.bankTransactionId}`} className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-0">
                                  حركتها
                                </Link>
                              </>
                            )}
                          </span>
                          <span className="nums font-bold"><Money minor={p.unbackedMinor} /></span>
                        </li>
                      ))}
                    </ul>
                    {g.supplierId && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(buildInvoiceRequest(g))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonClass("primary", "sm")}
                        >
                          اطلب الفاتورة (واتساب)
                        </a>
                        {g.supplierSlug && <LinkButton href={`/suppliers/${g.supplierSlug}`} size="sm">ملفّه</LinkButton>}
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      {needAttention.length > 0 && (
        <div className="mb-6 rounded-2xl border border-warn/40 bg-warn-bg p-4 shadow-raised sm:p-5">
          <h2 className="text-sm font-bold text-warn">
            {countNoun(needAttention.length, SUPPLIER)} يحتاج عقد توريد
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
        hrefOf={(r) => `/suppliers/${r.slug}`}
        columns={[
          {
            key: "name",
            header: "المورّد",
            primary: true,
            cell: (r) => (
              <span>
                {/* الصفّ رابطٌ أصلاً — ورابطٌ داخل رابط يُسقط الترطيب */}
                <span className="block font-medium">{r.nameAr}</span>
                <span className="block text-[11px] text-muted">
                  <bdi className="font-mono">{r.slug}</bdi>
                  {Number(r.aliasCount) > 0 && ` · ${countNoun(Number(r.aliasCount), ALIAS)}`}
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
            numeric: true,
            cell: (r) => <span className="nums">{r.invoiceCount}</span>,
          },
          ...(showAmounts
            ? [
                {
                  key: "billed",
                  header: "المفوتر",
                  numeric: true as const,
                  cell: (r: (typeof rows)[number]) => <Money minor={Number(r.billedMinor)} />,
                },
                {
                  key: "balance",
                  header: "الصافي",
                  numeric: true as const,
                  cell: (r: (typeof rows)[number]) => {
                    /* بعتبة التسوية نفسها التي في supplier-balances — «0.02» هنا و«لا رصيد» في صفحته كانا رقمين لشيءٍ واحد */
                    const raw = Number(r.billedMinor) - Number(r.paidMinor);
                    const balance = Math.abs(raw) <= SETTLED_TOLERANCE_MINOR ? 0 : raw;
                    /*
                      ما دُفع فوق الفواتير ليس ديناً على المورّد بالضرورة — غالبُه
                      فواتير لم تصل. فيُسمّى بما هو، والمقدَّمة المعلَنة وحدها «لك عنده».
                    */
                    const split = splitSupplierCredit(-balance, Number(r.advanceMinor));
                    return balance < 0 ? (
                      <span className="text-xs font-bold">
                        {split.unbackedMinor > 0 && (
                          <span className="block text-warn">
                            دفعتَ له بلا فاتورة: <Money minor={split.unbackedMinor} />
                          </span>
                        )}
                        {split.advanceMinor > 0 && (
                          <span className="block text-ok">
                            لك عنده مقدَّمةً: <Money minor={split.advanceMinor} />
                          </span>
                        )}
                      </span>
                    ) : (
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
            numeric: true,
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
            hint="يُنشَأ المورّد حين تُقرأ أوّل فاتورة منه — أو تختاره «مورّداً جديداً» في شاشة الرفع."
            action={<LinkButton href="/upload" variant="primary">ارفع فاتورته</LinkButton>}
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
