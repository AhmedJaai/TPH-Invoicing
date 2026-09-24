import { redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { CalendarCheck, Lock } from "lucide-react";
import { db } from "@/db";
import { invoices, monthCloses } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { EmptyState, LinkButton, NoAccess, Section } from "@/components/ui";
import { MonthClose } from "@/components/month-close";
import { previousMonth } from "@/lib/filing";
import { buildMonthClose } from "@/lib/month-close";
import { gatherMonthFacts } from "@/lib/month-close-facts";
import { currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";

export const dynamic = "force-dynamic";

/**
 * إقفالُ الشهر — قائمةٌ موجَّهة ثمّ حزمةُ المحاسب.
 *
 * يُفتح على الشهر المنقضي؛ والفحوصُ بخطواتها في `MonthClose`، والإقفالُ
 * بإقرار، والحزمةُ تُنزَّل للشهر المختار مقفلاً كان أو مفتوحاً (ويُقال ذلك).
 */
export default async function ClosePage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/close");
  if (!can(user.role, "month:close")) {
    return (
      <PageShell user={user} title="إقفال الشهر">
        <NoAccess what="إقفال الشهر" />
      </PageShell>
    );
  }

  // الأشهر التي فيها بيانات فعلاً، مع الشهر المنقضي دائماً
  const rows = await db
    .select({ month: invoices.periodMonth })
    .from(invoices)
    .groupBy(invoices.periodMonth)
    .orderBy(desc(invoices.periodMonth));

  const previous = previousMonth(currentMonthRiyadh());
  const months = [...new Set([previous, ...rows.map((r) => r.month)])].sort().reverse();

  const closed = await db
    .select({ month: monthCloses.month, status: monthCloses.status, closedAt: monthCloses.closedAt })
    .from(monthCloses)
    .where(sql`${monthCloses.status} = 'CLOSED'`)
    .orderBy(desc(monthCloses.month));

  if (rows.length === 0) {
    return (
      <PageShell user={user} title="إقفال الشهر">
        <EmptyState
          icon={CalendarCheck}
          title="لا شهرَ يُقفَل بعد"
          hint="الإقفالُ إعلانٌ بأنّ فواتير الشهر كلّها وصلت — ولا فاتورة في النظام بعد. ارفع فواتيرك أو زامن الدرايف أوّلاً."
          action={<LinkButton href="/upload" variant="primary">ارفع مستنداً</LinkButton>}
        />
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
      eyebrow={`الشهر المنقضي: ${formatMonth(previous)}`}
      intro="إعلانٌ بأنّ الشهر تمّ: كلُّ فاتورةٍ وصلت، وكلُّ خللٍ عُولج أو أُقرّ به عمداً — ثمّ حزمةٌ واحدة للمحاسب."
    >
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <MonthClose months={months} initialMonth={selected} initialReport={report} initialStatus={status} />

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Section title="أشهرٌ مقفلة" icon={Lock} className="mt-0!">
            {closed.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs leading-relaxed text-muted">
                لم يُقفَل شهرٌ بعد. أوّلُ إقفالٍ يثبّت أرقام شهره ويُحفَظ هنا.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
                {closed.map((c) => (
                  <li key={c.month} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="flex items-center gap-2 font-bold">
                      <Lock className="h-3.5 w-3.5 text-ok" strokeWidth={2} aria-hidden />
                      {formatMonth(c.month)}
                    </span>
                    <span className="text-[11px] text-muted">{formatDay(c.closedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </aside>
      </div>
    </PageShell>
  );
}
