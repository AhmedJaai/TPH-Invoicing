import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity, CalendarDays, CalendarRange, Clock, Coffee, Database, FlaskConical, Info, Sparkles, Target, TrendingUp, TriangleAlert,
} from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Callout, DataTable, EmptyState, KeyFigure, NoAccess, Section, type Column } from "@/components/ui";
import { ForecastEventForm, ForecastEventVoid } from "@/components/forecast-event-form";
import { formatShare, formatUnits } from "@/lib/finance/format";
import { FORECAST_EVENT_LABEL, isForecastEventKind } from "@/lib/forecast/events";
import { BUSINESS_HOURS, errorBp, nowcastDay, type Nowcast } from "@/lib/forecast/nowcast";
import { formatDay, formatMoment, formatMonth, formatWeekday } from "@/lib/riyadh-time";
import {
  loadForecastView, type ForecastAccuracyRow, type ForecastBand, type ForecastDay, type ForecastItem, type ForecastMonth,
} from "@/services/forecast.service";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORIZON_LABEL: Record<string, string> = { D1: "الغد", D2_7: "الأسبوع", D8_31: "الشهر", H_D1: "ساعات الغد" };
const MODEL_LABEL: Record<string, string> = {
  ensemble: "المزيج (ما يُعرض)", chronos: "Chronos-2 (أمازون)", gbm: "أشجار لكلّ السلاسل", gbm_tot: "أشجار للمجاميع",
  gbm_nowx: "أشجار بلا طقس", glm: "انحدار بالتقويم", ets: "تمهيد أُسّيّ", dow_median: "وسيط اليوم نفسه",
};

/** كمّيّةٌ متوقَّعة بمنزلةٍ عشريّةٍ واحدة — «٢٫٢٨٣ كابتشينو» دقّةٌ كاذبة. */
function qty(milli: number): string {
  return formatUnits(Math.round(milli / 100) * 100);
}

function Range({ b, money = true }: { b: ForecastBand; money?: boolean }) {
  return (
    <span className="nums whitespace-nowrap text-[11px] text-muted">
      {/* «بين … و…» لا «… – …»: الشَّرطةُ بين رقمين في سطرٍ عربيّ تقلب ترتيبهما للعين */}
      بين {money ? <Money minor={b.p10} /> : qty(b.p10)} و{money ? <Money minor={b.p90} /> : qty(b.p90)}
    </span>
  );
}

function pct(bp: number | null): string {
  return bp === null ? "غير معروف" : formatShare(Math.abs(bp));
}

const add = (a: ForecastBand, b: ForecastBand): ForecastBand => ({ p10: a.p10 + b.p10, p50: a.p50 + b.p50, p90: a.p90 + b.p90 });
const ZERO: ForecastBand = { p10: 0, p50: 0, p90: 0 };

/** إقفالُ الشهر: الفعليُّ قبل اليوم + اليومُ (الحيُّ إن وُجد) + ما بعده. */
function monthClose(m: ForecastMonth, live: Nowcast | null): ForecastBand {
  const today = m.today ? live ?? m.today : ZERO;
  return add(add({ p10: m.actualMinor, p50: m.actualMinor, p90: m.actualMinor }, today), m.rest);
}

