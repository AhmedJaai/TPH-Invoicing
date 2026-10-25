import { formatRiyalsDisplay } from "@/lib/money";
import { DAY, ORDER, countNoun } from "@/lib/arabic";
import { redirect } from "next/navigation";
import { CalendarDays, Clock, Coffee, CreditCard, Info, ShoppingBag, TrendingDown, TrendingUp, Utensils } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney, MonthTabs, Unknown } from "@/components/finance-bits";
import { Callout, DataTable, Delta, EmptyState, KeyFigure, LinkButton, NoAccess, Section, type Column } from "@/components/ui";
import { formatShare, formatUnits } from "@/lib/finance/format";
import { currentMonthRiyadh, formatDay, formatMonth, formatWeekday } from "@/lib/riyadh-time";
import { loadRevenue } from "@/services/profit.service";
import { loadSalesAnalysis, type ItemRow } from "@/services/sales-analysis.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** أدنى مبيعاتٍ ليُحكَم على هامش صنف — ما دونها ضجيج. */
const MARGIN_FLOOR_MINOR = 300_00;
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function pctChange(now: number, before: number | null): number | null {
  return before === null || before <= 0 ? null : ((now - before) / before) * 100;
}

const itemColumns: Column<ItemRow>[] = [
  { key: "name", header: "الصنف", primary: true, cell: (i) => i.name, sortBy: (i) => i.name },
  { key: "qty", header: "الكمية", numeric: true, cell: (i) => <span className="nums">{formatUnits(i.quantityMilli)}</span>, sortBy: (i) => i.quantityMilli },
  { key: "sales", header: "المبيعات (بالضريبة)", numeric: true, cell: (i) => <Money minor={i.salesMinor} />, sortBy: (i) => i.salesMinor },
  { key: "change", header: "عن الشهر السابق", cell: (i) => (i.previousSalesMinor === null ? <span className="text-[11px] text-muted">جديد</span> : <Delta pct={pctChange(i.salesMinor, i.previousSalesMinor)} />), sortBy: (i) => (i.previousSalesMinor === null ? null : i.salesMinor - i.previousSalesMinor), secondary: true },
  { key: "cost", header: "تكلفة الوصفة", numeric: true, cell: (i) => <MaybeMoney minor={i.costMinor} />, sortBy: (i) => i.costMinor, secondary: true },
  { key: "margin", header: "الهامش", numeric: true, cell: (i) => (i.marginBp === null ? <span className="text-[11px] text-muted">لا وصفة</span> : <span className={i.marginBp < 5_000 ? "font-bold text-warn" : ""}>{formatShare(i.marginBp)}</span>), sortBy: (i) => i.marginBp },
];

/**
 * المبيعات — «ماذا أبيع ومتى، وما الذي صعد وهبط، وما الذي خرج من الإيراد؟».
 * الإيرادُ إيرادُ قائمة الدخل نفسُه (`loadRevenue`)؛ وهذه الصفحةُ وجهةُ سطره هناك.
 */
