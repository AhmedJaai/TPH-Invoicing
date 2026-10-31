import { redirect } from "next/navigation";
import { Fragment } from "react";
import { Activity, Gauge, HandCoins, Landmark, Percent, Sparkles, Timer, TrendingUp, Undo2 } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney } from "@/components/finance-bits";
import { Badge, BarList, Callout, Card, DataTable, EmptyState, KeyFigure, LinkButton, NoAccess, Section, type Column, type Tone } from "@/components/ui";
import { BENCHMARKS, formatDuration, formatShare, verdictOf, type Benchmark, type MonthKpi, type Verdict } from "@/lib/finance/performance";
import { ORDER, countNoun } from "@/lib/arabic";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadPerformance } from "@/services/performance.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  BETTER: { label: "أفضل من المعتاد", tone: "ok" },
  WITHIN: { label: "ضمن المعتاد", tone: "muted" },
  WORSE: { label: "أسوأ من المعتاد", tone: "warn" },
  SUSPECT: { label: "أبعد من المعتاد بكثير — تحقّق", tone: "warn" },
};

/** ما يُقال تحت رقمٍ أحسنَ من المعتاد بكثير — في الغالب ما غاب عن الدفاتر لا ما تحقّق. */
const SUSPECT_WHY: Partial<Record<Benchmark["key"], string>> = {
  netMargin: "هامشٌ بهذا العلوّ نادر في المقاهي، فتحقّق قبل أن تبني عليه: ما دُفع من نقد الصندوق (رواتب أو مشتريات) لا يظهر تكلفةً لأنه لم يمرّ بالبنك، والفواتير التي لم تُرفع، وعملك أنت بلا راتب.",
  labour: "رواتبٌ بهذا الانخفاض تعني غالباً أنّ بعضها لم يُسجَّل: نقدٌ من الصندوق، أو موظفون لم يُضافوا إلى المسيّر، أو عملك أنت بلا راتب.",
  cogs: "تكلفةٌ بهذا الانخفاض تعني غالباً مشتريات لم تُرفع فواتيرها، أو جرداً لم يكتمل.",
  prime: "تكلفةٌ أساسية بهذا الانخفاض تعني غالباً رواتب أو مشتريات غائبة عن الدفاتر.",
  rent: "إيجارٌ بهذا الانخفاض يعني غالباً أنّه لم يُسجَّل لكل الأشهر.",
};

/** مبلغٌ بعملته، والمجهولُ «غير معروف» لا صفر. */
function Riyals({ minor }: { minor: number | null }) {
  return minor === null ? <span className="text-xl text-muted">غير معروف</span> : <Money minor={minor} currency />;
}

const ratio = (bp: number | null) => (bp === null ? <span className="text-muted">غير معروف</span> : <span className="nums">{formatShare(bp)}</span>);

const monthColumns: Column<MonthKpi>[] = [
  { key: "month", header: "الشهر", primary: true, cell: (m) => <span className="font-bold">{formatMonth(m.month)}{m.open && <span className="ms-1 text-[11px] font-normal text-muted">حتى اليوم</span>}</span> },
  { key: "revenue", header: "الإيراد بلا ضريبة", numeric: true, cell: (m) => <MaybeMoney minor={m.revenueMinor} /> },
  { key: "orders", header: "الطلبات", numeric: true, cell: (m) => (m.orders === null ? "—" : <span className="nums">{m.orders}</span>) },
  { key: "ticket", header: "متوسط الطلب", numeric: true, cell: (m) => <MaybeMoney minor={m.ticketMinor} /> },
  { key: "cogs", header: "تكلفة المبيعات", numeric: true, cell: (m) => ratio(m.cogsBp) },
  { key: "labour", header: "الرواتب", numeric: true, cell: (m) => ratio(m.labourBp) },
  { key: "rent", header: "الإيجار", numeric: true, cell: (m) => ratio(m.rentBp) },
  { key: "fees", header: "رسوم الشبكة", numeric: true, secondary: true, cell: (m) => ratio(m.cardFeeBp) },
  {
    key: "profit", header: "الربح", numeric: true,
    cell: (m) => (
      <span className="block">
        <MaybeMoney minor={m.profitMinor} />
        {m.profitMinor !== null && <span className="block text-[10px] font-normal text-muted">{m.profitLabel}</span>}
      </span>
    ),
  },
  { key: "margin", header: "الهامش", numeric: true, cell: (m) => ratio(m.netMarginBp) },
];

