import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, Info, Link2, PackageSearch, Scale } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney, Unknown } from "@/components/finance-bits";
import { Badge, Callout, DataTable, KeyFigure, LinkButton, LinkTabs, NoAccess, Section, type Column } from "@/components/ui";
import { FLOW_MISSING_HREF, FLOW_MISSING_LABEL, type FlowItem } from "@/lib/finance/stock-flow";
import { readableQuantity } from "@/lib/finance/quantity";
import { formatShare } from "@/lib/finance/format";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadCumulativeStockFlow, loadFlowMonths, loadMonthStockFlow, type CountSource } from "@/services/stock-flow.service";
import { loadFinanceAttentionFacts, stockGapKey } from "@/services/finance-attention.service";
import { SignalControls } from "@/components/signal-controls";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** دون هذه التغطية يُقال فوق التقرير إنّه لا يصلح للحكم بعد. */
const COVERAGE_OK_BP = 8_000;
const SOURCE_LABEL: Record<CountSource, string> = { OURS: "جردُنا", FOODICS: "عدُّ الرفّ في فودكس" };

/**
 * قيمةُ الفرق التي يُرتَّب بها: فرقُنا، وإلّا فرقُ الشاهد **الموجب** وحده. فرقُ الشاهد
 * السالب («بِيع أكثر ممّا أُدخل شراءً في فودكس») يقول إنّ الشراءَ لم يُدخَل هناك — لا إنّ
 * في المقهى خطأ؛ ورفعُه إلى رأس الجدول ضجيج.
 */
const gapOf = (x: FlowItem) => x.unexplainedMinor ?? (x.witnessUnexplainedMinor !== null && x.witnessUnexplainedMinor > 0 ? x.witnessUnexplainedMinor : null);

/**
 * المشترى مقابل المباع — لكلّ صنف مخزون: كم اشتُري، كم بِيع منه، وأين ذهب الباقي.
 * «هدر» لما سُجِّل هدراً وحده؛ والباقي «فرقٌ غير مفسَّر» تُعرَض احتمالاتُه ولا يُحسَم.
 */