export default async function FinanceSalesPage({ searchParams }: { searchParams: Promise<{ month?: string; sort?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/sales");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="المبيعات"><NoAccess what="تحليل المبيعات" /></PageShell>;
  }
  const q = await searchParams;
  const months = [...(await loadRevenue()).keys()].sort().reverse();
  const current = currentMonthRiyadh();
  const month = q.month && MONTH_RE.test(q.month) && months.includes(q.month) ? q.month : months[0] ?? current;

  if (months.length === 0) {
    return (
      <PageShell user={user} title="المبيعات" intro="ما يُباع ومتى، من طلبات فودكس.">
        <EmptyState icon={ShoppingBag} title="لا توجد مبيعات مقروءة بعد." hint="تُقرأ المبيعات من فودكس مباشرة. زامنها من صفحة «فودكس والبنك»." action={<LinkButton href="/money/foodics" size="sm">افتح فودكس والبنك</LinkButton>} />
      </PageShell>
    );
  }

  const a = await loadSalesAnalysis(month);
  const rev = a.revenue;
  const open = month === current;
  /* شهرٌ جارٍ يُقارَن بما مضى من سابقه حتى اليوم نفسه لا بكلّه */
  const before = open ? a.previousToDatePaidMinor : a.previous?.paidMinor ?? null;
  const ticket = rev && rev.orders > 0 ? Math.round(rev.paidMinor / rev.orders) : null;
  const prevTicket = a.previous && a.previous.orders > 0 ? Math.round(a.previous.paidMinor / a.previous.orders) : null;
  const maxDay = Math.max(1, ...a.days.map((d) => d.paidMinor));
  const maxHour = Math.max(1, ...a.hours.map((h) => h.paidMinor));
  const weekdayAvg = a.weekdays.map((w) => ({ ...w, avgMinor: w.days > 0 ? Math.round(w.paidMinor / w.days) : 0 }));
  const maxWeekday = Math.max(1, ...weekdayAvg.map((w) => w.avgMinor));
  const methodTotal = a.methods.filter((m) => m.type !== 5).reduce((s, m) => s + m.amountMinor, 0);
  const movers = a.items.filter((i) => i.previousSalesMinor !== null && Math.max(i.salesMinor, i.previousSalesMinor ?? 0) >= MARGIN_FLOOR_MINOR)
    .map((i) => ({ ...i, delta: i.salesMinor - (i.previousSalesMinor ?? 0) }));
  const risers = [...movers].filter((i) => i.delta > 0).sort((x, y) => y.delta - x.delta).slice(0, 5);
  const fallers = [...movers].filter((i) => i.delta < 0).sort((x, y) => x.delta - y.delta).slice(0, 5);
  const weak = a.items.filter((i) => i.marginBp !== null && i.salesMinor >= MARGIN_FLOOR_MINOR).sort((x, y) => (x.marginBp ?? 0) - (y.marginBp ?? 0)).slice(0, 5);
  const noRecipe = a.items.filter((i) => i.costMinor === null && i.salesMinor > 0);
  const noRecipeMinor = noRecipe.reduce((s, i) => s + i.salesMinor, 0);
  const busiest = [...a.hours].sort((x, y) => y.paidMinor - x.paidMinor)[0];

  return (
    <PageShell user={user} width="wide" title="المبيعات" intro="ما يُباع ومتى، وما ارتفع وما انخفض، وما نقص من الإيراد، من طلبات فودكس.">
      <MonthTabs base="/finance/sales" months={months} active={month} />

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyFigure
          icon={ShoppingBag}
          label={`ما دفعه الزبائن في ${formatMonth(month)}`}
          delta={rev ? pctChange(rev.paidMinor, before) : undefined}
          value={rev ? <Money minor={rev.paidMinor} currency /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={rev ? <><T s="شاملاً الضريبة. وبدون الضريبة {0}، وهو إيراد قائمة الدخل.{1}" a={[<strong key="0" className="text-ink"><Money minor={rev.paidMinor - rev.vatMinor} /></strong>, open && before !== null && " مقارنةً بالفترة نفسها من الشهر السابق."]} /></> : undefined}
          href={`/finance?month=${month}`}
        />
        <KeyFigure
          icon={Utensils}
          label="الطلبات"
          delta={rev && a.previous && !open ? pctChange(rev.orders, a.previous.orders) : undefined}
          value={rev ? <span className="nums">{rev.orders.toLocaleString("en-US")}</span> : <span className="text-xl text-muted">غير معروف</span>}
          sub={rev ? <><T s="في {0}، بمعدل {1} يومياً." a={[countNoun(rev.coveredDays, DAY), countNoun(rev.coveredDays > 0 ? Math.round(rev.orders / rev.coveredDays) : 0, ORDER)]} /></> : undefined}
        />
        <KeyFigure
          icon={CreditCard}
          label="متوسط الطلب"
          delta={ticket !== null ? pctChange(ticket, prevTicket) : undefined}
          value={ticket === null ? <span className="text-xl text-muted">غير معروف</span> : <Money minor={ticket} currency />}
          sub="ما دفعه الزبائن ÷ عدد الطلبات، شاملاً الضريبة."
        />
        <KeyFigure
          icon={Clock}
          label="أكثر ساعة مبيعاً"
          value={busiest ? <span className="nums">{busiest.hour}:00</span> : <span className="text-xl text-muted">غير معروف</span>}
          sub={busiest ? <><T s="بيع فيها {0} هذا الشهر في {1}." a={[<Money key="0" minor={busiest.paidMinor} />, countNoun(busiest.orders, ORDER)]} /></> : undefined}
          href="#when"
        />
      </div>

      <Section title="يوماً بيوم" icon={CalendarDays} hint="ما دفعه الزبائن كل يوم، واليوم الذي لا يظهر له شريط لم تُسجَّل فيه طلبات.">
        <div className="overflow-x-auto rounded-2xl border border-line bg-raised p-4 shadow-raised">
          <ol className="flex h-40 min-w-[36rem] items-end gap-1" aria-label="مبيعات الأيام">
            {a.days.map((d) => (
              <li key={d.day} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${formatWeekday(d.day)} ${formatDay(d.day)}`}>
                <span className="sr-only"><T s="{0}: {1} ريال" a={[formatDay(d.day), formatRiyalsDisplay(d.paidMinor)]} /></span>
                <span aria-hidden className="block w-full rounded-t bg-accent/80 transition-colors group-hover:bg-accent" style={{ height: `${Math.max(2, (d.paidMinor / maxDay) * 100)}%` }} />
                <span aria-hidden className="mt-1 block text-center text-[9px] text-muted">{Number(d.day.slice(8, 10))}</span>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <div id="when" className="grid grid-cols-[minmax(0,1fr)] gap-x-6 lg:grid-cols-2">
        <Section title="متى يُباع، بالساعة" icon={Clock} hint="مجموع ما بيع في كل ساعة من ساعات اليوم خلال الشهر.">
          <ul className="space-y-1 rounded-2xl border border-line bg-raised p-4 shadow-raised">
            {a.hours.map((h) => (
              <li key={h.hour} className="grid grid-cols-[3rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-[12px]">
                <span className="nums text-muted" dir="ltr">{String(h.hour).padStart(2, "0")}:00</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-sunken"><span aria-hidden className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(1, (h.paidMinor / maxHour) * 100)}%` }} /></span>
                <span className="text-end font-bold"><Money minor={h.paidMinor} /></span>
              </li>
            ))}
          </ul>
        </Section>
        <div>
          <Section title="وحسب أيام الأسبوع" icon={CalendarDays} hint="متوسط اليوم الواحد، لأن مجموع الخميس في شهر فيه أربعة أيام خميس لا يُقارن بمجموع الجمعة في شهر فيه خمس جمع.">
            <ul className="space-y-1 rounded-2xl border border-line bg-raised p-4 shadow-raised">
              {weekdayAvg.map((w) => (
                <li key={w.weekday} className="grid grid-cols-[4.5rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-[12px]">
                  <span>{WEEKDAYS[w.weekday]}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-sunken"><span aria-hidden className="block h-full rounded-full bg-plum" style={{ width: `${Math.max(1, (w.avgMinor / maxWeekday) * 100)}%` }} /></span>
                  <span className="text-end font-bold"><Money minor={w.avgMinor} /></span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="طرق الدفع ونوع الطلب" icon={CreditCard}>
            <ul className="divide-y divide-line-soft rounded-2xl border border-line bg-raised px-4 shadow-raised">
              {a.methods.map((m) => (
                <li key={m.name} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px]">
                  <span>{m.type === 1 ? "نقد" : m.type === 5 ? "مشروبات الموظفين (House Account)" : m.name}{m.type === 5 && <span className="ms-1 text-[11px] text-muted">ليست إيراداً</span>}</span>
                  <span className="font-bold">
                    <Money minor={m.amountMinor} />
                    {m.type !== 5 && methodTotal > 0 && <span className="ms-2 text-[11px] font-normal text-muted">{formatShare(Math.round((m.amountMinor * 10_000) / methodTotal))}</span>}
                  </span>
                </li>
              ))}
              {a.types.map((t) => (
                <li key={`t${t.type}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px] text-ink-soft">
                  <span><T s="طلبات {0}: {1}" a={[t.label, t.orders.toLocaleString("en-US")]} /></span>
                  <span className="font-bold text-ink"><Money minor={t.paidMinor} /></span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 lg:grid-cols-3">
        <Mover title="ما ارتفع" icon={TrendingUp} items={risers} empty="لم يرتفع أي صنف عن الشهر السابق." />
        <Mover title="ما انخفض" icon={TrendingDown} items={fallers} empty="لم ينخفض أي صنف عن الشهر السابق." />
        <Section title="أضعف الهوامش" icon={Coffee} hint="من بين الأصناف التي بيع منها بثلاثمئة ريال فأكثر.">
          {weak.length === 0 ? <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">لا يوجد صنف له وصفة وتكلفة بعد.</p> : (
            <ul className="divide-y divide-line-soft rounded-2xl border border-line bg-raised px-4 shadow-raised">
              {weak.map((i) => (
                <li key={i.key} className="flex items-baseline justify-between gap-2 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate">{i.name}</span>
                  <span className="shrink-0 font-bold">{formatShare(i.marginBp)} <span className="text-[11px] font-normal text-muted"><T s="من {0}" a={[<Money key="0" minor={i.salesMinor} />]} /></span></span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="ما نقص من الإيراد" icon={Info} hint="وصفٌ لما حدث، وليس اتهاماً لأحد.">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Leak label="خصومات الطلبات" minor={a.leaks.discountMinor} sub={`خصمٌ على ${countNoun(a.leaks.discountedOrders, ORDER)}.`} />
          <Leak label="مبالغ أُعيدت للزبائن" minor={a.leaks.refundsMinor} sub={`مرتجعات: ${countNoun(a.leaks.refundOrders, ORDER)}.`} />
          <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised">
            <p className="text-[11px] font-bold text-muted">طلبات ملغاة</p>
            <p className="mt-2 text-lg font-semibold"><span className="nums">{a.leaks.voidOrders}</span></p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">لم تُحضَّر ولم يُدفع ثمنها. فودكس لا يحفظ مبلغ الطلب الملغى، لذلك نعرض عددها فقط.</p>
          </div>
          <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised">
            <p className="text-[11px] font-bold text-muted">مشروبات الموظفين</p>
            <p className="mt-2 text-lg font-semibold"><MaybeMoney minor={a.leaks.staffCostMinor} why="فيها صنف بلا وصفة" /></p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted"><T s="بتكلفتها، في {0}، وقيمتها بسعر القائمة {1}. هي استهلاك بلا إيراد، وتدخل في تكلفة المبيعات." a={[countNoun(a.leaks.staffOrders, ORDER), <Money key="1" minor={a.leaks.staffListMinor} />]} /></p>
          </div>
        </div>
      </Section>

      <Section title="الأصناف" icon={Utensils} count={a.items.length} hint="المبيعات بسعر الإيصال شاملة الضريبة وقبل خصم الطلب، والهامش محسوب على السعر بدون ضريبة وبتكلفة الوصفة.">
        {noRecipe.length > 0 && (
          <Callout tone="warn" icon={Info} className="mb-3" title={`${noRecipe.length} من الأصناف المباعة تكلفتها غير معروفة`}
            action={<LinkButton href="/inventory/recipes" size="sm">الوصفات</LinkButton>}>
            <T s="مبيعاتها {0} هذا الشهر. ليست لها وصفة، أو في وصفتها مكوّن بلا تكلفة، فهامشها {1} وليس صفراً." a={[<strong key="0"><Money minor={noRecipeMinor} /></strong>, <Unknown key="1" />]} /></Callout>
        )}
        <DataTable columns={itemColumns} rows={a.items} keyOf={(i) => i.key} sort={q.sort ?? null} searchOf={(i) => i.name} />
      </Section>
    </PageShell>
  );
}

function Mover({ title, icon, items, empty }: { title: string; icon: typeof TrendingUp; items: readonly (ItemRow & { delta: number })[]; empty: string }) {
  return (
    <Section title={title} icon={icon} hint="الفرق بالريال عن الشهر السابق.">
      {items.length === 0 ? <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">{empty}</p> : (
        <ul className="divide-y divide-line-soft rounded-2xl border border-line bg-raised px-4 shadow-raised">
          {items.map((i) => (
            <li key={i.key} className="flex items-baseline justify-between gap-2 py-2.5 text-[13px]">
              <span className="min-w-0 truncate">{i.name}</span>
              <span className="shrink-0 font-bold"><Money minor={i.delta} signed /></span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Leak({ label, minor, sub }: { label: string; minor: number; sub: string }) {
  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised">
      <p className="text-[11px] font-bold text-muted">{label}</p>
      <p className="mt-2 text-lg font-semibold"><Money minor={minor} /></p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">{sub}</p>
    </div>
  );
}
