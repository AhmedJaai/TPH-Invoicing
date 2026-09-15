import { looksLikeGoodsPurchase } from "@/lib/expenses";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { HubGrid, type HubTile } from "@/components/hub";
import { Figure } from "@/components/figure";
import { gatherHomeProvenance } from "@/lib/provenance-facts";
import { loadBalanceTotals } from "@/services/supplier-balance.service";

import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { NoAccess } from "@/components/ui";
import { IMPORT, INVOICE, PAYMENT_RECORD, TRANSACTION, countNoun } from "@/lib/arabic";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/money");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} title="المال">
        <NoAccess />
      </PageShell>
    );
  }

  const prov = await gatherHomeProvenance();

  /* «عليك» بالمورّد: فواتيره المفتوحة ناقصَ رصيدِنا عنده — مصدرٌ واحد */
  const { totals: balanceTotals } = await loadBalanceTotals();
  const owedMinor = balanceTotals.owedMinor;

  const [f] = (
    await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from bank_transactions)                            as tx,
        (select count(*)::int from bank_transactions where category='UNKNOWN')   as unclassified,
        (select count(*)::int from bank_imports)                                 as imports,
        (select coalesce(sum(vat_minor),0)::bigint from invoices
           where input_vat_status='ELIGIBLE')                                    as recoverable,
        (select coalesce(sum(vat_minor),0)::bigint from invoices
           where input_vat_status='NOT_ELIGIBLE' and vat_minor > 0)              as at_risk,
        (select count(*)::int from invoices where input_vat_status='UNKNOWN')    as vat_unknown,
        (select count(*)::int from payments)                                     as payments
    `)
  ).rows;

  // المصروف حسب تصنيفه — من كشف البنك، وهو الموجود فعلاً
  /*
    «شراء بضاعة» يُستبعَد بالدالّة نفسها التي تستبعده في قائمة الدخل.
    كان يُحسب هنا راتباً ويُستبعَد هناك، فللرواتب رقمان في شاشتين.
  */
  const debitRows = (
    await db.execute<{ category: string; amount_minor: string; description: string | null; beneficiary_raw: string | null }>(sql`
      select category::text as category, amount_minor, description, beneficiary_raw
      from bank_transactions
      where direction = 'DEBIT' and category not in ('INTERNAL','UNKNOWN','SUPPLIER','PERSONAL','POS_SETTLEMENT')
    `)
  ).rows;
  const categoryTotals = new Map<string, { category: string; n: number; s: number }>();
  for (const r of debitRows) {
    if (looksLikeGoodsPurchase(r.description ?? "", r.beneficiary_raw)) continue;
    const e = categoryTotals.get(r.category) ?? { category: r.category, n: 0, s: 0 };
    e.n++;
    e.s += Number(r.amount_minor);
    categoryTotals.set(r.category, e);
  }
  const byCategory = [...categoryTotals.values()].sort((a, b) => b.s - a.s);

  const tiles: HubTile[] = [
    {
      href: "/bank",
      title: "حركات كشف البنك",
      value: String(f?.tx ?? 0),
      detail:
        Number(f?.unclassified ?? 0) > 0
          ? `${countNoun(f?.unclassified, TRANSACTION)} لم تُصنَّف — صنّفها مرّة وتسري القاعدة بعدها`
          : `${countNoun(Number(f?.imports ?? 0), IMPORT)} · كلّها مصنَّفة`,
      tone: Number(f?.unclassified ?? 0) > 0 ? "warn" : "ok",
    },
    {
      /*
        الوجهةُ تعرض العدد الذي في البطاقة.

        كانت تفتح «دفعة أوّل الشهر» — وهي تعرض ما جاز تحويلُه من الشهر
        المنقضي وحده (٩٥٦ ريالاً)، لا المستحقّ كلّه (١٨٬١٩٤). فيضغط
        صاحب العمل رقماً ويرى غيرَه ولا يجد تفصيله.

        وصفحةُ الفواتير هي التي تحمل المستحقّ مورّداً مورّداً. **والرقمُ
        الذي لا تفتح وجهتُه تفصيلَه يُفقد الثقة به.**
      */
      href: "/purchases/invoices?paid=OPEN",
      title: "المستحقّ للمورّدين",
      amountMinor: owedMinor,
      detail: `على فواتير لم تُسدَّد · ${countNoun(Number(f?.payments ?? 0), PAYMENT_RECORD)} مسجّلة`,
      tone: owedMinor > 0 ? "warn" : "ok",
    },
    {
      href: "/purchases/invoices?tax=VALID",
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
          ? `و${countNoun(f?.vat_unknown, INVOICE)} لم يُقرأ تفصيلها بعد`
          : "من فواتير لا تصلح للخصم",
      tone: Number(f?.at_risk ?? 0) > 0 ? "danger" : "ok",
    },
    {
      href: "/close",
      title: "إقفال الشهر",
      actionLabel: "افتح القائمة",
      detail: "قائمة تحقّق تُقرأ قبل أن يُقفل الشهر",
    },
    {
      href: "/money/statement",
      title: "التدفّق النقدي وقائمة الدخل",
      actionLabel: "اعرضها",
      detail: "من كشف بنكك وفواتيرك — وما يحتاج مبيعات معروضٌ بسببه لا بصفر",
    },
  ];

  return (
    <PageShell
      user={user}
     
      title="المال"
      intro="أين ذهب المال وما بقي عليك — من كشف بنكك وفواتيرك، لا من تقدير."
    >
      {/*
        الصادر من الحساب، والمجهول منه معلَنٌ بمبلغه.
        «مصروفاتك ٤٢٬٠٠٠» تُقرأ كاملةً وفيها ثمانية آلاف لم يُعرف وجهها.
      */}
      <div className="mb-6 max-w-md">
        <Figure
          label="الصادر من الحساب"
          provenance={prov.bankOutflow}
          unit="حركة"
          href="/bank"
          note="اضغط «من أين جاء؟» لترى ما لم يُصنَّف بعد"
        />
      </div>

      <HubGrid tiles={tiles} />

      <section className="mt-10">
        <h2 className="mb-1 text-base font-bold">المصروف حسب نوعه</h2>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          من كشف البنك، بحسب ما صنّفتَه بنفسك. وسداد المورّدين والتحويل الشخصيّ مستثنيان — الأوّل له صفحته، والثاني سحبُ مالكٍ لا مصروف.
        </p>
        {byCategory.length === 0 ? (
          <Empty message="لا حركات مصنَّفة بعد. صنّف حركاتك من صفحة كشف البنك." />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {byCategory.map((c) => (
              <li key={c.category} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {CATEGORY_LABEL[c.category as TxCategory] ?? c.category}
                  </span>
                  <span className="block text-[11px] text-muted">{countNoun(c.n, TRANSACTION)}</span>
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