function BenchmarkCard({ b, value, display }: { b: Benchmark; value: number | null; display: string }) {
  const v = verdictOf(value, b);
  /* شريطُ النطاق: المعتادُ مظلَّلٌ في وسطه، والرقمُ علامةٌ عليه — بلا رقمٍ لا علامة */
  const span = b.high * 2;
  const at = value === null ? null : Math.min(100, Math.max(0, (value / span) * 100));
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-bold text-muted">{b.label}</p>
        {v ? <Badge tone={VERDICT[v].tone} dot>{VERDICT[v].label}</Badge> : <Badge tone="muted">لا يُحكم عليه</Badge>}
      </div>
      <p className="nums mt-2 text-2xl font-semibold tracking-tight">{display}</p>
      <div className="relative mt-3 h-2 rounded-full bg-sunken" aria-hidden>
        <div className="absolute inset-y-0 rounded-full bg-accent-soft" style={{ insetInlineStart: `${(b.low / span) * 100}%`, width: `${((b.high - b.low) / span) * 100}%` }} />
        {at !== null && <div className="absolute -top-1 h-4 w-1 rounded-full bg-ink" style={{ insetInlineStart: `calc(${at}% - 2px)` }} />}
      </div>
      {v === "SUSPECT" && SUSPECT_WHY[b.key] && <p className="mt-3 text-[11px] font-bold leading-relaxed text-warn">{SUSPECT_WHY[b.key]}</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-muted">{b.note}.</p>
    </Card>
  );
}

/**
 * الأداء — كلُّ جانبٍ من المقهى بنسبته، بجانب المعتاد في مقاهي القهوة المختصّة.
 *
 * فوق «الربح» لا بدله: هناك «كم ربحتُ هذا الشهر ولماذا»، وهنا «أين أنا من المعتاد،
 * وما الذي يتحرّك شهراً بعد شهر». وكلُّ رقمٍ من خدمته (`performance.service.ts`)، والمرجعُ
 * عامٌّ يُقال إنّه عامّ. ولا أسعارَ مورّدين هنا: قراءةُ بنود الفواتير لا تحتمل حكماً بعد.
 */
