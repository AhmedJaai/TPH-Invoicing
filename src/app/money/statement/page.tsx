import { currentMonthRiyadh } from "@/lib/riyadh-time";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import {
  buildCashFlow, buildProfitLoss, compareExpenses,
  type CashMovement, type RecurringExpense,
} from "@/lib/cashflow";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { salesAvailable } from "@/lib/sales/connector";
import { NoAccess, DataTable } from "@/components/ui";
import { TRANSACTION, countNoun } from "@/lib/arabic";
import { isExpenseCategory, looksLikeGoodsPurchase } from "@/lib/expenses";

export const dynamic = "force-dynamic";

/**
 * التدفّق النقدي وقائمة الدخل.
 *
 * تُبنى ممّا هو معلوم وحده. والمبيعات غير موصولة، فالإيراد يُعرض بسببه
 * لا بصفر — وما يشتقّ منه يُعرض «غير متاح» كذلك.
 */
export default async function FinancialStatementPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/money/statement");
  if (!can(user.role, "reports:view")) {
    return (
      <PageShell user={user} width="wide" title="التدفّق وقائمة الدخل">
        <NoAccess />
      </PageShell>
    );
  }

  const movements = (
    await db.execute<{ month: string; direction: string; category: string; amount: string }>(sql`
      select to_char(value_date, 'YYYY-MM') as month,
             direction::text as direction,
             category::text as category,
             sum(amount_minor)::bigint as amount
        from bank_transactions
       group by 1, 2, 3
    `)
  ).rows.map<CashMovement>((r) => ({
    month: r.month,
    direction: r.direction as "DEBIT" | "CREDIT",
    category: r.category as TxCategory,
    amountMinor: Number(r.amount),
  }));

  const cash = buildCashFlow(movements);

  const [purchases] = (
    await db.execute<{ s: string }>(sql`
      select coalesce(sum(total_minor), 0)::bigint as s from invoices
    `)
  ).rows;

  /*
    المصروف التشغيليّ بالقاعدة نفسها التي يُقيَّد بها المصروف (`lib/expenses`):
    لا سدادُ مورّد (محسوبٌ في المشتريات)، ولا تحويلٌ داخليّ، ولا **سحبُ
    المالك** (توزيعٌ لا مصروف)، ولا ما يقول وصفُه «شراء بضاعة».

    وكان الشرط يستثني الداخليّ والمجهول والمورّد وحدها، فدخلت تحويلات
    أحمد الشخصيّة (١١٢٬٧٢٢٫١٨) «مصروفاً تشغيلياً» فتضاعف المجموع، وبأسماء
    تعداداتٍ إنجليزية. والمستبعَد يُعلَن بمبلغه لا يُحذف بصمت.
  */
  const debits = (
    await db.execute<{ category: string; description: string | null; beneficiary_raw: string | null; amount_minor: string; month: string }>(sql`
      select category::text as category, description, beneficiary_raw, amount_minor::bigint as amount_minor,
             to_char(value_date, 'YYYY-MM') as month
        from bank_transactions
       where direction = 'DEBIT'
    `)
  ).rows;

  /*
    المتوسّط الشهريّ «الفعليّ» يُقسَم على الأشهر التامّة وحدها.
    كان القاسم يعدّ الشهر الجاري (أيّاماً منه) فيُنقص كلّ متوسّط بخُمسه،
    فتقول المقارنة «أنفقتَ دون المتوقَّع» — والنقص أيّامٌ لا سلوك.
  */
  const thisMonth = currentMonthRiyadh();
  const fullMonthsMap = new Map<TxCategory, number>();
  const operatingMap = new Map<TxCategory, number>();
  let personalMinor = 0;
  let goodsMinor = 0;
  for (const r of debits) {
    const category = r.category as TxCategory;
    const amount = Number(r.amount_minor);
    if (category === "PERSONAL") { personalMinor += amount; continue; }
    if (!isExpenseCategory(category) || category === "POS_SETTLEMENT") continue;
    if (looksLikeGoodsPurchase(r.description, r.beneficiary_raw)) { goodsMinor += amount; continue; }
    operatingMap.set(category, (operatingMap.get(category) ?? 0) + amount);
    if (r.month !== thisMonth) fullMonthsMap.set(category, (fullMonthsMap.get(category) ?? 0) + amount);
  }
  const operating = [...operatingMap].map(([category, amountMinor]) => ({ category, amountMinor }));

  const recurring = (
    await db.execute<{ id: string; label: string; category: string; amount_minor: number; cadence: string }>(sql`
      select id, label, category::text as category, amount_minor, cadence
        from recurring_expenses where is_active
    `)
  ).rows.map<RecurringExpense>((r) => ({
    id: r.id,
    label: r.label,
    category: r.category as TxCategory,
    amountMinor: Number(r.amount_minor),
    cadence: r.cadence as RecurringExpense["cadence"],
  }));

  const monthsCount = Math.max(1, cash.months.filter((m) => m.month !== thisMonth).length);
  const monthlyActual = [...fullMonthsMap].map(([category, amountMinor]) => ({
    category,
    amountMinor: Math.round(amountMinor / monthsCount),
  }));
  const comparison = compareExpenses(recurring, monthlyActual);

  const connected = await salesAvailable();
  const pl = buildProfitLoss({
    netSalesMinor: connected ? 0 : null,
    purchasesMinor: Number(purchases?.s ?? 0),
    operatingByCategory: operating,
  });

  return (
    <PageShell
      user={user}
     
      title="التدفّق وقائمة الدخل"
      intro="مبنيّة على كشف بنكك وفواتيرك. وما يحتاج مبيعات أو مخزوناً معروضٌ بسببه لا بصفر."
    >
      {/* ── التدفّق النقدي ── */}
      <section>
        <h2 className="text-base font-bold">التدفّق النقدي</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          من حركات البنك مباشرةً. والوارد يشمل إيداعات نقاط البيع، وهي ليست
          «مبيعات» — المبيعات تحتاج مصدرها.
        </p>

        {cash.unclassifiedCount > 0 && (
          <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn">
            ⚠ {countNoun(cash.unclassifiedCount, TRANSACTION)} بقيمة{" "}
            <Money minor={cash.unclassifiedMinor} /> لم تُصنَّف بعد، فتوزيع المصروف
            أدناه ناقص بقدرها.
          </p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
            <p className="text-xs text-muted">الوارد</p>
            <p className="mt-1 text-xl font-bold text-ok"><Money minor={cash.totalInMinor} /></p>
          </div>
          <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
            <p className="text-xs text-muted">الصادر</p>
            <p className="mt-1 text-xl font-bold text-warn"><Money minor={cash.totalOutMinor} /></p>
          </div>
          <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
            <p className="text-xs text-muted">الصافي</p>
            <p className={`mt-1 text-xl font-bold ${cash.netMinor >= 0 ? "text-ok" : "text-danger"}`}>
              <Money minor={cash.netMinor} />
            </p>
          </div>
        </div>

        {cash.months.length > 0 && (
          <div className="mt-3">
            <DataTable
              rows={cash.months}
              keyOf={(m) => m.month}
              columns={[
                { key: "month", header: "الشهر", primary: true, cell: (m) => <span className="nums" dir="ltr">{m.month}</span> },
                { key: "in", header: "وارد", numeric: true, cell: (m) => <Money minor={m.inMinor} tone="ok" /> },
                { key: "out", header: "صادر", numeric: true, cell: (m) => <Money minor={m.outMinor} tone="warn" /> },
                { key: "net", header: "الصافي", numeric: true, cell: (m) => <span className="font-bold"><Money minor={m.netMinor} tone={m.netMinor >= 0 ? "ok" : "danger"} /></span> },
              ]}
            />
          </div>
        )}
      </section>

      {/* ── قائمة الدخل ── */}
      <section className="mt-10">
        <h2 className="text-base font-bold">قائمة الدخل</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          ناقصةٌ معلَنة. ينقصها: {pl.missing.join(" · ")} — ولن تُعرض بأرقام مقدَّرة.
        </p>
        {(personalMinor > 0 || goodsMinor > 0) && (
          <p className="mt-1 text-xs leading-relaxed text-muted">
            مستبعَدٌ من المصروف التشغيليّ:
            {personalMinor > 0 && <> تحويلاتٌ شخصيّة <Money minor={personalMinor} /> (سحبُ مالكٍ لا مصروف)</>}
            {personalMinor > 0 && goodsMinor > 0 && " · "}
            {goodsMinor > 0 && <> ما وصفُه «شراء بضاعة» <Money minor={goodsMinor} /> (محسوبٌ في المشتريات)</>}
          </p>
        )}
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
          {pl.lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className={`block truncate text-sm ${l.derived ? "font-bold" : ""}`}>
                  {l.label}
                </span>
                {l.unavailableReason && (
                  <span className="block text-[11px] text-muted">{l.unavailableReason}</span>
                )}
              </span>
              <span className="shrink-0 text-sm font-bold">
                {l.amountMinor === null ? (
                  <span className="text-muted">غير متاح</span>
                ) : (
                  <Money minor={l.amountMinor} />
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── المتوقَّع مقابل الفعلي ── */}
      <section className="mt-10">
        <h2 className="text-base font-bold">المصروف المتوقَّع مقابل الفعلي</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          المتوقَّع من مصروفاتك المتكرّرة المسجّلة، والفعلي متوسّط الشهر من كشف البنك.
        </p>
        {comparison.length === 0 ? (
          <div className="mt-3">
            <Empty message="لا مصروفات متكرّرة مسجّلة ولا حركات مصنَّفة بعد." />
          </div>
        ) : (
          <div className="mt-3">
            <DataTable
              rows={comparison}
              keyOf={(c) => c.category}
              columns={[
                {
                  key: "item", header: "البند", primary: true,
                  cell: (c) => (
                    <span>
                      <span className="block font-medium">{CATEGORY_LABEL[c.category] ?? c.category}</span>
                      {c.expectedMinor > 0 && <span className="block text-[11px] font-normal text-muted">{c.label}</span>}
                    </span>
                  ),
                },
                { key: "expected", header: "المتوقَّع شهرياً", numeric: true, cell: (c) => c.expectedMinor > 0 ? <Money minor={c.expectedMinor} /> : <span className="text-muted">—</span> },
                { key: "actual", header: "الفعلي", numeric: true, cell: (c) => <Money minor={c.actualMinor} /> },
                { key: "variance", header: "الفرق", numeric: true, cell: (c) => <span className="font-bold"><Money minor={c.varianceMinor} tone={c.overspent ? "warn" : "ok"} /></span> },
              ]}
            />
          </div>
        )}
      </section>
    </PageShell>
  );
}
