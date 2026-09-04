import { redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, monthCloses } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { MonthClose } from "@/components/month-close";
import { previousMonth } from "@/lib/filing";
import { buildMonthClose } from "@/lib/month-close";
import { gatherMonthFacts } from "@/lib/month-close-facts";

export const dynamic = "force-dynamic";

export default async function ClosePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "month:close")) {
    return (
      <PageShell user={user} title="إقفال الشهر">
        <Empty message="إقفال الشهر للمالك والمحاسب." />
      </PageShell>
    );
  }

  // الأشهر التي فيها بيانات فعلاً، مع الشهر المنقضي دائماً
  const rows = await db
    .select({ month: invoices.periodMonth })
    .from(invoices)
    .groupBy(invoices.periodMonth)
    .orderBy(desc(invoices.periodMonth));

  const previous = previousMonth(new Date().toISOString().slice(0, 7));
  const months = [...new Set([previous, ...rows.map((r) => r.month)])].sort().reverse();

  const closed = await db
    .select({ month: monthCloses.month, status: monthCloses.status, closedAt: monthCloses.closedAt })
    .from(monthCloses)
    .where(sql`${monthCloses.status} = 'CLOSED'`)
    .orderBy(desc(monthCloses.month));

  if (months.length === 0) {
    return (
      <PageShell user={user} title="إقفال الشهر">
        <Empty message="لا بيانات بعد. ارفع فواتيرك أوّلاً." />
      </PageShell>
    );
  }

  const selected = months.includes(previous) ? previous : months[0];
  const report = buildMonthClose(await gatherMonthFacts(selected));
  const status = closed.some((c) => c.month === selected) ? "CLOSED" : "OPEN";

  return (
    <PageShell
      user={user}
     
      title="إقفال الشهر"
      intro="الإقفال إعلانٌ بأنّ الشهر تمّ: كل فاتورة وصلت، وكل خلل عُولج أو أُقرَّ به عمداً. فليس زرّاً يُضغط بل قائمةً تُقرأ."
    >
      <MonthClose
        months={months}
        initialMonth={selected}
        initialReport={report}
        initialStatus={status}
      />

      {closed.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-bold">أشهر مقفلة</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {closed.map((c) => (
              <li key={c.month} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="nums font-medium" dir="ltr">{c.month}</span>
                <span className="nums text-[11px] text-muted" dir="ltr">
                  {c.closedAt?.toISOString().slice(0, 10) ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