/**
 * التوقّع — صفحةٌ منعزلة تعرض المتوقَّع ولا تقرّر شيئاً (أحمد، ٢٥ نوفمبر ٢٠٢٦).
 * يكتبها المحرّكُ الليليّ (`forecast/`) في جداولها وحدها، ولا تقرؤها شاشةٌ أخرى.
 * يومُ العمل يبدأ الخامسةَ فجراً كبقيّة التطبيق («نبض المقهى»): الثانيةُ فجرَ الخميس ما زالت الأربعاء.
 */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/forecast");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="التوقّع"><NoAccess what="التوقّع" /></PageShell>;
  }
  const q = await searchParams;
  const v = await loadForecastView({ day: q.day && DAY_RE.test(q.day) ? q.day : undefined });
  const canEdit = can(user.role, "forecast:edit");
  const intro = "ما يُتوقَّع أن يُباع اليوم وكلَّ يومٍ وساعةٍ وصنف، وبكم يُقفل الشهر وما بعده، ومدى الثقة في كلّ رقم وكم أصاب في الماضي. صفحةٌ للنظر وحدها: لا تغيّر رقماً ولا قراراً في غيرها.";

  if (!v.run) {
    return (
      <PageShell user={user} width="wide" title="التوقّع" intro={intro}>
        <EmptyState
          icon={Sparkles}
          title="لم يصدر تنبّؤٌ بعد."
          hint="يصدر كلَّ يومٍ في الخامسة والنصف فجراً بتوقيت الرياض، بعد أن يُغلق يوم العمل. يتعلّم من مبيعات فودكس والتقويم والطقس وأحداث جدّة، ثمّ يكتب هنا."
          action={canEdit ? <ForecastEventForm products={v.products} /> : undefined}
        />
      </PageShell>
    );
  }

  const run = v.run;
  const today = v.today;
  const month = today.slice(0, 7);
  const stale = run.issuedOn < today;
  const todayRow = v.days.find((d) => d.day === today) ?? null;
  const live = todayRow && v.todayHours.length > 0 ? nowcastDay(v.todayHours, v.todaySold, v.nowHour, todayRow) : null;
  const thisMonth = v.months.find((m) => m.period === month) ?? null;
  const nextMonth = v.months.find((m) => m.period > month) ?? null;
  const next12 = v.months.filter((m) => m.period > month).slice(0, 12);
  const next12Band = next12.reduce((s, m) => add(s, m.rest), ZERO);
  const lastFull = [...v.pastMonths].reverse().find((m) => m.period < month && m.days >= 28) ?? null;
  const close = thisMonth ? monthClose(thisMonth, live) : null;

  const ens = (h: string, metric = "NET_MINOR") => v.backtests.find((b) => b.model === "ensemble" && b.series === "total" && b.metric === metric && b.horizon === h) ?? null;
  const d1 = ens("D1");
  const liveErr = v.accuracy.length
    ? Math.round(v.accuracy.reduce((s, a) => s + Math.abs(a.forecast.p50 - a.actualMinor), 0) / Math.max(1, v.accuracy.reduce((s, a) => s + a.actualMinor, 0)) * 10_000)
    : null;
  const inside = v.accuracy.filter((a) => a.actualMinor >= a.forecast.p10 && a.actualMinor <= a.forecast.p90).length;
  const summary = run.summary as {
    notes?: string[]; trainingDays?: number;
    months?: { NET_MINOR?: { backtest?: { period: string; errorPct: number }[]; effects?: Record<string, number> } };
  };
  const monthTests = summary.months?.NET_MINOR?.backtest ?? [];
  const effects = summary.months?.NET_MINOR?.effects ?? {};
  const members = Array.isArray((run.models as { members?: unknown }).members) ? (run.models as { members: string[] }).members : [];

  const itemCols: Column<ForecastItem>[] = [
    { key: "name", header: "الصنف", primary: true, cell: (i) => i.name, sortBy: (i) => i.name },
    { key: "d0", header: "اليوم", numeric: true, cell: (i) => i.days[0] ? <span className="nums font-bold">{qty(i.days[0].p50)}</span> : "—", sortBy: (i) => i.days[0]?.p50 ?? null },
    { key: "d1", header: "غداً", numeric: true, cell: (i) => i.days[1] ? <span className="nums">{qty(i.days[1].p50)}</span> : "—", sortBy: (i) => i.days[1]?.p50 ?? null },
    { key: "week", header: "سبعة أيّام", numeric: true, cell: (i) => <span className="nums">{qty(i.week.p50)}</span>, sortBy: (i) => i.week.p50 },
    { key: "range", header: "مدى اليوم", cell: (i) => i.days[0] ? <Range b={i.days[0]} money={false} /> : "—", secondary: true },
  ];

  const accCols: Column<ForecastAccuracyRow>[] = [
    { key: "day", header: "اليوم", primary: true, cell: (a) => formatWeekday(a.day), sortBy: (a) => a.day },
    { key: "fc", header: "المتوقَّع صباحه", numeric: true, cell: (a) => <Money minor={a.forecast.p50} />, sortBy: (a) => a.forecast.p50 },
    { key: "act", header: "ما بيع", numeric: true, cell: (a) => <Money minor={a.actualMinor} />, sortBy: (a) => a.actualMinor },
    {
      key: "err", header: "الفرق", numeric: true,
      cell: (a) => {
        const e = errorBp(a.forecast.p50, a.actualMinor);
        return <span className={e !== null && Math.abs(e) > 2000 ? "font-bold text-warn" : ""}>{e === null ? "—" : `${e > 0 ? "أعلى" : "أقلّ"} ${pct(e)}`}</span>;
      },
      sortBy: (a) => Math.abs(errorBp(a.forecast.p50, a.actualMinor) ?? 0),
    },
    { key: "in", header: "داخل المدى؟", cell: (a) => (a.actualMinor >= a.forecast.p10 && a.actualMinor <= a.forecast.p90 ? "نعم" : <span className="font-bold text-warn">لا</span>), secondary: true },
  ];

  /* ساعاتُ اليوم التي لم تأتِ بعد لا «بيع فيها صفر» — مجهولةٌ حتى تأتي */
  const nowPos = BUSINESS_HOURS.indexOf(v.nowHour);
  const hoursSorted = [...v.hours]
    .sort((a, b) => BUSINESS_HOURS.indexOf(a.hour) - BUSINESS_HOURS.indexOf(b.hour))
    .map((h) => (h.actualMinor !== null && BUSINESS_HOURS.indexOf(h.hour) > nowPos ? { ...h, actualMinor: null } : h));
  const selected = v.days.find((d) => d.day === v.selectedDay) ?? null;
  const maxHour = Math.max(1, ...v.hours.map((h) => Math.max(h.p90, h.actualMinor ?? 0)));
  const maxP90 = Math.max(1, ...v.days.map((d) => d.p90));
  const healthIssues = (v.health.lastSyncOk === false ? 1 : 0) + (v.health.emptyDays.length > 0 ? 1 : 0) + (stale ? 1 : 0);
  const monthNote = (m: ForecastMonth) => [
    ...m.tags,
    ...m.unmeasured.map((u) => `${u}: بلا مثالٍ سابق، والمدى أعرض`),
    m.source === "structural" ? "تقديرٌ بالمستوى الحاليّ" : m.source === "mixed" ? "أوّلُه يوماً بيوم وآخرُه بالمستوى" : "",
  ].filter(Boolean).join(" · ");

  return (
    <PageShell user={user} width="wide" title="التوقّع" intro={intro} actions={canEdit ? <ForecastEventForm products={v.products} /> : undefined}>
      {stale && (
        <Callout tone="warn" icon={TriangleAlert} title="التنبّؤ أقدم من يوم العمل" className="mb-4">
          صدر آخرُ تنبّؤٍ يوم {formatDay(run.issuedOn)}، ولم يصدر تنبّؤُ الليلة. ما مضى منذ ذلك صار واقعاً لا يُعرض توقّعاً.
        </Callout>
      )}

      {/* ─── الأسئلة الأربعة: اليوم · الشهر · القادم · السنة ─── */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyFigure
          icon={Activity}
          label="اليوم"
          period={formatWeekday(today)}
          value={live ? <Money minor={live.p50} currency /> : todayRow ? <Money minor={todayRow.p50} currency /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={live
            ? <>بيع حتى الآن <strong className="text-ink"><Money minor={live.soldMinor} /></strong>، والباقي متوقَّع. المدى <Range b={live} />.</>
            : todayRow ? <>المدى <Range b={todayRow} />.</> : "لا تنبّؤ لهذا اليوم."}
          href={`/finance/forecast?day=${today}#hours`}
        />
        <KeyFigure
          icon={CalendarDays}
          label="يُقفل هذا الشهر عند"
          period={thisMonth ? formatMonth(thisMonth.period) : undefined}
          value={close ? <Money minor={close.p50} currency /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={close && thisMonth
            ? <>بيع منه <strong className="text-ink"><Money minor={thisMonth.actualMinor} /></strong> حتى أمس. المدى <Range b={close} />.{lastFull ? <> وأُقفل {formatMonth(lastFull.period)} عند <Money minor={lastFull.actualMinor} />.</> : null}</>
            : "يظهر من تنبّؤ الليلة."}
          href="#months"
        />
        <KeyFigure
          icon={CalendarRange}
          label="الشهر القادم"
          period={nextMonth ? formatMonth(nextMonth.period) : undefined}
          value={nextMonth ? <Money minor={nextMonth.rest.p50} currency /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={nextMonth ? <>المدى <Range b={nextMonth.rest} />.{monthNote(nextMonth) ? <> {monthNote(nextMonth)}.</> : null}</> : "يظهر من تنبّؤ الليلة."}
          href="#months"
        />
        <KeyFigure
          icon={TrendingUp}
          label="الاثنا عشر شهراً القادمة"
          value={next12.length === 12 ? <Money minor={next12Band.p50} currency /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={next12.length === 12 ? <>من {formatMonth(next12[0].period)} إلى {formatMonth(next12[11].period)}، بالمستوى الحاليّ. المدى المتحفّظ <Range b={next12Band} />.</> : "يظهر من تنبّؤ الليلة."}
          href="#months"
        />
      </div>

      {/* ─── الأشهر ─── */}
      {v.months.length > 0 && (
        <Section id="months" title="الأشهر: ما بيع وما يُتوقَّع" icon={TrendingUp}
          hint="العمودُ الممتلئ ما بيع فعلاً، والفاتحُ ما يُتوقَّع، والإطارُ حوله المدى. الشهرُ الجاري: ما بيع حتى أمس + اليوم + الباقي.">
          <YearTotals past={v.pastMonths} months={v.months} month={month} live={live} />
          {/* الشهرُ الذي لم يُفتح فيه المقهى أيّاماً كاملة (مايو، الافتتاح) لا يُرسم شهراً: يبدو هبوطاً وهو بداية */}
          <MonthsChart past={v.pastMonths.filter((m) => m.period < month && m.days >= 28)} months={v.months} live={live} />
          <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {v.months.slice(0, 14).map((m) => {
              const b = m.period === month ? monthClose(m, live) : m.rest;
              const note = monthNote(m);
              return (
                <li key={m.period} className="rounded-xl border border-line bg-raised px-3 py-2 text-xs">
                  <span className="flex items-baseline justify-between gap-2">
                    <strong>{formatMonth(m.period)}</strong>
                    <span className="text-[13px] font-bold"><Money minor={b.p50} /></span>
                  </span>
                  <span className="mt-0.5 block"><Range b={b} /></span>
                  {(m.period === month || note) && (
                    <span className="mt-1 block leading-relaxed text-muted">
                      {m.period === month ? <>بيع منه حتى أمس <Money minor={m.actualMinor} />{note ? " · " : ""}</> : null}
                      {note}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            المبالغ ما دفعه الزبائن شاملاً الضريبة، كما في فودكس. والأشهرُ البعيدة بالمستوى الحاليّ ونمطِ أيّام الأسبوع وأثرِ الصيف والإجازات كما قيس
            {Object.keys(effects).length ? <> (الصيف {signedPct(effects.summer)} · الإجازة القصيرة {signedPct(effects.break_short)} · الإجازة الرسمية {signedPct(effects.holiday)})</> : null}
            ، ولا يُفترض اتّجاهٌ صاعد أو هابط.
            {monthTests.length ? <> وقيس الشهرُ القادم على أشهرٍ مضت: {monthTests.map((t) => `${formatMonth(t.period)} ${t.errorPct > 0 ? "+" : ""}${t.errorPct}٪`).join(" · ")}.</> : null}
          </p>
        </Section>
      )}

      {/* ─── الأيّام ─── */}
      <Section id="days" title="الشهر القادم يوماً بيوم" icon={CalendarDays} hint="العمودُ الداكن هو المتوقَّع، والفاتح حوله المدى الذي يقع فيه البيع ثمانيَ مرّاتٍ من عشر. النقطة: يومٌ فيه حدث. اضغط يوماً لترى ساعاته وسببَ رقمه.">
        <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised">
          <ol className="flex h-48 items-end gap-[2px] sm:gap-1" aria-label="المبيعات المتوقَّعة يوماً بيوم">
            {v.days.map((d) => <DayBar key={d.day} d={d} max={maxP90} selected={d.day === v.selectedDay} today={d.day === today} />)}
          </ol>
        </div>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {v.days.filter((d) => (d.context?.tags?.length ?? 0) > 0 || (d.context?.events?.length ?? 0) > 0).slice(0, 12).map((d) => (
            <Link key={d.day} href={`/finance/forecast?day=${d.day}#hours`} className="rounded-xl border border-line bg-raised px-3 py-2 text-xs transition-colors hover:border-accent-line">
              <span className="flex items-center justify-between gap-2">
                <strong>{formatWeekday(d.day)}</strong>
                <span className="font-bold"><Money minor={d.p50} /></span>
              </span>
              <span className="mt-1 block leading-relaxed text-muted">
                {[...(d.context?.tags ?? []), ...(d.context?.events ?? []).map((e) => e.label)].join(" · ")}
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {selected && (
        <Section id="hours" title={`ساعات ${formatWeekday(selected.day)}`} icon={Clock}
          hint={selected.day === today ? "المتوقَّعُ لكلّ ساعة، وبجانبه ما بيع فعلاً حتى آخر قراءةٍ من فودكس. يومُ العمل من الخامسة فجراً إلى الخامسة فجراً." : "المتوقَّعُ لكلّ ساعة: نصيبُها من اليوم كما في الأسابيع الأخيرة وحالِ المدارس."}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <ul className="space-y-1 rounded-2xl border border-line bg-raised p-4 shadow-raised">
              {hoursSorted.filter((h) => h.p50 > 0 || (h.actualMinor ?? 0) > 0).map((h) => (
                <li key={h.hour} className="grid grid-cols-[3rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-[12px]">
                  <span className={`nums ${h.hour === v.nowHour && selected.day === today ? "font-bold text-accent" : "text-muted"}`} dir="ltr">{String(h.hour).padStart(2, "0")}:00</span>
                  <span className="relative h-3 overflow-hidden rounded-full bg-sunken">
                    <span aria-hidden className="absolute inset-y-0 start-0 rounded-full bg-accent/25" style={{ width: `${(h.p90 / maxHour) * 100}%` }} />
                    <span aria-hidden className="absolute inset-y-0 start-0 rounded-full bg-accent" style={{ width: `${Math.max(1, (h.p50 / maxHour) * 100)}%` }} />
                    {h.actualMinor !== null && h.actualMinor > 0 && (
                      <span aria-hidden className="absolute inset-y-[3px] start-0 rounded-full bg-ink/70" style={{ width: `${(h.actualMinor / maxHour) * 100}%` }} />
                    )}
                  </span>
                  <span className="text-end">
                    <span className="font-bold"><Money minor={h.p50} /></span>
                    {h.actualMinor !== null && <span className="block text-[10px] text-muted">بيع <Money minor={h.actualMinor} /></span>}
                  </span>
                </li>
              ))}
            </ul>
            <DayExplain d={selected} />
          </div>
        </Section>
      )}

      {v.items.length > 0 && (
        <Section title="الأصناف" icon={Coffee} hint="كم يُتوقَّع أن يُباع من كلّ صنف. الصنفُ القليل البيع يتذبذب طبيعياً: خطؤه لا ينزل عن ربعه مهما دقّ النموذج.">
          <DataTable columns={itemCols} rows={v.items} keyOf={(i) => i.id} searchOf={(i) => i.name} searchLabel="ابحث عن صنف" />
        </Section>
      )}

      <Section id="accuracy" title="كم أصاب؟" icon={Target} hint="لكلّ يومٍ مضى: ما توقّعه صباحَ ذلك اليوم، وما بيع فعلاً.">
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
          <MiniStat label="خطأ الغد في الاختبار" value={d1 ? formatShare(d1.wapeBp) : "—"} sub={d1 ? `على ${d1.n} يوماً لم يرها` : undefined} />
          <MiniStat label="في الأيّام الفعليّة" value={liveErr !== null ? formatShare(liveErr) : "—"} sub={v.accuracy.length ? `${v.accuracy.length} يوماً، داخل المدى ${inside}` : "تتراكم من الليلة"} />
          <MiniStat label="أدنى خطأٍ ممكن" value="8٪" sub="عشوائيّةُ الزبائن والفاتورة لا يتنبّأ بها شيء" />
        </div>
        {v.accuracy.length > 0
          ? <DataTable columns={accCols} rows={v.accuracy} keyOf={(a) => a.day} />
          : <EmptyState compact icon={Target} title="لا أيّامَ فعليّةً بعد" hint="يظهر هنا كلُّ يومٍ بعد أن ينتهي: ما توقّعه صباحَه وما بيع فعلاً." />}
        <details className="mt-4 rounded-2xl border border-line bg-raised p-4 shadow-raised">
          <summary className="cursor-pointer text-xs font-bold">خطأُ كلّ نموذجٍ في الاختبار على الماضي</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-[12px]">
              <thead><tr className="text-muted">
                <th className="py-1 text-start font-medium">النموذج</th>
                {["D1", "D2_7", "D8_31"].map((h) => <th key={h} className="py-1 text-end font-medium">{HORIZON_LABEL[h]}</th>)}
              </tr></thead>
              <tbody>
                {["ensemble", ...members].map((m) => (
                  <tr key={m} className={m === "ensemble" ? "font-bold" : ""}>
                    <td className="py-1">{MODEL_LABEL[m] ?? m}</td>
                    {["D1", "D2_7", "D8_31"].map((h) => {
                      const b = v.backtests.find((x) => x.model === m && x.series === "total" && x.metric === "NET_MINOR" && x.horizon === h);
                      return <td key={h} className="nums py-1 text-end">{b ? formatShare(b.wapeBp) : "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {ens("D1", "ORDERS") && <p className="mt-2 text-[11px] text-muted">وخطأُ الطلبات للغد {formatShare(ens("D1", "ORDERS")!.wapeBp)}.</p>}
          </div>
        </details>
      </Section>

      <Section id="health" title="صحّةُ البيانات" icon={Database} count={healthIssues || undefined}
        hint="ما يقوم عليه كلُّ رقمٍ في الصفحة: هل قُرئت المبيعات، وهل في التاريخ أيّامٌ ناقصة، ومتى صدر التنبّؤ.">
        <ul className="divide-y divide-line rounded-2xl border border-line bg-raised text-xs shadow-raised">
          <HealthRow ok={v.health.lastSyncOk !== false} title="آخر قراءة من فودكس"
            body={v.health.lastSyncAt ? <>{formatMoment(v.health.lastSyncAt)}{v.health.lastSyncOk === false ? " — لم تكتمل، فما بيع اليوم قد يكون ناقصاً" : ""}. تُقرأ كلَّ ساعة، فما بيع في آخر ساعةٍ قد لا يظهر بعد.</> : "لم تُقرأ بعد."} />
          <HealthRow ok title="آخر يوم فيه مبيعات" body={v.health.lastSaleDay ? formatWeekday(v.health.lastSaleDay) : "غير معروف"} />
          <HealthRow ok={v.health.emptyDays.length === 0} title="أيّامٌ بلا طلبٍ واحد في آخر ستّين يوماً"
            body={v.health.emptyDays.length === 0 ? "لا شيء — التاريخ متّصل."
              : <>{v.health.emptyDays.map((d) => formatDay(d)).join("، ")}. إن كان المقهى مغلقاً فسجّله «إغلاقاً» حتى لا يتعلّمه التنبّؤ نمطاً؛ وإلّا فالقراءةُ ناقصة.</>} />
          <HealthRow ok={!stale} title="آخر تنبّؤ"
            body={<>صدر {formatMoment(run.createdAt)} من تاريخٍ حتى {formatDay(run.historyTo)}{run.durationMs ? ` في ${Math.round(run.durationMs / 60000)} دقيقة` : ""}. يصدر كلَّ يومٍ في الخامسة والنصف فجراً.</>} />
          <HealthRow ok title="أحداثٌ قادمة مسجَّلة" body={<>{v.health.upcomingEvents} بيدك، وأحداثُ جدّة والمباريات يجمعها وكيلٌ كلَّ أحدٍ وأربعاء.</>} />
        </ul>
      </Section>

      <Section title="ما يعرفه وما سُجّل" icon={Info} hint="أحداثٌ تسجّلها أنت: الإغلاقُ والنفادُ يُصحّحان ما يتعلّمه، والفعاليّةُ يتعلّم أثرَها.">
        {v.events.length === 0
          ? <EmptyState compact icon={CalendarDays} title="لا أحداثَ مسجّلة" hint="إغلاقٌ لصيانة، أو صنفٌ نفد في منتصف اليوم، أو فعاليّةٌ قريبة: سجّلها فيتعلّم التنبّؤ منها بدل أن يظنّها عادة." action={canEdit ? <ForecastEventForm products={v.products} /> : undefined} />
          : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-raised shadow-raised">
              {v.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                  <span>
                    <strong>{isForecastEventKind(e.kind) ? FORECAST_EVENT_LABEL[e.kind] : e.kind}</strong>: {e.label}
                    {e.productName && <> — {e.productName}{e.fromHour !== null && <> من الساعة <span className="nums">{e.fromHour}</span></>}</>}
                    <span className="ms-2 text-muted">{e.fromDay === e.toDay ? formatDay(e.fromDay) : `${formatDay(e.fromDay)} إلى ${formatDay(e.toDay)}`}</span>
                  </span>
                  {canEdit && <ForecastEventVoid id={e.id} label={e.label} />}
                </li>
              ))}
            </ul>
          )}
      </Section>

      <Section title="كيف يُصنع" icon={FlaskConical}>
        <div className="rounded-2xl border border-line bg-raised p-4 text-xs leading-relaxed text-ink-soft shadow-raised">
          <p>
            كلَّ ليلة يقرأ المحرّكُ مبيعاتِ فودكس بالساعة منذ {formatDay(run.historyFrom)} ({summary.trainingDays ?? "—"} يوماً)،
            والتقويمَ الهجريّ والإجازاتِ الرسمية والمدرسية ويومَ الراتب، والطقسَ (ما وقع، وتنبّؤَ 16 يوماً، ثمّ المعتاد)، وأحداثَ جدّة والمباريات الكبرى.
            ثمّ يمزج أربعة نماذج متنوّعة اختارها الاختبار، ويصحّح الغدَ بخطأ اليوم الذي انتهى. والأشهرُ البعيدة بالمستوى الحاليّ وأثرِ التقويم المقيس.
          </p>
          {summary.notes?.length ? <ul className="mt-2 list-disc space-y-1 ps-5">{summary.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          <p className="mt-2 text-muted">الإصدار {run.engineVersion}.</p>
        </div>
      </Section>
    </PageShell>
  );
}

function signedPct(x: number | undefined): string {
  if (x === undefined) return "—";
  const v = Math.round(x * 100);
  return `${v >= 0 ? "+" : "−"}${Math.abs(v)}٪`;
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-raised px-4 py-3 shadow-raised">
      <p className="text-[11px] font-bold text-muted">{label}</p>
      <p className="nums mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function HealthRow({ ok, title, body }: { ok: boolean; title: string; body: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>{ok ? "سليم" : "انتبه"}</span>
      <span className="min-w-0">
        <strong className="block">{title}</strong>
        <span className="text-muted">{body}</span>
      </span>
    </li>
  );
}

/** السنتان كاملتين: الجاريةُ ما بيع منها + ما يُتوقَّع لباقيها، والقادمةُ كلُّها متوقَّعة. */
function YearTotals({ past, months, month, live }: { past: { period: string; actualMinor: number }[]; months: ForecastMonth[]; month: string; live: Nowcast | null }) {
  const year = Number(month.slice(0, 4));
  const thisYear = months.filter((m) => m.period.startsWith(String(year))).reduce((s, m) => add(s, m.period === month ? monthClose(m, live) : m.rest), ZERO);
  const pastThisYear = past.filter((p) => p.period.startsWith(String(year)) && p.period < month).reduce((s, p) => s + p.actualMinor, 0);
  const cur = add({ p10: pastThisYear, p50: pastThisYear, p90: pastThisYear }, thisYear);
  const nextMonths = months.filter((m) => m.period.startsWith(String(year + 1)));
  const next = nextMonths.reduce((s, m) => add(s, m.rest), ZERO);
  return (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-line bg-raised px-4 py-3 shadow-raised">
        <p className="text-[11px] font-bold text-muted">سنة {year} تُقفل عند</p>
        <p className="mt-1 text-xl font-semibold"><Money minor={cur.p50} currency /></p>
        <p className="mt-0.5 text-[11px] text-muted">بيع منها <Money minor={pastThisYear} /> قبل هذا الشهر (منذ الافتتاح في مايو). المدى <Range b={cur} />.</p>
      </div>
      <div className="rounded-2xl border border-line bg-raised px-4 py-3 shadow-raised">
        <p className="text-[11px] font-bold text-muted">سنة {year + 1} كاملة</p>
        <p className="mt-1 text-xl font-semibold">{nextMonths.length === 12 ? <Money minor={next.p50} currency /> : "غير معروف"}</p>
        <p className="mt-0.5 text-[11px] text-muted">{nextMonths.length === 12 ? <>بالمستوى الحاليّ وأثرِ التقويم المقيس، ورمضانُ وعيدُ الفطر بلا مثالٍ سابق. المدى المتحفّظ <Range b={next} />.</> : "تحتاج أشهرها الاثني عشر في التنبّؤ."}</p>
      </div>
    </div>
  );
}

function MonthsChart({ past, months, live }: { past: { period: string; actualMinor: number }[]; months: ForecastMonth[]; live: Nowcast | null }) {
  const rows = [
    ...past.map((p) => ({ period: p.period, actual: p.actualMinor, band: null as ForecastBand | null })),
    ...months.slice(0, 13).map((m) => ({ period: m.period, actual: m.actualMinor, band: m.actualMinor > 0 || m.today ? monthClose(m, live) : m.rest })),
  ];
  const max = Math.max(1, ...rows.map((r) => Math.max(r.actual, r.band?.p90 ?? 0)));
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-raised p-4 shadow-raised">
      <ol className="flex h-52 min-w-[36rem] items-end gap-2" aria-label="المبيعات بالشهر">
        {rows.map((r) => {
          const top = r.band?.p50 ?? r.actual;
          return (
            <li key={r.period} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={formatMonth(r.period)}>
              <span className="relative block w-full" style={{ height: `${(top / max) * 100}%` }}>
                <span aria-hidden className={`absolute inset-0 rounded-t ${r.band ? "bg-accent/30" : "bg-accent/85"}`} />
                {r.band && r.actual > 0 && (
                  <span aria-hidden className="absolute inset-x-0 bottom-0 rounded-t bg-accent/85" style={{ height: `${(r.actual / Math.max(1, top)) * 100}%` }} />
                )}
                {r.band && (
                  <span aria-hidden className="absolute inset-x-[30%] rounded-sm border border-accent/60"
                    style={{ bottom: `${(r.band.p10 / Math.max(1, top)) * 100}%`, height: `${((r.band.p90 - r.band.p10) / Math.max(1, top)) * 100}%` }} />
                )}
              </span>
              <span className="mt-1 block truncate text-center text-[9px] text-muted">{formatMonth(r.period)}</span>
              <span className="sr-only">{formatMonth(r.period)}: {Math.round(top / 100)} ريال</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DayBar({ d, max, selected, today }: { d: ForecastDay; max: number; selected: boolean; today: boolean }) {
  const weekend = [4, 5].includes(new Date(`${d.day}T12:00:00Z`).getUTCDay());
  const flagged = (d.context?.tags?.length ?? 0) > 0 || (d.context?.events?.length ?? 0) > 0;
  return (
    <li className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
      <Link
        href={`/finance/forecast?day=${d.day}#hours`}
        aria-current={selected ? "true" : undefined}
        title={formatWeekday(d.day)}
        className="group relative flex h-full flex-col justify-end rounded-t focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="sr-only">{formatWeekday(d.day)}</span>
        <span aria-hidden className={`relative block w-full rounded-t ${selected ? "bg-accent/35" : "bg-accent/15 group-hover:bg-accent/25"}`} style={{ height: `${(d.p90 / max) * 100}%` }}>
          <span className={`absolute inset-x-0 bottom-0 block rounded-t ${selected ? "bg-accent" : weekend ? "bg-accent/85" : "bg-accent/60 group-hover:bg-accent/80"}`} style={{ height: `${(d.p50 / Math.max(1, d.p90)) * 100}%` }} />
        </span>
        <span aria-hidden className={`mt-1 block text-center text-[9px] ${today ? "font-bold text-accent" : "text-muted"} ${Number(d.day.slice(8, 10)) % 2 === 0 ? "max-sm:invisible" : ""}`}>
          {Number(d.day.slice(8, 10))}
        </span>
        {flagged && <span aria-hidden className="absolute -top-1.5 start-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-warn" />}
      </Link>
    </li>
  );
}

function DayExplain({ d }: { d: ForecastDay }) {
  const c = d.context;
  const drivers = c?.drivers ?? [];
  const maxAbs = Math.max(1, ...drivers.map((x) => Math.abs(x.minor)));
  return (
    <div className="rounded-2xl border border-line bg-raised p-4 text-xs shadow-raised">
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-bold">{formatWeekday(d.day)}{c?.hijri ? <span className="ms-1 font-normal text-muted">({c.hijri} هـ)</span> : null}</span>
        <span className="text-base font-bold"><Money minor={d.p50} /></span>
      </p>
      <p className="mt-1 text-muted">المدى <Range b={d} />{d.orders ? <> · نحو <span className="nums">{d.orders.p50}</span> طلباً</> : null}</p>
      {c?.tags?.length ? <p className="mt-2 leading-relaxed">{c.tags.join(" · ")}</p> : null}
      {c?.events?.length ? (
        <ul className="mt-2 space-y-1">
          {c.events.map((e) => <li key={e.label}><a href={e.source} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-accent">{e.label}</a></li>)}
        </ul>
      ) : null}
      {c?.weather && (c.weather.t_max !== null) && (
        <p className="mt-2 text-muted">
          {c.weatherKind === "normal" ? "الطقس المعتاد لهذا الوقت" : c.weatherKind === "forecast" ? "تنبّؤ الطقس" : "الطقس"}: العظمى <span className="nums">{c.weather.t_max}</span>°، والرطوبة <span className="nums">{c.weather.humidity ?? "—"}</span>٪
          {c.weather.rain_mm ? <>، ومطر <span className="nums">{c.weather.rain_mm}</span> مم</> : null}.
        </p>
      )}
      {drivers.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 font-bold">ما يرفع الرقم وما يخفضه</p>
          <ul className="space-y-1">
            {drivers.map((x) => (
              <li key={x.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_5rem] items-center gap-2">
                <span className="truncate text-muted">{x.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-sunken">
                  <span aria-hidden className={`block h-full rounded-full ${x.minor >= 0 ? "bg-ok" : "bg-warn"}`} style={{ width: `${(Math.abs(x.minor) / maxAbs) * 100}%` }} />
                </span>
                <span className={`text-end font-bold ${x.minor >= 0 ? "text-ok" : "text-warn"}`}>{x.minor >= 0 ? "+" : "−"}<Money minor={Math.abs(x.minor)} /></span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-muted">من نموذج الأشجار وحده (قيم SHAP)، فهي تقريبٌ لما يحرّك الرقم لا تقسيمٌ له.</p>
        </div>
      )}
    </div>
  );
}
