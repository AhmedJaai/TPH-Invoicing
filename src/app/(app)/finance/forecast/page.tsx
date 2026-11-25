import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, CalendarDays, CalendarRange, Clock, Coffee, FlaskConical, Info, Sparkles, Target, TriangleAlert } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Callout, DataTable, EmptyState, KeyFigure, NoAccess, Section, type Column } from "@/components/ui";
import { ForecastEventForm, ForecastEventVoid } from "@/components/forecast-event-form";
import { formatShare, formatUnits } from "@/lib/finance/format";
import { FORECAST_EVENT_LABEL, isForecastEventKind } from "@/lib/forecast/events";
import { BUSINESS_HOURS, errorBp, nowcastDay } from "@/lib/forecast/nowcast";
import { formatDay, formatMoment, formatWeekday } from "@/lib/riyadh-time";
import { loadForecastView, type ForecastAccuracyRow, type ForecastBand, type ForecastDay, type ForecastItem } from "@/services/forecast.service";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_NOW = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Riyadh", hour: "numeric", hourCycle: "h23" });
const HORIZON_LABEL: Record<string, string> = { D1: "الغد", D2_7: "الأسبوع", D8_31: "الشهر", H_D1: "ساعات الغد" };
const MODEL_LABEL: Record<string, string> = {
  ensemble: "المزيج (ما يُعرض)", chronos: "Chronos-2 (أمازون)", gbm: "أشجار لكلّ السلاسل", gbm_tot: "أشجار للمجاميع",
  gbm_nowx: "أشجار بلا طقس", glm: "انحدار بالتقويم", ets: "تمهيد أُسّيّ", dow_median: "وسيط اليوم نفسه",
};

function Range({ b, money = true }: { b: ForecastBand; money?: boolean }) {
  return (
    <span className="nums whitespace-nowrap text-[11px] text-muted">
      {/* «بين … و…» لا «… – …»: الشَّرطةُ بين رقمين في سطرٍ عربيّ تقلب ترتيبهما للعين */}
      بين {money ? <Money minor={b.p10} /> : qty(b.p10)} و{money ? <Money minor={b.p90} /> : qty(b.p90)}
    </span>
  );
}

/** كمّيّةٌ متوقَّعة بمنزلةٍ عشريّةٍ واحدة — «٢٫٢٨٣ كابتشينو» دقّةٌ كاذبة. */
function qty(milli: number): string {
  return formatUnits(Math.round(milli / 100) * 100);
}

function pct(bp: number | null): string {
  return bp === null ? "غير معروف" : formatShare(Math.abs(bp));
}

