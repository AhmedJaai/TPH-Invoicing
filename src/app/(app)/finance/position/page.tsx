import { Fragment } from "react";
import { redirect } from "next/navigation";
import { Banknote, CalendarClock, HandCoins, Info, Landmark, Receipt } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney } from "@/components/finance-bits";
import { BarList, Callout, DataTable, KeyFigure, LinkButton, NoAccess, Section, type Column } from "@/components/ui";
import { DAY, SUPPLIER, countNoun } from "@/lib/arabic";
import { daysSinceRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadFinancePosition, TILL_SMALL_MINOR, type TillRow } from "@/services/finance-position.service";
import { loadFinanceAttentionFacts, tillSignalKey } from "@/services/finance-attention.service";
import { SignalControls } from "@/components/signal-controls";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const tillColumns: Column<TillRow>[] = [
  { key: "day", header: "اليوم", primary: true, cell: (t) => <bdi>{formatDay(t.day)}</bdi> },
  { key: "who", header: "فتحه", cell: (t) => t.userName ?? "—", secondary: true },
  { key: "expected", header: "المتوقع في الدرج", numeric: true, cell: (t) => <MaybeMoney minor={t.expectedMinor} /> },
  { key: "counted", header: "المعدود", numeric: true, cell: (t) => (!t.closed ? <span className="text-[11px] text-muted">لم يُقفل</span> : <MaybeMoney minor={t.countedMinor} />) },
  {
    key: "variance", header: "الفرق", numeric: true,
    cell: (t) => {
      if (!t.closed || t.varianceMinor === null) return <span className="text-[11px] text-muted">—</span>;
      /* أُقفل بلا عدّ: المعدودُ صفرٌ والمتوقَّعُ مال — «لم يُعَدّ» لا نقص */
      if (t.countedMinor === 0 && (t.expectedMinor ?? 0) > 0) return <span className="text-[11px] font-bold text-warn">أُقفل بلا عدّ</span>;
      /* «فكّة» كانت تُقال فوق فرقٍ صفر وفوق سبعة عشر ريالاً معاً — المطابقُ يُسمّى، والصغيرُ يُرى رقمُه خافتاً */
      if (t.varianceMinor === 0) return <span className="text-[11px] text-ok">مطابق</span>;
      if (Math.abs(t.varianceMinor) < TILL_SMALL_MINOR) return <span className="text-muted"><Money minor={t.varianceMinor} signed /> <span className="text-[11px]">فكّة</span></span>;
      return <Money minor={t.varianceMinor} signed />;
    },
  },
];

/**
 * الوضعُ الآن — «كم عندي، كم عليّ، وما الذي يحلّ؟» في شاشةٍ واحدة.
 * كلُّ رقمٍ من مصدره القائم (`finance-position.service.ts`) ويفتح صفحتَه.
 */
