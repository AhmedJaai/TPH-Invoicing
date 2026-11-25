import Link from "next/link";
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
import { MonthCorrection } from "@/components/month-correction";
import { loadMonthsInCorrection } from "@/services/month-correction.service";
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
export default async function ClosePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/close");
  if (!can(user.role, "month:close")) {
    return (
      <PageShell user={user} title="إقفال الشهر">
        <NoAccess what="إقفال الشهر" />
      </PageShell>
    );
  }

  const previous = previousMonth(currentMonthRiyadh());

  /*
    الأشهرُ والمقفلُ منها وحقائقُ الشهر المنقضي تُطلَب معاً — كانت ثلاثَ مراحل
    ينتظر كلٌّ ما قبله. والشهرُ المنقضي في القائمة دائماً، فهو المفتوحُ عليه.
  */
  const [rows, closed, previousFacts] = await Promise.all([
    // الأشهر التي فيها بيانات فعلاً، مع الشهر المنقضي دائماً
    db
      .select({ month: invoices.periodMonth })
      .from(invoices)
      .groupBy(invoices.periodMonth)
      .orderBy(desc(invoices.periodMonth)),
    db
      .select({ month: monthCloses.month, status: monthCloses.status, closedAt: monthCloses.closedAt })
      .from(monthCloses)
      .where(sql`${monthCloses.status} = 'CLOSED'`)
      .orderBy(desc(monthCloses.month)),
    gatherMonthFacts(previous),
  ]);

  const months = [...new Set([previous, ...rows.map((r) => r.month)])].sort().reverse();

  if (rows.length === 0) {
    return (
      <PageShell user={user} title="إقفال الشهر">
        <EmptyState
          icon={CalendarCheck}
          title="لا يوجد شهر جاهز للإقفال بعد"
          hint="إقفال الشهر يعني أن كل فواتيره وصلت، ولا توجد في النظام فواتير حتى الآن. ارفع فواتيرك أو زامن الدرايف أولاً."
          action={<LinkButton href="/upload" variant="primary">ارفع مستنداً</LinkButton>}
        />
      </PageShell>
    );
  }

  /* `?month=` يفتح شهرَه — بندُ «شهرٌ مفتوح بين أشهرٍ مقفلة» يحيل إليه، وكان يفتح الشهرَ الماضي دائماً */
  const asked = (await searchParams).month;
  const selected = asked && months.includes(asked) ? asked : months.includes(previous) ? previous : months[0];
  const [report, inCorrection] = await Promise.all([
    selected === previous ? Promise.resolve(buildMonthClose(previousFacts)) : gatherMonthFacts(selected).then(buildMonthClose),
    loadMonthsInCorrection(),
  ]);
  const status = closed.some((c) => c.month === selected) ? "CLOSED" : "OPEN";

  return (
    <PageShell
      user={user}
      title="إقفال الشهر"
      eyebrow={`الشهر الماضي: ${formatMonth(previous)}`}
      intro="أكّد أن الشهر اكتمل: وصلت كل فواتيره، وعولجت كل المشكلات أو قبلتها عن علم. بعدها تحصل على حزمة واحدة جاهزة للمحاسب."
    >
      {/* التصحيحُ في الماضي بخطوتين: فتحٌ جماعيّ بسبب، ثمّ إقفالٌ جماعيّ بعد رؤية الفرق */}
      <div className="mb-8">
        <MonthCorrection open={inCorrection} closed={closed.map((c) => c.month)} canReopen={can(user.role, "month:reopen")} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[minmax(0,1fr)_18rem]">
        {/* المفتاحُ الشهر: رابطُ «أشهر مقفلة» يعيد بناءه بشهره لا بحاله القديمة */}
        <MonthClose key={selected} months={months} initialMonth={selected} initialReport={report} initialStatus={status} />

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Section title="أشهر مقفلة" icon={Lock} className="mt-0!">
            {closed.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs leading-relaxed text-muted">
                لم يُقفل أي شهر بعد. الإقفال الأول يثبّت أرقام شهره ويحفظه هنا.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
                {closed.map((c) => (
                  <li key={c.month}>
                    {/* الشهرُ المقفل يُفتح بحزمته وإعادة فتحه — لا نصٌّ يُقرأ ثمّ يُبحث عنه في القائمة */}
                    <Link href={`/close?month=${c.month}`} aria-current={c.month === selected ? "page" : undefined}
                      className={`flex min-h-11 items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-sunken/60 ${c.month === selected ? "bg-accent-soft/50" : ""}`}>
                      <span className="flex items-center gap-2 font-bold">
                        <Lock className="h-3.5 w-3.5 text-ok" strokeWidth={2} aria-hidden />
                        {formatMonth(c.month)}
                      </span>
                      <span className="text-[11px] text-muted">{formatDay(c.closedAt)}</span>
                    </Link>
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