/**
 * التوقّع — صفحةٌ منعزلة تعرض المتوقَّع ولا تقرّر شيئاً (أحمد، ٢٥ نوفمبر ٢٠٢٦).
 * يكتبها المحرّكُ الليليّ (`forecast/`) في جداولها وحدها، ولا تقرؤها شاشةٌ أخرى.
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
  const intro = "ما يُتوقَّع أن يُباع كلَّ يومٍ وساعةٍ وصنف في الشهر القادم، ومدى الثقة فيه، وكم أصاب في الماضي. صفحةٌ للنظر وحدها: لا تغيّر رقماً ولا قراراً في غيرها.";

  if (!v.run) {
    return (
      <PageShell user={user} width="wide" title="التوقّع" intro={intro}>
        <EmptyState
          icon={Sparkles}
          title="لم يصدر تنبّؤٌ بعد."
          hint="يصدر كلَّ ليلةٍ في الرابعة فجراً بتوقيت الرياض، بعد أن يُغلق يوم العمل. يتعلّم من مبيعات فودكس والتقويم والطقس وأحداث جدّة، ثمّ يكتب هنا."
          action={canEdit ? <ForecastEventForm products={v.products} /> : undefined}
        />
      </PageShell>
    );
  }

  const run = v.run;
  const today = v.today;
  const stale = run.issuedOn < today;
  const todayRow = v.days.find((d) => d.day === today) ?? null;
  const tomorrowRow = v.days.find((d) => d.day > today) ?? null;
  const nowHour = Number(HOUR_NOW.format(new Date()));
  const live = todayRow && v.todayHours.length > 0 ? nowcastDay(v.todayHours, v.todaySold, nowHour, todayRow) : null;
  const week = v.days.filter((d) => d.day >= today).slice(0, 7);
  const weekP50 = week.reduce((s, d) => s + d.p50, 0);
  const weekOrders = week.reduce((s, d) => s + (d.orders?.p50 ?? 0), 0);
  const ens = (h: string, metric = "NET_MINOR") => v.backtests.find((b) => b.model === "ensemble" && b.series === "total" && b.metric === metric && b.horizon === h) ?? null;
  const d1 = ens("D1");
  const liveErr = v.accuracy.length
    ? Math.round(v.accuracy.reduce((s, a) => s + Math.abs(a.forecast.p50 - a.actualMinor), 0) / Math.max(1, v.accuracy.reduce((s, a) => s + a.actualMinor, 0)) * 10_000)
    : null;
  const inside = v.accuracy.filter((a) => a.actualMinor >= a.forecast.p10 && a.actualMinor <= a.forecast.p90).length;
  const maxP90 = Math.max(1, ...v.days.map((d) => d.p90));
  const selected = v.days.find((d) => d.day === v.selectedDay) ?? null;
  const maxHour = Math.max(1, ...v.hours.map((h) => Math.max(h.p90, h.actualMinor ?? 0)));
  /* ساعاتُ اليوم التي لم تأتِ بعد لا «بيع فيها صفر» — مجهولةٌ حتى تأتي */
  const nowPos = BUSINESS_HOURS.indexOf(nowHour);
  const hoursSorted = [...v.hours]
    .sort((a, b) => BUSINESS_HOURS.indexOf(a.hour) - BUSINESS_HOURS.indexOf(b.hour))
    .map((h) => (h.actualMinor !== null && BUSINESS_HOURS.indexOf(h.hour) > nowPos ? { ...h, actualMinor: null } : h));
  const summary = run.summary as { headline?: Record<string, { wapeBp: number }>; notes?: string[]; trainingDays?: number };
  const members = Array.isArray((run.models as { members?: unknown }).members) ? (run.models as { members: string[] }).members : [];

  const itemCols: Column<ForecastItem>[] = [
    { key: "name", header: "الصنف", primary: true, cell: (i) => i.name, sortBy: (i) => i.name },
    { key: "d0", header: run.issuedOn === today ? "اليوم" : formatWeekday(run.issuedOn), numeric: true, cell: (i) => i.days[0] ? <span className="nums font-bold">{qty(i.days[0].p50)}</span> : "—", sortBy: (i) => i.days[0]?.p50 ?? null },
    { key: "d1", header: "التالي", numeric: true, cell: (i) => i.days[1] ? <span className="nums">{qty(i.days[1].p50)}</span> : "—", sortBy: (i) => i.days[1]?.p50 ?? null },
    { key: "week", header: "سبعة أيّام", numeric: true, cell: (i) => <span className="nums">{qty(i.week.p50)}</span>, sortBy: (i) => i.week.p50 },
    { key: "range", header: "مدى اليوم الأوّل", cell: (i) => i.days[0] ? <Range b={i.days[0]} money={false} /> : "—", secondary: true },
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

  return (
    <PageShell user={user} width="wide" title="التوقّع" intro={intro} actions={canEdit ? <ForecastEventForm products={v.products} /> : undefined}>
      {stale && (
        <Callout tone="warn" icon={TriangleAlert} title="التنبّؤ أقدم من اليوم" className="mb-4">
          صدر آخرُ تنبّؤٍ يوم {formatDay(run.issuedOn)}، ولم يصدر تنبّؤُ الليلة. الأرقام أدناه من ذلك اليوم، والتنبّؤ الحيّ لليوم غير متاح.
        </Callout>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyFigure
          icon={Activity}
          label="اليوم"
          period={todayRow ? formatWeekday(today) : undefined}
          value={live ? <Money minor={live.p50} currency /> : todayRow ? <Money minor={todayRow.p50} currency /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={live
            ? <>بيع حتى الآن <strong className="text-ink"><Money minor={live.soldMinor} /></strong>، والباقي متوقَّع. المدى <Range b={live} />.</>
            : todayRow ? <>المدى <Range b={todayRow} />.</> : "لا تنبّؤ لهذا اليوم."}
          href={`/finance/forecast?day=${today}#hours`}
        />
        <KeyFigure
          icon={CalendarDays}
          label="غداً"
          period={tomorrowRow ? formatWeekday(tomorrowRow.day) : undefined}
          value={tomorrowRow ? <Money minor={tomorrowRow.p50} currency /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={tomorrowRow ? <>المدى <Range b={tomorrowRow} />{tomorrowRow.orders ? <> · نحو <span className="nums">{tomorrowRow.orders.p50}</span> طلباً</> : null}{tomorrowRow.context?.tags?.length ? <> · {tomorrowRow.context.tags.join("، ")}</> : null}.</> : undefined}
          href={tomorrowRow ? `/finance/forecast?day=${tomorrowRow.day}#hours` : undefined}
        />
        <KeyFigure
          icon={CalendarRange}
          label="الأيام السبعة القادمة"
          value={week.length ? <Money minor={weekP50} currency /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={week.length ? <>مجموعُ المتوقَّع لكلّ يوم، ونحو <span className="nums">{weekOrders.toLocaleString("en-US")}</span> طلباً.</> : undefined}
          href="#days"
        />
        <KeyFigure
          icon={Target}
          label="كم يخطئ"
          value={d1 ? <span>{formatShare(d1.wapeBp)}</span> : <span className="text-xl text-muted">غير معروف</span>}
          sub={<>
            متوسّطُ خطأ تنبّؤ الغد في اختبارٍ على {d1?.n ?? "—"} يوماً لم يرها.
            {liveErr !== null ? <> وفي آخر {v.accuracy.length} أيّامٍ فعلاً: {formatShare(liveErr)}، وداخل المدى {inside} منها.</> : " ولم تتراكم أيّامٌ فعليّة بعد."}
          </>}
          href="#accuracy"
        />
      </div>

      <Section id="days" title="الشهر القادم يوماً بيوم" icon={CalendarDays} hint="العمودُ الداكن هو المتوقَّع، والفاتح حوله المدى الذي يقع فيه البيع ثمانيَ مرّاتٍ من عشر. اضغط يوماً لترى ساعاته.">
        <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised">
          <ol className="flex h-48 items-end gap-[2px] sm:gap-1" aria-label="المبيعات المتوقَّعة يوماً بيوم">
            {v.days.map((d) => <DayBar key={d.day} d={d} max={maxP90} selected={d.day === v.selectedDay} today={d.day === today} />)}
          </ol>
        </div>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {v.days.filter((d) => d.day >= today && ((d.context?.tags?.length ?? 0) > 0 || (d.context?.events?.length ?? 0) > 0)).slice(0, 9).map((d) => (
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
          hint={selected.day === today ? "المتوقَّعُ لكلّ ساعة، وبجانبه ما بيع فعلاً حتى الآن." : "المتوقَّعُ لكلّ ساعة: نصيبُها من اليوم كما في الأسابيع الأخيرة وحالِ المدارس."}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <ul className="space-y-1 rounded-2xl border border-line bg-raised p-4 shadow-raised">
              {hoursSorted.map((h) => (
                <li key={h.hour} className="grid grid-cols-[3rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-[12px]">
                  <span className="nums text-muted" dir="ltr">{String(h.hour).padStart(2, "0")}:00</span>
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
        {v.accuracy.length > 0
          ? <DataTable columns={accCols} rows={v.accuracy} keyOf={(a) => a.day} />
          : <EmptyState compact icon={Target} title="لا أيّامَ فعليّةً بعد" hint="يظهر هنا كلُّ يومٍ بعد أن ينتهي: ما توقّعه صباحَه وما بيع فعلاً." />}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-raised p-4 shadow-raised">
          <p className="mb-2 text-xs font-bold">الاختبار على الماضي: خطأُ كلِّ نموذجٍ لو تنبّأ بأيّامٍ لم يرها</p>
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
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            أدنى خطأٍ ممكن للدخل اليوميّ نحو 8٪: عشوائيّةُ عدد الزبائن مضروبةً في تفاوت الفاتورة لا يتنبّأ بها شيء.
            {ens("D1", "ORDERS") && <> وخطأُ الطلبات للغد {formatShare(ens("D1", "ORDERS")!.wapeBp)}.</>}
          </p>
        </div>
      </Section>

      <Section title="ما يعرفه وما سُجّل" icon={Info} hint="أحداثٌ يراها التنبّؤ: من الأخبار، وممّا تسجّله أنت. الإغلاقُ والنفادُ يُصحّحان ما يتعلّمه.">
        {v.events.length === 0
          ? <EmptyState compact icon={CalendarDays} title="لا أحداثَ مسجّلة" hint="إغلاقٌ لصيانة، أو صنفٌ نفد في منتصف اليوم، أو فعاليّةٌ قريبة: سجّلها فيتعلّم التنبّؤ منها بدل أن يظنّها عادة." action={canEdit ? <ForecastEventForm products={v.products} /> : undefined} />
          : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-raised shadow-raised">
              {v.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                  <span>
                    <strong>{isForecastEventKind(e.kind) ? FORECAST_EVENT_LABEL[e.kind] : e.kind}</strong>: {e.label}
                    {e.productName && <> — {e.productName}{e.fromHour !== null && <> من الساعة <span className="nums">{e.fromHour}</span></>}</>}
                    <span className="ms-2 text-muted">{e.fromDay === e.toDay ? formatDay(e.fromDay) : `${formatDay(e.fromDay)} – ${formatDay(e.toDay)}`}</span>
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
            والتقويمَ الهجريّ والإجازاتِ الرسمية والمدرسية ويومَ الراتب، والطقسَ (ما وقع، وتنبّؤَ 16 يوماً، ثمّ المعتاد)، وأحداثَ جدّة.
            ثمّ يمزج أربعة نماذج متنوّعة اختارها الاختبار، ويصحّح الغدَ بخطأ اليوم الذي انتهى.
          </p>
          {summary.notes?.length ? <ul className="mt-2 list-disc space-y-1 ps-5">{summary.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          <p className="mt-2 text-muted">صدر {formatMoment(run.createdAt)} · الإصدار {run.engineVersion}{run.durationMs ? ` · في ${Math.round(run.durationMs / 1000)} ثانية` : ""}.</p>
        </div>
      </Section>
    </PageShell>
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
        title={`${formatWeekday(d.day)}`}
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
          الطقس {c.weatherKind === "normal" ? "(المعتاد لهذا الوقت)" : c.weatherKind === "forecast" ? "(تنبّؤ)" : ""}: العظمى <span className="nums">{c.weather.t_max}</span>°، والرطوبة <span className="nums">{c.weather.humidity ?? "—"}</span>٪
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