export default async function FinancePositionPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/position");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="الوضع الآن"><NoAccess what="الوضع المالي" /></PageShell>;
  }
  const [pos, attention] = await Promise.all([loadFinancePosition(), loadFinanceAttentionFacts()]);
  const flagged = attention.tillGaps;
  const canSilence = can(user.role, "bank:edit");
  const bankAge = pos.bank.asOf ? daysSinceRiyadh(pos.bank.asOf) : null;
  const totals = pos.suppliers.totals;
  const overdueMinor = pos.suppliers.overdue.reduce((s, o) => s + o.owedMinor, 0);
  const vatNext = pos.vat.find((v) => !v.accruing) ?? pos.vat[0] ?? null;
  const last = pos.cash.lastTill;

  return (
    <PageShell user={user} width="wide" title="الوضع الآن" intro="رصيد البنك، والمستحق للمورّدين، وضريبة الإقرار القادم، والنقد الذي لا يظهر في كشف البنك.">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyFigure
          icon={Landmark}
          label="رصيد البنك"
          tone={bankAge !== null && bankAge > 7 ? "warn" : undefined}
          value={pos.bank.balanceMinor === null ? <span className="text-xl text-muted">غير معروف</span> : <Money minor={pos.bank.balanceMinor} currency />}
          sub={pos.bank.asOf ? <><T s="حسب آخر كشف تمت تسويته، {0}{1}" a={[<bdi key="0">{formatDay(pos.bank.asOf)}</bdi>, bankAge !== null && bankAge > 7 && <Fragment key="1"><T s=". مرّ عليه {0}، فاستورد كشفاً أحدث." a={[countNoun(bankAge, DAY)]} /></Fragment>]} /></> : "لا يوجد بعد كشف مسوّى برصيد ختامي."}
          href="/bank"
        />
        <KeyFigure
          icon={HandCoins}
          label="المستحق للمورّدين"
          tone={overdueMinor > 0 ? "warn" : undefined}
          value={<Money minor={totals.owedMinor} currency />}
          sub={<><T s="لـ{0}{1}{2}." a={[countNoun(totals.owedSuppliers, SUPPLIER), overdueMinor > 0 && <Fragment key="1"><T s="، منها {0} تجاوزت ستين يوماً" a={[<strong key="0" className="text-ink"><Money minor={overdueMinor} /></strong>]} /></Fragment>, totals.creditLeftMinor > 0 && <Fragment key="2"><T s=". ولك رصيد عند بعض المورّدين {0}" a={[<Money key="0" minor={totals.creditLeftMinor} />]} /></Fragment>]} /></>}
          href="/suppliers"
        />
        <KeyFigure
          icon={Receipt}
          label={vatNext ? `ضريبة ${vatNext.label}` : "ضريبة الإقرار القادم"}
          value={vatNext ? (vatNext.amountMinor === null ? <span className="text-xl text-muted">غير معروف</span> : <Money minor={vatNext.amountMinor} currency />) : <span className="text-xl text-muted">لا يوجد إقرار مستحق</span>}
          sub={vatNext
            ? <><T s="ضريبة المبيعات مطروحاً منها ضريبة المشتريات، كما يحسبها الإقرار الضريبي{0}. آخر موعد {1}.{2}" a={[vatNext.accruing ? " حتى اليوم" : "", <bdi key="1">{formatDay(vatNext.deadline)}</bdi>, vatNext.amountMinor === null && " في الفترة أيام بلا كشف بنك."]} /></>
            : "قُدّم إقرار الربع الماضي، ولا يوجد شيء في الربع الحالي بعد."}
          href="/close/vat"
        />
        <KeyFigure
          icon={Banknote}
          label="نقد سجّله فودكس ولم يدخل البنك"
          value={<Money minor={pos.cash.totalMinor} currency />}
          sub={<><T s="منذ {0}. لا توجد في الكشف إيداعات نقدية، والبيانات لا تبيّن كم بقي منه." a={[pos.cash.firstDay ? <bdi key="0">{formatDay(pos.cash.firstDay)}</bdi> : "البداية"]} /></>}
          href="#cash"
        />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Section title="لمن تدين" icon={HandCoins} action={<LinkButton href="/payments" size="sm" variant="quiet">دفعة الشهر</LinkButton>}>
          {pos.suppliers.top.length === 0 ? (
            <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">لا توجد مبالغ مستحقة لأي مورّد الآن.</p>
          ) : (
            <BarList items={pos.suppliers.top.map((s) => ({ key: s.supplierId, label: s.name, minor: s.owedMinor, href: s.slug ? `/suppliers/${encodeURIComponent(s.slug)}` : "/suppliers" }))} />
          )}
        </Section>

        <Section title="المستحقات القادمة" icon={CalendarClock} action={<LinkButton href="/cash/calendar" size="sm" variant="quiet">تقويم الالتزامات</LinkButton>}>
          <ul className="space-y-2">
            {pos.vat.map((v) => (
              <li key={v.periodKey} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-line bg-raised px-4 py-3 text-sm shadow-raised">
                <span><T s="ضريبة {0}{1}، حتى {2}" a={[v.label, v.accruing && <span key="1" className="text-[11px] text-muted"> (تتراكم)</span>, <bdi key="2">{formatDay(v.deadline)}</bdi>]} /></span>
                <span className="font-bold"><MaybeMoney minor={v.amountMinor} why="أيام بلا كشف" /></span>
              </li>
            ))}
            {pos.suppliers.overdue.slice(0, 5).map((o) => (
              <li key={o.supplierId} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm">
                <span><T s="{0}: أقدم فاتورة منذ {1}" a={[o.nameAr, countNoun(o.oldestDays, DAY)]} /></span>
                <span className="font-bold"><Money minor={o.owedMinor} /></span>
              </li>
            ))}
            {pos.vat.length === 0 && pos.suppliers.overdue.length === 0 && (
              <li className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">لا ضريبة معلّقة، ولا مورّد تأخر سداد مستحقاته.</li>
            )}
          </ul>
        </Section>
      </div>

      <Section id="cash" title="النقد والصندوق" icon={Banknote} hint="كل نقد المقهى خارج البنك: ما سجّله فودكس نقداً، وما عُدّ في الدرج عند الإقفال.">
        <Callout tone="info" icon={Info} title="ما نعرفه وما لا نعرفه">
          <T s="يعرف فودكس كم دخل نقداً وكم عُدّ في الدرج عند كل إقفال، لكن البيانات لا تبيّن أين ذهب النقد بعد الإقفال: هل صُرف على المقهى أم سُحب. فإن كنت تدفع منه رواتب أو مشتريات فأدخلها في «ما لا يظهر في الكشف» لتدخل في قائمة الدخل.{0}{1}" a={[last && <Fragment key="0"> <T s=" آخر عدّ: {0}، وفي الدرج {1} والمتوقع {2}." a={[<bdi key="0">{formatDay(last.day)}</bdi>, <strong key="1"><MaybeMoney minor={last.countedMinor} /></strong>, <MaybeMoney key="2" minor={last.expectedMinor} />]} /></Fragment>, <div key="1" className="mt-3"><LinkButton href="/finance/inputs" size="sm">ما لا يظهر في الكشف</LinkButton></div>]} /></Callout>

        {flagged.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="صناديق تحتاج مراجعتك">
            {flagged.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold">
                    <T s="صندوق {0}: {1}{2}" a={[<bdi key="0">{formatDay(t.day)}</bdi>, t.uncounted ? "أُقفل بلا عدّ" : t.varianceMinor < 0 ? "المعدود أقل من المتوقع بـ " : "المعدود أكثر من المتوقع بـ ", !t.uncounted && <Money key="2" minor={Math.abs(t.varianceMinor)} />]} /></p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    <T s="{0}{1} وإن كنت تعرف السبب فاضغط «أعرف السبب» ولن يظهر التنبيه مرة أخرى." a={[t.userName && <Fragment key="0"><T s="فتحه {0}. " a={[t.userName]} /></Fragment>, t.uncounted ? <Fragment key="1"><T s="يتوقع فودكس فيه {0}، ولم يُسجَّل المبلغ المعدود." a={[<Money key="0" minor={Math.abs(t.varianceMinor)} />]} /></Fragment> : "اسأل من أقفله: هل عدّ المبلغ؟ وهل أخذ منه شيئاً دون تسجيله؟"]} /></p>
                </div>
                {canSilence && <div className="flex shrink-0 flex-wrap items-center gap-1"><SignalControls signalKey={tillSignalKey(t.id)} dismissLabel="أعرف السبب" /></div>}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-raised shadow-raised">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] font-bold text-muted">
                <th className="px-4 py-2.5 text-start">الشهر</th>
                <th className="px-3 py-2.5 text-end">المقبوض نقداً</th>
                <th className="px-3 py-2.5 text-end">نقص عند العدّ</th>
                <th className="px-3 py-2.5 text-end">زيادة عند العدّ</th>
                <th className="px-4 py-2.5 text-end">أُقفل بلا عدّ</th>
              </tr>
            </thead>
            <tbody>
              {[...pos.cash.months].reverse().map((m) => (
                <tr key={m.month} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 font-bold">{formatMonth(m.month)}</td>
                  <td className="px-3 py-2.5 text-end"><Money minor={m.cashMinor} /></td>
                  <td className="px-3 py-2.5 text-end">{m.shortMinor === 0 ? <span className="text-muted">—</span> : <Money minor={m.shortMinor} />}</td>
                  <td className="px-3 py-2.5 text-end">{m.overMinor === 0 ? <span className="text-muted">—</span> : <Money minor={m.overMinor} />}</td>
                  <td className="px-4 py-2.5 text-end">{m.uncounted === 0 ? <span className="text-muted">—</span> : <span className="font-bold text-warn"><T s="{0} من {1}" a={[m.uncounted, m.tills]} /></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          النقص والزيادة لا يُلغي أحدهما الآخر: إذا زاد درج عشرين ونقص آخر عشرين فهما مشكلتان لا صفر. والصندوق الذي أُقفل ومبلغه المعدود صفر يعني أنه «لم يُعدّ»، وليس بالضرورة أن المال ضاع.
        </p>

        <h3 className="mb-2 mt-6 text-sm font-bold">آخر الصناديق</h3>
        <DataTable columns={tillColumns} rows={pos.cash.recent} keyOf={(t) => t.id} />
      </Section>
    </PageShell>
  );
}
