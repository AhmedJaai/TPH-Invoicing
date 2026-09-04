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

export const dynamic = "force-dynamic";

/**
 * التدفّق النقدي وقائمة الدخل.
 *
 * تُبنى ممّا هو معلوم وحده. والمبيعات غير موصولة، فالإيراد يُعرض بسببه
 * لا بصفر — وما يشتقّ منه يُعرض «غير متاح» كذلك.
 */
export default async function FinancialStatementPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "reports:view")) {
    return (
      <PageShell user={user} width="wide" title="التدفّق النقدي وقائمة الدخل">
        <Empty message="هذه الصفحة محجوبة عن دورك." />
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

  // المصروف التشغيلي: من كشف البنك، بلا سداد المورّدين ولا الحركات التشغيلية
  const operating = (
    await db.execute<{ category: string; s: string }>(sql`
      select category::text as category, sum(amount_minor)::bigint as s
        from bank_transactions
       where direction = 'DEBIT'
         and category not in ('INTERNAL', 'UNKNOWN', 'SUPPLIER')
       group by 1
    `)
  ).rows.map((r) => ({ category: r.category as TxCategory, amountMinor: Number(r.s) }));

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

  const monthsCount = Math.max(1, cash.months.length);
  const monthlyActual = operating.map((o) => ({
    category: o.category,
    amountMinor: Math.round(o.amountMinor / monthsCount),
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
     
      title="التدفّق النقدي وقائمة الدخل"
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
            ⚠ {cash.unclassifiedCount} حركة بقيمة{" "}
            <Money minor={cash.unclassifiedMinor} /> لم تُصنَّف بعد، فتوزيع المصروف
            أدناه ناقص بقدرها.
          </p>
        )}

        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-line bg-raised px-4 py-3">
            <p className="text-xs text-muted">الوارد</p>
            <p className="mt-1 text-xl font-bold text-ok"><Money minor={cash.totalInMinor} /></p>
          </div>
          <div className="rounded-xl border border-line bg-raised px-4 py-3">
            <p className="text-xs text-muted">الصادر</p>
            <p className="mt-1 text-xl font-bold text-warn"><Money minor={cash.totalOutMinor} /></p>
          </div>
          <div className="rounded-xl border border-line bg-raised px-4 py-3">
            <p className="text-xs text-muted">الصافي</p>
            <p className={`mt-1 text-xl font-bold ${cash.netMinor >= 0 ? "text-ok" : "text-danger"}`}>
              <Money minor={cash.netMinor} />
            </p>
          </div>
        </div>

        {cash.months.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">الشهر</th>
                  <th className="px-3 py-2 text-right font-medium">وارد</th>
                  <th className="px-3 py-2 text-right font-medium">صادر</th>
                  <th className="px-3 py-2 text-right font-medium">الصافي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-raised">
                {cash.months.map((m) => (
                  <tr key={m.month}>
                    <td className="nums px-3 py-2.5 font-medium" dir="ltr">{m.month}</td>
                    <td className="px-3 py-2.5"><Money minor={m.inMinor} tone="ok" /></td>
                    <td className="px-3 py-2.5"><Money minor={m.outMinor} tone="warn" /></td>
                    <td className="px-3 py-2.5 font-bold">
                      <Money minor={m.netMinor} tone={m.netMinor >= 0 ? "ok" : "danger"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── قائمة الدخل ── */}
      <section className="mt-10">
        <h2 className="text-base font-bold">قائمة الدخل</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          ناقصةٌ معلَنة. ينقصها: {pl.missing.join(" · ")} — ولن تُعرض بأرقام مقدَّرة.
        </p>
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
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
          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">البند</th>
                  <th className="px-3 py-2 text-right font-medium">المتوقَّع شهرياً</th>
                  <th className="px-3 py-2 text-right font-medium">الفعلي</th>
                  <th className="px-3 py-2 text-right font-medium">الفرق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-raised">
                {comparison.map((c) => (
                  <tr key={c.category}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                      {c.expectedMinor > 0 && (
                        <p className="text-[11px] text-muted">{c.label}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {c.expectedMinor > 0 ? <Money minor={c.expectedMinor} /> : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5"><Money minor={c.actualMinor} /></td>
                    <td className="px-3 py-2.5 font-bold">
                      <Money minor={c.varianceMinor} tone={c.overspent ? "warn" : "ok"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}
