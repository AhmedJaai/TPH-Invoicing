import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { Figure } from "@/components/figure";
import { gatherHomeProvenance } from "@/lib/provenance-facts";
import { buildCashFlow, type CashMovement } from "@/lib/cashflow";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { DataTable, NoAccess, Section, Stat } from "@/components/ui";
import { INVOICE, TRANSACTION, countNoun } from "@/lib/arabic";
import { formatMonth } from "@/lib/riyadh-time";
import { looksLikeGoodsPurchase } from "@/lib/expenses";

export const dynamic = "force-dynamic";

/**
 * المال: أين ذهب — لا فهرسٌ لصفحاتٍ عن المال.
 *
 * كانت الصفحة ستَّ بطاقاتٍ، **أربعٌ منها روابط إلى صفحاتٍ أخرى** — وقد
 * صارت تلك الصفحاتُ ألسنةً في شريط المساحة فوق العنوان، فالبطاقة التي
 * كلُّ محتواها «اذهب إلى هنا» لم يبقَ لها معنى.
 *
 * وبطاقةُ «المستحقّ للمورّدين» كانت تعرض ١٠٬٥٠٢٫٤٩ — وهو الرقم نفسه
 * المعروض في الرئيسية وفي حسابات المورّدين. ثلاثُ شاشاتٍ لرقمٍ واحد،
 * وثلاثةُ أسماءٍ له. فخرج من هنا: هذه صفحةُ **ما خرج من الحساب**،
 * والمستحقُّ سؤالُ المورّدين.
 *
 * وانتقل إليها **التدفّق النقديّ** من `/money/statement` — وكانت تلك
 * تعرض جدول «المصروف حسب الباب» نفسه المعروض هنا بالأرقام نفسها. أمّا
 * قائمةُ الدخل فخمسةٌ من سبعة بنودٍ فيها «غير متاح» حتى يُوصَل مصدر
 * المبيعات، وهيكلٌ ينتظر مصدراً ليس صفحةً تُفتَح كلّ شهر.
 */