export default async function FinanceStockPage({ searchParams }: { searchParams: Promise<{ month?: string; sort?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/stock");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="المشترى والمباع"><NoAccess what="تقرير المشترى مقابل المباع" /></PageShell>;
  }
  const q = await searchParams;
  const months = await loadFlowMonths();
  const cumulative = q.month === "all";
  const month = !cumulative && q.month && MONTH_RE.test(q.month) && months.includes(q.month) ? q.month : months.find((m) => m < (months[0] ?? "")) ?? months[0] ?? null;

  if (months.length === 0 || (!cumulative && month === null)) {
    return (
      <PageShell user={user} title="المشترى والمباع" intro="ما اشتُري من كلّ صنف، وما بِيع منه، وأين ذهب الباقي.">
        <Callout tone="info" icon={Info} title="لا مبيعاتٍ مقروءةً بعد">يبدأ التقريرُ حين تُقرأ مبيعاتُ فودكس وتُقيَّد فواتيرُ الشراء.</Callout>
      </PageShell>
    );
  }

  const [flow, whole, attention] = await Promise.all([
    cumulative ? loadCumulativeStockFlow() : loadMonthStockFlow(month ?? ""),
    cumulative ? Promise.resolve(null) : loadCumulativeStockFlow(),
    loadFinanceAttentionFacts(),
  ]);
  const recurring = attention.recurring;
  const canSilence = can(user.role, "bank:edit");
  if (!flow) {
    return (
      <PageShell user={user} title="المشترى والمباع">
        <Callout tone="info" icon={Info} title="لا عدَّين بعد">النسبةُ التراكميّة تحتاج عدَّين على الأقلّ. <LinkButton href="/inventory" size="sm">أدخِل الجرد</LinkButton></Callout>
      </PageShell>
    );
  }

  const t = flow.totals;
  const w = flow.window;
  const hasCounts = w.openingCountDay !== null && w.closingCountDay !== null;
  const wholeOf = new Map((whole?.items ?? []).map((x) => [x.productId, x]));
  const rows = [...flow.items].sort((a, b) => Math.abs(gapOf(b) ?? 0) - Math.abs(gapOf(a) ?? 0) || (b.purchasedMinor + (b.consumedMinor ?? 0)) - (a.purchasedMinor + (a.consumedMinor ?? 0)));
  const active = rows.filter((x) => x.purchasedMinor > 0 || (x.consumed?.milli ?? 0) !== 0 || x.openingMilli !== null || x.closingMilli !== null || (x.witnessPurchasedMilli ?? 0) > 0);
  const monthParam = cumulative ? "all" : month ?? "";
  const negative = active.filter((x) => (x.unexplainedMinor ?? 0) < 0).length;

  const columns: Column<FlowItem>[] = [
    { key: "name", header: "الصنف", primary: true, cell: (x) => x.name, sortBy: (x) => x.name },
    { key: "opening", header: "أوّل الفترة", numeric: true, secondary: true, cell: (x) => (x.openingMilli === null ? <span className="text-[11px] text-muted">لم يُعَدّ</span> : <span className="nums">{readableQuantity(x.openingMilli, x.baseUnit)}</span>) },
    {
      key: "purchased", header: "المشترى", numeric: true,
      cell: (x) => (
        <span className="block">
          {x.purchasedKnownMilli === null ? <span className="text-[11px] font-bold text-ink-soft">غير معروف</span> : <span className="nums">{readableQuantity(x.purchasedKnownMilli, x.baseUnit)}</span>}
          {x.witnessPurchasedMilli !== null && x.witnessPurchasedMilli !== x.purchasedKnownMilli && (
            <span className="block text-[10px] text-muted">فودكس: <span className="nums">{readableQuantity(x.witnessPurchasedMilli, x.baseUnit)}</span></span>
          )}
        </span>
      ),
      sortBy: (x) => x.purchasedMinor,
    },
    {
      key: "consumed", header: "المباع منه (نظريّاً)", numeric: true,
      cell: (x) => (
        <span className="block">
          {x.consumed === null || x.unitConflict ? <span className="text-[11px] font-bold text-ink-soft">غير معروف</span> : <span className="nums">{readableQuantity(x.consumed.milli, x.baseUnit)}</span>}
          {x.consumed && x.consumed.staffMilli > 0 && <span className="block text-[10px] text-muted">منه موظّفون: <span className="nums">{readableQuantity(x.consumed.staffMilli, x.baseUnit)}</span></span>}
        </span>
      ),
      sortBy: (x) => x.consumedMinor,
    },
    { key: "waste", header: "هدرٌ مسجَّل", numeric: true, secondary: true, cell: (x) => (x.wasteMilli === 0 ? <span className="text-muted">—</span> : <span className="nums">{readableQuantity(x.wasteMilli, x.baseUnit)}</span>) },
    { key: "closing", header: "آخر الفترة", numeric: true, secondary: true, cell: (x) => (x.closingMilli === null ? <span className="text-[11px] text-muted">لم يُعَدّ</span> : <span className="nums">{readableQuantity(x.closingMilli, x.baseUnit)}</span>) },
    {
      key: "gap", header: "الفرق غير المفسَّر", numeric: true,
      cell: (x) => {
        if (x.unexplainedMilli !== null) {
          return (
            <span className="block">
              <span className="font-bold"><MaybeMoney minor={x.unexplainedMinor} signed why="لا كلفةَ معروفة" /></span>
              <span className="block text-[10px] text-muted"><span className="nums">{readableQuantity(x.unexplainedMilli, x.baseUnit)}</span>{x.unexplainedMilli < 0 && " — فوق المتاح: خطأُ بيانات"}</span>
            </span>
          );
        }
        if (x.witnessUnexplainedMilli !== null && x.witnessUnexplainedMilli < 0) {
          return (
            <span className="block text-[11px] text-muted">
              <span className="font-bold text-ink-soft">غير معروف</span>
              <span className="block">بِيع أكثر ممّا أُدخل شراءً في فودكس — شراءٌ لم يُدخَل هناك</span>
            </span>
          );
        }
        if (x.witnessUnexplainedMilli !== null) {
          return (
            <span className="block">
              <span className="font-bold"><MaybeMoney minor={x.witnessUnexplainedMinor} signed why="لا كلفة" /></span>
              <span className="block text-[10px] text-muted">بمشتريات فودكس · <span className="nums">{readableQuantity(x.witnessUnexplainedMilli, x.baseUnit)}</span></span>
            </span>
          );
        }
        if (x.surplusMilli !== null) {
          return (
            <span className="block text-[11px] text-muted">
              مشترى {x.surplusMilli >= 0 ? "أكثر" : "أقلّ"} من المباع بـ<span className="nums font-bold text-ink-soft">{readableQuantity(Math.abs(x.surplusMilli), x.baseUnit)}</span>
              <span className="block">لا جرد يفصل المخزون عن الفاقد</span>
            </span>
          );
        }
        return <Unknown />;
      },
      sortBy: (x) => { const g = gapOf(x); return g === null ? null : Math.abs(g); },
    },
    ...(cumulative ? [] : [{
      key: "whole", header: "تراكميّاً", numeric: true, secondary: true,
      cell: (x: FlowItem) => {
        const c = wholeOf.get(x.productId);
        const g = c ? gapOf(c) : null;
        return g === null || g === undefined ? <span className="text-muted">—</span> : <Money minor={g} signed />;
      },
    } satisfies Column<FlowItem>]),
    {
      key: "missing", header: "ما ينقصه", wrap: true,
      cell: (x) => (x.missing.length === 0 ? <Badge tone="ok">مكتمل</Badge> : (
        <span className="flex flex-col items-start gap-1">
          {x.missing.map((m) => (
            <Link key={m} href={FLOW_MISSING_HREF[m]} className="relative z-10 text-[11px] font-medium text-warn hover:underline">{FLOW_MISSING_LABEL[m]}</Link>
          ))}
        </span>
      )),
    },
  ];

  return (
    <PageShell
      user={user}
      width="wide"
      title="المشترى والمباع"
      eyebrow={<>من <bdi>{formatDay(w.from)}</bdi> إلى <bdi>{formatDay(w.to)}</bdi></>}
      intro="لكلّ صنف مخزون: كم اشتريتَ، كم بِيع منه بحسب الوصفات، وأين ذهب الباقي. «هدر» لما سُجِّل هدراً وحده — والباقي فرقٌ غير مفسَّر لا يُحسَم سببُه."
      actions={<LinkButton href="/finance/stock/links" icon={Link2} variant="secondary">اربط بنودَ الفواتير</LinkButton>}
    >
      <LinkTabs
        label="الفترة"
        items={[
          ...months.map((m) => ({ href: `/finance/stock?month=${m}`, label: formatMonth(m), active: !cumulative && m === month })),
          { href: "/finance/stock?month=all", label: "تراكميّ", active: cumulative },
        ]}
      />

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyFigure
          icon={PackageSearch}
          label="التغطية"
          tone={flow.coverage.bp !== null && flow.coverage.bp >= COVERAGE_OK_BP ? "ok" : "warn"}
          value={<span className="nums">{formatShare(flow.coverage.bp)}</span>}
          sub={<>دخل الحسابَ <strong className="text-ink"><Money minor={flow.coverage.measuredMinor} /></strong> من <Money minor={flow.coverage.invoiceLinesMinor} /> بنودَ فواتير: مربوطٌ بصنفٍ وكمّيّتُه معروفة.</>}
          href="/finance/stock/links"
        />
        <KeyFigure
          icon={Boxes}
          label="المباع نظريّاً"
          value={<MaybeMoney minor={t.consumedMinor} />}
          sub={<>الوصفات × ما بِيع، بسعر الشراء{t.staffMinor !== null && t.staffMinor > 0 && <> — منه مشروباتُ موظّفين <Money minor={t.staffMinor} /></>}.{flow.coverage.salesExcludedMinor > 0 && <> خارجه مبيعاتٌ بلا وصفة <Money minor={flow.coverage.salesExcludedMinor} />.</>}</>}
        />
        <KeyFigure
          icon={Scale}
          label="فرقٌ غير مفسَّر (نقص)"
          tone={(t.shortageMinor ?? 0) > 0 ? "warn" : undefined}
          value={t.shortageMinor === null ? (t.witnessShortageMinor === null ? <span className="text-xl text-muted">غير معروف</span> : <Money minor={t.witnessShortageMinor} currency />) : <Money minor={t.shortageMinor} currency />}
          sub={t.shortageMinor === null
            ? (t.witnessShortageMinor === null ? "لا صنفَ اكتملت أطرافُه: عدٌّ في الطرفين ومشترياتٌ ووصفة." : <>بمشتريات فودكس لا بفواتيرنا، في {t.witnessMeasured} صنفاً — شاهدٌ حتى تُربَط البنود.</>)
            : <>في {t.measured} صنفاً من {t.items}.{t.witnessShortageMinor !== null && <> وبمشتريات فودكس لـ{t.witnessMeasured} صنفاً أخرى: <Money minor={t.witnessShortageMinor} />.</>}</>}
        />
        <KeyFigure
          icon={Info}
          label="هدرٌ مسجَّل"
          value={<Money minor={t.wasteMinor} currency />}
          sub="ما كُتب في سجلّ الهدر وحده. ما لم يُكتَب يبقى في الفرق غير المفسَّر."
          href="/inventory"
        />
      </div>

      {flow.coverage.bp !== null && flow.coverage.bp < COVERAGE_OK_BP && (
        <Callout tone="warn" icon={Link2} className="mt-4" title={`التغطيةُ ${formatShare(flow.coverage.bp)} — التقريرُ لا يصلح للحكم بعد`}
          action={<LinkButton href="/finance/stock/links" size="sm">اربط البنود</LinkButton>}>
          أكثرُ بنود الفواتير لم تُربَط بصنف مخزونٍ بعد، فمشترياتُ أصنافها «غير معروفة» لا صفر. حتى تُربَط، يُعرَض الفرقُ بمشتريات فودكس شاهداً — باسمه.
        </Callout>
      )}
      {!hasCounts && (
        <Callout tone="info" icon={Info} className="mt-4" title="لا جرد يفصل المخزون عن الفاقد"
          action={<LinkButton href="/inventory" size="sm">أدخِل الجرد</LinkButton>}>
          {w.openingCountDay === null ? "لا عدَّ قرب أوّل الفترة" : "لا عدَّ قرب آخرها"} — فالمشترى الزائد عن المباع قد يكون مخزوناً على الرفّ لا فاقداً. النسبةُ التراكميّة أصدق: المخزونُ يتقاصّ فيها ويبقى الفاقد.
        </Callout>
      )}
      {hasCounts && (
        <p className="mt-4 text-xs leading-relaxed text-muted">
          العدُّ الافتتاحيّ <bdi>{formatDay(w.openingCountDay ?? "")}</bdi> ({flow.openingSource ? SOURCE_LABEL[flow.openingSource] : "—"}) والختاميّ <bdi>{formatDay(w.closingCountDay ?? "")}</bdi> ({flow.closingSource ? SOURCE_LABEL[flow.closingSource] : "—"}).
          الفترةُ من عدٍّ إلى عدّ لا من أوّل الشهر إلى آخره — العدُّ أسبوعيّ.
        </p>
      )}
      {negative > 0 && (
        <Callout tone="warn" icon={Info} className="mt-4" title={`${negative} صنفاً استُهلك منه أكثر من المتاح`}>
          فرقٌ سالب ليس ربحاً: فاتورةُ شراءٍ لم تُقيَّد أو لم تُربَط، أو وصفةٌ تقول أكثر ممّا يُصرَف فعلاً، أو عدٌّ خاطئ. افتح الصنفَ لترى فواتيرَه ومبيعاتِه.
        </Callout>
      )}

      {recurring.length > 0 && (
        <Section id="recurring" title="فروقٌ تتكرّر" icon={Scale} count={recurring.length} hint="صنفٌ فرقُه فوق مئةٍ وخمسين ريالاً شهرين متتاليين فأكثر — نمطٌ لا عدٌّ مستعجل.">
          <ul className="space-y-2">
            {recurring.map((g) => (
              <li key={`${g.productId}${g.kind}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold">
                    <Link href={`/finance/stock/item?id=${g.productId}&month=all`} className="hover:underline">{g.name}</Link>
                    {" — "}{g.kind === "SHORTAGE" ? "يخرج من الرفّ أكثر ممّا تفسّره وصفتُه" : "بِيع منه أكثر ممّا اشتُري"}: <Money minor={g.totalMinor} /> في {g.months.length} أشهر
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    {g.months.map((m) => formatMonth(m)).join(" · ")}{g.byWitness && " · بمشتريات فودكس لا بفواتيرنا"}.{" "}
                    {g.kind === "SHORTAGE" ? "راجِع الوصفة: أتطابق ما يُصرَف فعلاً؟ وسجِّل الهدرَ حين يقع." : "فاتورةٌ ناقصة؟ افتح الصنفَ وراجِع فواتيرَه وربطَها، ثمّ الوصفة."}
                  </p>
                </div>
                {canSilence && <div className="flex shrink-0 flex-wrap items-center gap-1"><SignalControls signalKey={stockGapKey(g.productId, g.kind)} dismissLabel="أعرف سببَه" snoozeDays={30} /></div>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="الأصناف" icon={Boxes} count={active.length} hint="مرتَّبةٌ بقيمة الفرق بالريال — أربعون بالمئة من صنفٍ بعشرة ريالات لا تهمّ.">
        <DataTable
          columns={columns} rows={active} keyOf={(x) => x.productId} sort={q.sort ?? null}
          hrefOf={(x) => `/finance/stock/item?id=${x.productId}&month=${monthParam}`}
          searchOf={(x) => x.name}
        />
      </Section>

      <Callout tone="info" icon={Info} className="mt-6" title="كيف يُقرأ الفرق">
        <ul className="list-disc space-y-0.5 ps-4">
          <li><strong className="text-ink">الفرق = أوّل الفترة + المشترى − المباع نظريّاً − الهدر المسجَّل − آخر الفترة.</strong></li>
          <li>موجبٌ: خرج من الرفّ أكثر ممّا تفسّره الوصفات — هدرٌ لم يُسجَّل، أو وصفةٌ أصغر من الواقع، أو تسريب، أو عدٌّ ناقص. لا يُحسَم أيُّها.</li>
          <li>سالبٌ: خطأُ بيانات — فاتورةٌ غائبة أو وصفةٌ مبالَغٌ فيها.</li>
          <li>«بمشتريات فودكس»: الفرقُ نفسُه بما أُدخل في فودكس بدل فواتيرنا، لما لم تُربَط بنودُه بعد. شاهدٌ يُعرَض باسمه.</li>
        </ul>
      </Callout>
    </PageShell>
  );
}
