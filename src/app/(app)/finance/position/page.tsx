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

export const dynamic = "force-dynamic";

const tillColumns: Column<TillRow>[] = [
  { key: "day", header: "اليوم", primary: true, cell: (t) => <bdi>{formatDay(t.day)}</bdi> },
  { key: "who", header: "فتحه", cell: (t) => t.userName ?? "—", secondary: true },
  { key: "expected", header: "المتوقّع في الدرج", numeric: true, cell: (t) => <MaybeMoney minor={t.expectedMinor} /> },
  { key: "counted", header: "المعدود", numeric: true, cell: (t) => (!t.closed ? <span className="text-[11px] text-muted">لم يقفل</span> : <MaybeMoney minor={t.countedMinor} />) },
  {
    key: "variance", header: "الفرق", numeric: true,
    cell: (t) => {
      if (!t.closed || t.varianceMinor === null) return <span className="text-[11px] text-muted">—</span>;
      /* أُقفل بلا عدّ: المعدودُ صفرٌ والمتوقَّعُ مال — «لم يُعَدّ» لا نقص */
      if (t.countedMinor === 0 && (t.expectedMinor ?? 0) > 0) return <span className="text-[11px] font-bold text-warn">أقفل بلا عدّ</span>;
      if (Math.abs(t.varianceMinor) < TILL_SMALL_MINOR) return <span className="text-[11px] text-muted">فكّة</span>;
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
    return <PageShell user={user} title="الوضع الآن"><NoAccess what="الوضع الماليّ" /></PageShell>;
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
    <PageShell user={user} width="wide" title="الوضع الآن" intro="ما في البنك، وما عليك للمورّدين، وضريبة الإقرار القادم، والنقد الذي لا يراه الكشف.">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyFigure
          icon={Landmark}
          label="رصيد البنك"
          tone={bankAge !== null && bankAge > 7 ? "warn" : undefined}
          value={pos.bank.balanceMinor === null ? <span className="text-xl text-muted">غير معروف</span> : <Money minor={pos.bank.balanceMinor} currency />}
          sub={pos.bank.asOf ? <>كما في آخر كشف مسوّى، <bdi>{formatDay(pos.bank.asOf)}</bdi>{bankAge !== null && bankAge > 7 && <> — مضى عليه {countNoun(bankAge, DAY)}، استورد كشفاً أحدث.</>}</> : "لا كشف مسوّىً برصيد ختاميّ بعد."}
          href="/bank"
        />
        <KeyFigure
          icon={HandCoins}
          label="عليك للمورّدين"
          tone={overdueMinor > 0 ? "warn" : undefined}
          value={<Money minor={totals.owedMinor} currency />}
          sub={<>لـ{countNoun(totals.owedSuppliers, SUPPLIER)}{overdueMinor > 0 && <> — منها <strong className="text-ink"><Money minor={overdueMinor} /></strong> تجاوزت ستّين يوماً</>}{totals.creditLeftMinor > 0 && <>. ولك عند مورّدين <Money minor={totals.creditLeftMinor} /></>}.</>}
          href="/suppliers"
        />
        <KeyFigure
          icon={Receipt}
          label={vatNext ? `ضريبة ${vatNext.label}` : "ضريبة الإقرار القادم"}
          value={vatNext ? (vatNext.amountMinor === null ? <span className="text-xl text-muted">غير معروف</span> : <Money minor={vatNext.amountMinor} currency />) : <span className="text-xl text-muted">لا إقرار معلّق</span>}
          sub={vatNext
            ? <>ضريبة المبيعات ناقصاً ضريبة المشتريات، كما يحسبها إقرار الضريبة{vatNext.accruing ? " حتى اليوم" : ""}. آخر موعد <bdi>{formatDay(vatNext.deadline)}</bdi>.{vatNext.amountMinor === null && " في الفترة أيّام بلا كشف بنك."}</>
            : "قدّم الربع المنقضي ولا شيء في الجاري بعد."}
          href="/close/vat"
        />
        <KeyFigure
          icon={Banknote}
          label="نقد قبضه فودكس ولم يدخل البنك"
          value={<Money minor={pos.cash.totalMinor} currency />}
          sub={<>منذ {pos.cash.firstDay ? <bdi>{formatDay(pos.cash.firstDay)}</bdi> : "البداية"}. لا إيداع نقد في الكشف — كم بقي منه لا يعرف من البيانات.</>}
          href="#cash"
        />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Section title="لمن تدين" icon={HandCoins} action={<LinkButton href="/payments" size="sm" variant="quiet">دفعة الشهر</LinkButton>}>
          {pos.suppliers.top.length === 0 ? (
            <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">لا مستحقّ لمورّد الآن.</p>
          ) : (
            <BarList items={pos.suppliers.top.map((s) => ({ key: s.supplierId, label: s.name, minor: s.owedMinor, href: `/suppliers/${s.supplierId}` }))} />
          )}
        </Section>

        <Section title="ما يحلّ" icon={CalendarClock} action={<LinkButton href="/cash/calendar" size="sm" variant="quiet">تقويم الالتزامات</LinkButton>}>
          <ul className="space-y-2">
            {pos.vat.map((v) => (
              <li key={v.periodKey} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-line bg-raised px-4 py-3 text-sm shadow-raised">
                <span>ضريبة {v.label}{v.accruing && <span className="ms-1 text-[11px] text-muted">(تتراكم)</span>} — حتى <bdi>{formatDay(v.deadline)}</bdi></span>
                <span className="font-bold"><MaybeMoney minor={v.amountMinor} why="أيّام بلا كشف" /></span>
              </li>
            ))}
            {pos.suppliers.overdue.slice(0, 5).map((o) => (
              <li key={o.supplierId} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm">
                <span>{o.nameAr} — أقدم فاتورة منذ {countNoun(o.oldestDays, DAY)}</span>
                <span className="font-bold"><Money minor={o.owedMinor} /></span>
              </li>
            ))}
            {pos.vat.length === 0 && pos.suppliers.overdue.length === 0 && (
              <li className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">لا ضريبة معلّقة ولا مورّد تأخّر مستحقّه.</li>
            )}
          </ul>
        </Section>
      </div>

      <Section id="cash" title="النقد والصندوق" icon={Banknote} hint="نقد المقهى كلّه خارج البنك: ما يقوله فودكس أنّه قبض، وما عدّ في الدرج عند الإقفال.">
        <Callout tone="info" icon={Info} title="ما يعرف وما لا يعرف">
          فودكس يعرف كم قبض نقداً وكم عدّ في الدرج عند كلّ إقفال. ولا يعرف أحد من البيانات أين ذهب النقد بعد الإقفال — صرف على المقهى أم أخذ.
          فإن كان يدفع منه راتب أو مشترى فأدخله في «ما لا يراه الكشف» ليدخل قائمة الدخل.
          {last && <> آخر عدّ: <bdi>{formatDay(last.day)}</bdi> — في الدرج <strong><MaybeMoney minor={last.countedMinor} /></strong> والمتوقّع <MaybeMoney minor={last.expectedMinor} />.</>}
          <div className="mt-3"><LinkButton href="/finance/inputs" size="sm">ما لا يراه الكشف</LinkButton></div>
        </Callout>

        {flagged.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="صناديق تحتاج نظرك">
            {flagged.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold">
                    صندوق <bdi>{formatDay(t.day)}</bdi>: {t.uncounted ? "أقفل بلا عدّ" : t.varianceMinor < 0 ? "المعدود أقلّ من المتوقّع بـ" : "المعدود أكثر من المتوقّع بـ"}
                    {!t.uncounted && <Money minor={Math.abs(t.varianceMinor)} />}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    {t.userName && <>فتحه {t.userName}. </>}
                    {t.uncounted ? <>فودكس يتوقّع فيه <Money minor={Math.abs(t.varianceMinor)} /> ولم يكتب ما عدّ.</> : "اسأل من أقفله: أعدّ؟ أأخذ منه ما لم يسجّل؟"} ما عرفت سببه أسكته فلا يعود.
                  </p>
                </div>
                {canSilence && <div className="flex shrink-0 flex-wrap items-center gap-1"><SignalControls signalKey={tillSignalKey(t.id)} dismissLabel="أعرف سببه" /></div>}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-raised shadow-raised">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] font-bold text-muted">
                <th className="px-4 py-2.5 text-start">الشهر</th>
                <th className="px-3 py-2.5 text-end">قبض نقداً</th>
                <th className="px-3 py-2.5 text-end">نقص عند العدّ</th>
                <th className="px-3 py-2.5 text-end">زيادة عند العدّ</th>
                <th className="px-4 py-2.5 text-end">أقفل بلا عدّ</th>
              </tr>
            </thead>
            <tbody>
              {[...pos.cash.months].reverse().map((m) => (
                <tr key={m.month} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 font-bold">{formatMonth(m.month)}</td>
                  <td className="px-3 py-2.5 text-end"><Money minor={m.cashMinor} /></td>
                  <td className="px-3 py-2.5 text-end">{m.shortMinor === 0 ? <span className="text-muted">—</span> : <Money minor={m.shortMinor} />}</td>
                  <td className="px-3 py-2.5 text-end">{m.overMinor === 0 ? <span className="text-muted">—</span> : <Money minor={m.overMinor} />}</td>
                  <td className="px-4 py-2.5 text-end">{m.uncounted === 0 ? <span className="text-muted">—</span> : <span className="font-bold text-warn">{m.uncounted} من {m.tills}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          النقص والزيادة لا يتقاصّان: درج زاد عشرين ودرج نقص عشرين مشكلتان لا صفر. وصندوق أقفل والمعدود صفر «لم يعدّ» — نقصه كلّ ما كان فيه، وليس دليلاً على ضياع.
        </p>

        <h3 className="mb-2 mt-6 text-sm font-bold">آخر الصناديق</h3>
        <DataTable columns={tillColumns} rows={pos.cash.recent} keyOf={(t) => t.id} />
      </Section>
    </PageShell>
  );
}