export default async function MoneyPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/money");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} title="أين ذهب المال">
        <NoAccess />
      </PageShell>
    );
  }

  const [prov, counts, movements, debitRows] = await Promise.all([
    gatherHomeProvenance(),
    db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from bank_transactions)                            as tx,
        (select count(*)::int from bank_transactions where category='UNKNOWN')   as unclassified,
        (select coalesce(sum(vat_minor),0)::bigint from invoices
           where input_vat_status='ELIGIBLE')                                    as recoverable,
        (select coalesce(sum(vat_minor),0)::bigint from invoices
           where input_vat_status='NOT_ELIGIBLE' and vat_minor > 0)              as at_risk,
        (select count(*)::int from invoices where input_vat_status='UNKNOWN')    as vat_unknown
    `),
    db.execute<{ month: string; direction: string; category: string; amount: string }>(sql`
      select to_char(value_date, 'YYYY-MM') as month,
             direction::text as direction,
             category::text as category,
             sum(amount_minor)::bigint as amount
        from bank_transactions
       group by 1, 2, 3
    `),
    /*
      «شراء بضاعة» يُستبعَد بالدالّة نفسها التي تستبعده في المصروفات.
      كان يُحسب هنا راتباً ويُستبعَد هناك، فللرواتب رقمان في شاشتين.
    */
    db.execute<{ category: string; amount_minor: string; description: string | null; beneficiary_raw: string | null }>(sql`
      select category::text as category, amount_minor, description, beneficiary_raw
        from bank_transactions
       where direction = 'DEBIT'
         and category not in ('INTERNAL','UNKNOWN','SUPPLIER','PERSONAL','POS_SETTLEMENT')
    `),
  ]);

  const f = counts.rows[0] ?? {};
  const n = (k: string) => Number(f[k] ?? 0);

  const cash = buildCashFlow(
    movements.rows.map<CashMovement>((r) => ({
      month: r.month,
      direction: r.direction as "DEBIT" | "CREDIT",
      category: r.category as TxCategory,
      amountMinor: Number(r.amount),
    })),
  );

  const categoryTotals = new Map<string, { category: string; n: number; s: number }>();
  for (const r of debitRows.rows) {
    if (looksLikeGoodsPurchase(r.description ?? "", r.beneficiary_raw)) continue;
    const e = categoryTotals.get(r.category) ?? { category: r.category, n: 0, s: 0 };
    e.n++;
    e.s += Number(r.amount_minor);
    categoryTotals.set(r.category, e);
  }
  const byCategory = [...categoryTotals.values()].sort((a, b) => b.s - a.s);
  const expenseTotal = byCategory.reduce((s, c) => s + c.s, 0);

  return (
    <PageShell
      user={user}
      width="wide"
      title="أين ذهب المال"
      intro="من كشف بنكك وفواتيرك، لا من تقدير. وما لم يُصنَّف معلَنٌ بمبلغه."
    >
      {/*
        الصادر من الحساب، والمجهول منه معلَنٌ بمبلغه.
        «مصروفاتك ٤٢٬٠٠٠» تُقرأ كاملةً وفيها ثمانية آلاف لم يُعرف وجهها.
      */}
      {/*
        ── ارتفاعاتٌ متساوية ──

        كانت البطاقةُ الأولى بيانَ مصدرٍ فيه زرٌّ يُفتَح، وبجانبها أربعُ
        بطاقاتٍ قصيرة في صفٍّ واحد — فتبدو الصفحةُ مكسورةً من أوّلها،
        ويقفز ما تحتها حين يُفتَح البيان. فصارت الأولى تملأ ارتفاع
        صفّها، والأربعُ في مربّعين × مربّعين إلى جانبها.
      */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-stretch">
        <Figure
          label="الصادر من الحساب"
          provenance={prov.bankOutflow}
          unit="حركة"
          href="/bank"
          note="اضغط «من أين جاء؟» لترى ما لم يُصنَّف بعد"
          className="flex flex-col"
        />
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          <Stat
            label="الوارد إلى الحساب"
            minor={cash.totalInMinor}
            tone="ok"
            sub="يشمل إيداعات نقاط البيع — وهي ليست «مبيعات»، فالمبيعات تحتاج مصدرها"
          />
          <Stat
            label="ضريبة قابلة للاسترداد"
            minor={n("recoverable")}
            tone="ok"
            sub="من فواتير ضريبية كاملة"
            href="/purchases/invoices?tax=VALID"
          />
          <Stat
            label="ضريبة معرَّضة للضياع"
            minor={n("at_risk")}
            tone={n("at_risk") > 0 ? "danger" : "ok"}
            sub={
              n("vat_unknown") > 0
                ? `و${countNoun(n("vat_unknown"), INVOICE)} لم يُقرأ تفصيلها بعد`
                : "من فواتير لا تصلح للخصم"
            }
            href="/purchases/invoices?tax=INVALID"
          />
          <Stat
            label="حركات كشف البنك"
            value={String(n("tx"))}
            tone={n("unclassified") > 0 ? "warn" : "ok"}
            sub={
              n("unclassified") > 0
                ? `${countNoun(n("unclassified"), TRANSACTION)} لم تُصنَّف`
                : "كلّها مصنَّفة"
            }
            href="/bank"
          />
        </div>
      </div>

      <Section
        title="المصروف حسب بابه"
        hint="من كشف البنك، بحسب ما صنّفتَه بنفسك — وسدادُ المورّدين والتحويلُ الشخصيّ مستثنيان: الأوّل محسوبٌ في المشتريات، والثاني سحبُ مالكٍ لا مصروف."
        /*
          مدخلُ «المصروفات» — خرجت من ألسنة المساحة لأنّ جوابها بلا
          مصروفاتٍ متكرّرةٍ مسجّلة «لا يمكن الحساب»، وموضعُها الطبيعيّ
          هنا: من قرأ بابَ المصروف هو من يريد تفصيله ومقارنته بالمتوقَّع.
        */
        action={
          <Link
            href="/money/expenses"
            className="text-xs font-medium underline underline-offset-4 hover:text-ink"
          >
            المتوقَّع مقابل الفعليّ ←
          </Link>
        }
      >
        {byCategory.length === 0 ? (
          <Empty message="لا حركات مصنَّفة بعد. صنّف حركاتك من صفحة حركة البنك." />
        ) : (
          /*
            صفٌّ عرضُه ألفُ بكسل بين اسمٍ في طرفٍ ورقمٍ في طرف يُقرأ
            واحداً واحداً، ولا يقول أيُّ بابٍ أثقل. والشريطُ يقوله في
            لمحة — ونسبتُه من أكبر بابٍ لا من المجموع، فالفرقُ بين
            البابين هو المقصود.
          */
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {byCategory.map((c) => (
              <li key={c.category} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {CATEGORY_LABEL[c.category as TxCategory] ?? c.category}
                    </span>
                    <span className="block text-[11px] text-muted">{countNoun(c.n, TRANSACTION)}</span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="nums block text-sm font-bold">
                      <Money minor={Number(c.s)} />
                    </span>
                    <span className="nums block text-[11px] text-muted">
                      {expenseTotal > 0 ? `${Math.round((c.s / expenseTotal) * 100)}٪` : ""}
                    </span>
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <div
                    className="h-full rounded-full bg-ink-soft"
                    style={{ width: `${Math.max(1, Math.round((c.s / byCategory[0].s) * 100))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── التدفّق الشهريّ — كان صفحةً مستقلّة تعرض الجدول أعلاه كذلك ── */}
      {cash.months.length > 0 && (
        <Section
          title="التدفّق النقديّ شهراً بشهر"
          hint="من حركات البنك مباشرةً. والوارد يشمل إيداعات نقاط البيع."
        >
          {cash.unclassifiedCount > 0 && (
            <p className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn">
              ⚠ {countNoun(cash.unclassifiedCount, TRANSACTION)} بقيمة{" "}
              <Money minor={cash.unclassifiedMinor} /> لم تُصنَّف بعد، فتوزيعُ المصروف أعلاه ناقصٌ بقدرها.
            </p>
          )}
          <DataTable
            rows={cash.months}
            keyOf={(m) => m.month}
            columns={[
              { key: "month", header: "الشهر", primary: true, cell: (m) => formatMonth(m.month) },
              { key: "in", header: "وارد", numeric: true, cell: (m) => <span className="text-ok"><Money minor={m.inMinor} /></span> },
              { key: "out", header: "صادر", numeric: true, cell: (m) => <span className="text-warn"><Money minor={m.outMinor} /></span> },
              {
                key: "net", header: "الصافي", numeric: true,
                cell: (m) => (
                  <span className={`font-bold ${m.netMinor >= 0 ? "text-ok" : "text-danger"}`}>
                    <Money minor={m.netMinor} />
                  </span>
                ),
              },
            ]}
          />
        </Section>
      )}
    </PageShell>
  );
}
