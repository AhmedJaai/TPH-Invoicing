import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { expenses, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { DeriveExpenses } from "@/components/derive-expenses";
import { activeRecurring } from "@/services/expense.service";
import {
  expectedVsActual,
  totalActual,
  suspectedSupplierExpenses,
  totalExpected,
  unmetRecurring,
  type Expense,
} from "@/lib/expenses";
import { countNoun, ITEM } from "@/lib/arabic";
import { CATEGORY_LABEL } from "@/lib/bank/rules";

export const dynamic = "force-dynamic";

/**
 * المتوقَّع مقابل الفعلي.
 *
 * السؤال الذي لم يكن النظام يجيبه: هل دُفع الإيجار هذا الشهر؟ وغياب
 * الجواب أخطر من الرقم — فالمصروف المنسيّ يظهر متأخّراً ومعه غرامته.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} title="المصروفات">
        <Empty message="هذه الصفحة محجوبة عن دورك." />
      </PageShell>
    );
  }

  const p = await searchParams;

  const months = (
    await db
      .select({ month: expenses.periodMonth })
      .from(expenses)
      .groupBy(expenses.periodMonth)
      .orderBy(desc(expenses.periodMonth))
  ).map((r) => r.month);

  const month = p.month && months.includes(p.month) ? p.month : months[0];

  if (!month) {
    return (
      <PageShell
        user={user}
        width="wide"
        title="المصروفات"
        intro="ما صُرف فعلاً، مقابل ما كان متوقَّعاً."
      >
        <DeriveExpenses />
        <div className="mt-4">
          <Empty message="لا مصروفات مقيَّدة بعد. اشتقّها من كشف البنك أعلاه." />
        </div>
      </PageShell>
    );
  }

  const [rows, recurring, supplierRows] = await Promise.all([
    db.select().from(expenses).where(eq(expenses.periodMonth, month)).orderBy(desc(expenses.occurredOn)),
    activeRecurring(),
    db.select({ nameAr: suppliers.nameAr }).from(suppliers),
  ]);

  const actual: Expense[] = rows.map((r) => ({
    id: r.id,
    periodMonth: r.periodMonth,
    occurredOn: r.occurredOn,
    category: r.category,
    label: r.label,
    amountMinor: r.amountMinor,
    source: r.source,
    bankTransactionId: r.bankTransactionId,
    recurringExpenseId: r.recurringExpenseId,
  }));

  const variance = expectedVsActual(recurring, actual, month);
  const suspects = suspectedSupplierExpenses(actual, supplierRows.map((s) => s.nameAr));
  const unmet = unmetRecurring(recurring, actual, month);
  const actualTotal = totalActual(actual, month);
  const expectedTotal = totalExpected(recurring);

  return (
    <PageShell
      user={user}
      width="wide"
      title="المصروفات"
      intro="ما صُرف فعلاً، مقابل ما كان متوقَّعاً. وسداد المورّدين ليس هنا — فهو محسوبٌ في المشتريات، وقيده مرّتين يضاعف مصروف المقهى."
    >
      <div className="flex flex-wrap items-center gap-2">
        {months.map((m) => (
          <a
            key={m}
            href={`/money/expenses?month=${m}`}
            className={`nums rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              m === month ? "bg-inverse-surface text-inverse-ink" : "border border-line hover:border-ink-soft"
            }`}
          >
            {m}
          </a>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Box label="المتوقَّع شهرياً" minor={expectedTotal}
             note={recurring.length === 0 ? "لم تُسجَّل مصروفات متكرّرة بعد" : countNoun(recurring.length, ITEM)} />
        <Box label={`الفعليّ في ${month}`} minor={actualTotal} note={countNoun(actual.length, ITEM)} />
        <Box
          label="الفرق"
          minor={actualTotal - expectedTotal}
          tone={expectedTotal === 0 ? "muted" : actualTotal > expectedTotal ? "warn" : "ok"}
          note={
            expectedTotal === 0
              ? "لا مقارنة بلا متوقَّع"
              : actualTotal > expectedTotal
                ? "صُرف أكثر ممّا تُوقّع"
                : "صُرف أقلّ ممّا تُوقّع"
          }
        />
      </div>

      {unmet.length > 0 && (
        <section className="mt-6 rounded-xl border border-warn/40 bg-warn-bg p-4">
          <h2 className="text-sm font-bold text-warn">متوقَّع لم يُصرف في {month}</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            هذه بنود تتكرّر عادةً ولم يُقيَّد لها صرفٌ هذا الشهر. قد تكون دُفعت نقداً ولم
            تُسجَّل، وقد تكون نُسيت.
          </p>
          <ul className="mt-3 divide-y divide-line/60 rounded-lg border border-line/60 bg-surface/60">
            {unmet.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-xs font-medium">{r.label}</span>
                <span className="shrink-0 text-xs font-bold"><Money minor={r.amountMinor} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suspects.length > 0 && (
        <section className="mt-6 rounded-xl border border-danger/40 bg-danger-bg p-4">
          <h2 className="text-sm font-bold text-danger">
            مصروفات تحمل أسماء مورّدين مسجّلين ({countNoun(suspects.length, ITEM)})
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            إن كانت هذه مشتريات فهي محسوبة مرّتين: في المشتريات وهنا. صحّح تصنيفها في
            كشف البنك مرّة، فتسري القاعدة على أمثالها.
          </p>
          <ul className="mt-3 divide-y divide-line/60 rounded-lg border border-line/60 bg-surface/60">
            {suspects.map(({ expense: e, supplier }) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{e.label}</span>
                  <span className="block truncate text-[10px] text-muted">
                    مصنَّفة {CATEGORY_LABEL[e.category]} · تطابق المورّد «{supplier}»
                  </span>
                </span>
                <span className="shrink-0 text-xs font-bold"><Money minor={e.amountMinor} /></span>
              </li>
            ))}
          </ul>
          <a
            href="/bank"
            className="mt-3 inline-block rounded-lg bg-inverse-surface px-3.5 py-1.5 text-[11px] font-bold text-inverse-ink"
          >
            صحّح التصنيف ←
          </a>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-base font-bold">المتوقَّع مقابل الفعلي</h2>
        {variance.length === 0 ? (
          <Empty message="لا بيانات لهذا الشهر." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[34rem] text-xs">
              <thead className="bg-sunken text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">الباب</th>
                  <th className="px-3 py-2 text-end font-medium">المتوقَّع</th>
                  <th className="px-3 py-2 text-end font-medium">الفعليّ</th>
                  <th className="px-3 py-2 text-end font-medium">الفرق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {variance.map((v) => (
                  <tr key={v.category}>
                    <td className="px-3 py-2">{v.label}</td>
                    <td className="px-3 py-2 text-end">
                      {v.expectedMinor === 0 ? <span className="text-muted">لم يُتوقَّع</span> : <Money minor={v.expectedMinor} />}
                    </td>
                    <td className="px-3 py-2 text-end"><Money minor={v.actualMinor} /></td>
                    <td className="px-3 py-2 text-end font-bold">
                      <Money minor={v.varianceMinor} tone={v.varianceMinor > 0 ? "warn" : "ok"} />
                      {v.variancePct !== null && (
                        <span className="ms-1 text-[10px] font-normal text-muted">
                          {v.variancePct > 0 ? "+" : ""}{Math.round(v.variancePct * 100)}٪
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-bold">القيود</h2>
          <DeriveExpenses month={month} />
        </div>
        {actual.length === 0 ? (
          <Empty message="لا قيود في هذا الشهر." />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
            {actual.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{e.label}</span>
                  <span className="nums block truncate text-[11px] text-muted">
                    {e.occurredOn} · {SOURCE_LABEL[e.source]}
                    {e.recurringExpenseId && " · مربوط بمتوقَّع"}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-bold"><Money minor={e.amountMinor} /></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}

const SOURCE_LABEL: Record<Expense["source"], string> = {
  BANK: "من كشف البنك",
  INVOICE: "من فاتورة",
  MANUAL: "قيدٌ يدويّ",
};

function Box({
  label, minor, note, tone,
}: {
  label: string;
  minor: number;
  note?: string;
  tone?: "warn" | "ok" | "muted";
}) {
  const cls = tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : tone === "muted" ? "text-muted" : "";
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold leading-none ${cls}`}><Money minor={minor} /></p>
      {note && <p className="mt-1.5 text-[11px] text-muted">{note}</p>}
    </div>
  );
}