export default async function PerformancePage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/performance");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="الأداء"><NoAccess what="أداء المقهى" /></PageShell>;
  }
  const perf = await loadPerformance({ canSeePayroll: can(user.role, "payroll:view") });
  const k = perf.latest;
  const prev = k ? perf.months.filter((m) => m.month < k.month && !m.open).at(-1) ?? null : null;
  const s30 = perf.speed.last30.speed;
  const sPrev = perf.speed.previous30.speed;
  const advisor = can(user.role, "month:close");

  if (!k) {
    return (
      <PageShell user={user} width="wide" title="الأداء">
        <EmptyState icon={Activity} title="لا شهر مكتمل المبيعات بعد." hint="يظهر الأداء بعد أن يقرأ النظام مبيعات شهر كامل من فودكس." />
      </PageShell>
    );
  }

  return (
    <PageShell
      user={user}
      width="wide"
      title="الأداء"
      intro={`كل جانب من المقهى بنسبته من الإيراد، بجانب المعتاد في مقاهي القهوة المختصة. الأرقام لشهر ${formatMonth(k.month)}، آخر شهر انتهى.`}
      actions={advisor ? <LinkButton href="/finance/advisor" icon={Sparkles} variant="primary">اسأل المستشار</LinkButton> : undefined}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyFigure icon={TrendingUp} label="الإيراد بلا ضريبة" period={formatMonth(k.month)} value={<Riyals minor={k.revenueMinor} />}
          sub={prev?.revenueMinor != null && k.revenueMinor !== null ? <T s="{0} في {1}" a={[<Money key="0" minor={prev.revenueMinor} />, formatMonth(prev.month)]} /> : undefined} href={`/finance?month=${k.month}`} />
        <KeyFigure icon={HandCoins} label="متوسط الطلب" period={formatMonth(k.month)} value={<Riyals minor={k.ticketMinor} />}
          sub={k.orders !== null ? countNoun(k.orders, ORDER) : undefined} href={`/finance/sales?month=${k.month}`} />
        <KeyFigure icon={Gauge} label="التكلفة الأساسية" period="المبيعات والرواتب" value={<span className="nums">{formatShare(k.primeBp)}</span>}
          tone={["WORSE", "SUSPECT"].includes(verdictOf(k.primeBp, BENCHMARKS.prime) ?? "") ? "warn" : undefined}
          sub={k.primeBp === null ? "تحتاج إلى تكلفة المبيعات والرواتب معاً" : "من الإيراد بلا ضريبة"} />
        <KeyFigure icon={Percent} label="هامش الربح" period={k.profitLabel} value={<span className="nums">{formatShare(k.netMarginBp)}</span>}
          tone={["WORSE", "SUSPECT"].includes(verdictOf(k.netMarginBp, BENCHMARKS.netMargin) ?? "") ? "warn" : undefined}
          sub={<MaybeMoney minor={k.profitMinor} />} href={`/finance?month=${k.month}`} />
      </div>

      {!k.complete && (
        <Callout tone="warn" className="mt-4" title={`أرقام ${formatMonth(k.month)} غير مكتملة`}>
          <T s="اسم الربح «{0}» يقول ما ينقصه. ما لم يُعرف لا يُقارن بالمعتاد، ويكتمل من {1}." a={[k.profitLabel, <LinkButton key="1" href={`/finance?month=${k.month}`} size="sm" variant="quiet">صفحة الربح</LinkButton>]} />
        </Callout>
      )}

      <Section title="أين أنت من المعتاد" icon={Gauge} hint="المعتاد نطاق عام في مقاهي القهوة المختصة يتداوله أهل الصناعة، لا رقم من دفاترك ولا معيار نظامي. يختلف كل مقهى بموقعه وحجمه.">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <BenchmarkCard b={BENCHMARKS.cogs} value={k.cogsBp} display={formatShare(k.cogsBp)} />
          <BenchmarkCard b={BENCHMARKS.labour} value={k.labourBp} display={formatShare(k.labourBp)} />
          <BenchmarkCard b={BENCHMARKS.prime} value={k.primeBp} display={formatShare(k.primeBp)} />
          <BenchmarkCard b={BENCHMARKS.rent} value={k.rentBp} display={formatShare(k.rentBp)} />
          <BenchmarkCard b={BENCHMARKS.netMargin} value={k.netMarginBp} display={formatShare(k.netMarginBp)} />
          <BenchmarkCard b={BENCHMARKS.prepMedian} value={s30.medianSec} display={s30.medianSec === null ? "غير معروف" : formatDuration(s30.medianSec)} />
        </div>
      </Section>

      <Section title="شهراً بشهر" icon={Activity} count={perf.months.length} hint="كل نسبة من الإيراد بلا ضريبة. وما لم يُسجَّل من بابه «غير معروف» لا صفر.">
        <DataTable rows={[...perf.months].reverse()} columns={monthColumns} keyOf={(m) => m.month} />
      </Section>

      <Section title="سرعة الخدمة" icon={Timer} hint={`من شاشة التحضير في فودكس: من وصول الطلب إلى الشاشة حتى إنهائه، آخر ثلاثين يوماً.${perf.speed.since ? ` تُعرف الأوقات منذ ${formatDay(perf.speed.since)}.` : ""}`}>
        {s30.medianSec === null ? (
          perf.speed.since
            ? <EmptyState compact icon={Timer} title="لا طلبات بأوقات تحضير في آخر ثلاثين يوماً." hint="ربما لم تُستعمل شاشة التحضير في هذه الأيام، أو لم تُقرأ مزامنة فودكس الأخيرة بعد." />
            : <EmptyState compact icon={Timer} title="لا أوقات تحضير مقروءة بعد." hint="تُقرأ مع مزامنة فودكس القادمة، وتظهر هنا حين تكتمل أيام كافية." />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Card>
              <p className="text-xs font-bold text-muted">نصف الطلبات تنتهي في</p>
              <p className="nums mt-1 text-2xl font-semibold">{formatDuration(s30.medianSec)}</p>
              <p className="mt-3 text-xs font-bold text-muted">وواحد من كل عشرة يتجاوز</p>
              <p className="nums mt-1 text-xl font-semibold">{s30.p90Sec === null ? "—" : formatDuration(s30.p90Sec)}</p>
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                <T s="تجاوز عشر دقائق: {0} من {1}." a={[<span key="0" className="nums font-bold text-ink">{formatShare(s30.slowBp)}</span>, countNoun(s30.measured, ORDER)]} />
                {sPrev.medianSec !== null && <Fragment> <T s="وفي الثلاثين يوماً قبلها كان الوسيط {0}." a={[formatDuration(sPrev.medianSec)]} /></Fragment>}
                {s30.forgotten > 0 && <Fragment> <T s="و{0} بقيت على الشاشة أكثر من ساعة، فهي منسية على الأرجح ولا تدخل الحساب." a={[countNoun(s30.forgotten, ORDER)]} /></Fragment>}
              </p>
            </Card>
            <Card>
              <p className="text-xs font-bold text-muted">الوسيط بحسب ساعة وصول الطلب</p>
              <div className="mt-3">
                <BarList
                  items={s30.byHour.map((h) => ({
                    key: String(h.hour),
                    label: `${String(h.hour).padStart(2, "0")}:00`,
                    minor: h.medianSec,
                    display: <span className="nums">{formatDuration(h.medianSec)}</span>,
                    sub: `${countNoun(h.orders, ORDER)} · العُشر الأبطأ ${formatDuration(h.p90Sec)}`,
                  }))}
                />
              </div>
            </Card>
          </div>
        )}
      </Section>

      <Section title="ما يتسرّب من الإيراد" icon={Undo2} hint={`${formatMonth(k.month)}: من فودكس، ووصف لما حدث لا اتهام لأحد.`}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
          <Card>
            <p className="text-xs font-bold text-muted">الخصومات</p>
            <p className="nums mt-1 text-xl font-semibold">{formatShare(k.discountBp)}</p>
            <p className="mt-1 text-[11px] text-muted">مما دفعه الزبائن</p>
          </Card>
          <Card>
            <p className="text-xs font-bold text-muted">المرتجع</p>
            <p className="nums mt-1 text-xl font-semibold">{formatShare(k.refundsBp)}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              {perf.returns.answered > 0
                ? <T s="آخر تسعين يوماً: قال الكاشير إن المكونات هُدرت في {0} من {1}." a={[countNoun(perf.returns.wastedOrders, ORDER), countNoun(perf.returns.returnOrders, ORDER)]} />
                : "مما دفعه الزبائن"}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-bold text-muted">مشروبات الموظفين بسعر القائمة</p>
            <p className="mt-1 text-xl font-semibold"><Money minor={k.staffListMinor} currency /></p>
            <p className="mt-1 text-[11px] text-muted">ليست إيراداً، وتكلفتها في تكلفة المبيعات</p>
          </Card>
        </div>
      </Section>

      <Section title="النقد وما عليك" icon={Landmark} hint="من آخر كشف بنك مسوّى، ومن جدول النقد القادم.">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
          <KeyFigure icon={Landmark} label="رصيد البنك" value={<Riyals minor={perf.cash.balanceMinor} />} sub={perf.cash.balanceAsOf ? `حسب كشف ${formatDay(perf.cash.balanceAsOf)}` : "لا كشف مسوّى برصيد"} href="/bank" />
          <KeyFigure icon={HandCoins} label="المستحق للمورّدين" value={<Money minor={perf.owedMinor} currency />} href="/suppliers?view=owed" />
          <KeyFigure icon={Activity} label="ما يُدفع حتى آخر الشهر القادم" tone={perf.cash.shortfallAt ? "warn" : undefined} value={<Money minor={perf.cash.dueNext60Minor} currency />}
            sub={perf.cash.shortfallAt ? `يقصر الرصيد عنه في ${formatDay(perf.cash.shortfallAt)}` : "الرصيد يكفيه حسب الجدول"} href="/cash" />
        </div>
      </Section>
    </PageShell>
  );
}
