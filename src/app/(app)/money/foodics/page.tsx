import { Fragment } from "react";
import { redirect } from "next/navigation";
import { Banknote, CircleCheck, Coffee, CreditCard, Info, Landmark, Scale, TriangleAlert } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { FoodicsStatusBar } from "@/components/foodics-status";
import { SignalControls } from "@/components/signal-controls";
import { Badge, Callout, DataTable, EmptyState, KeyFigure, LinkButton, NoAccess, Section } from "@/components/ui";
import { addDays, currentMonthRiyadh, formatDay, formatMoment, formatMonth, todayInRiyadh } from "@/lib/riyadh-time";
import { CARD_LOOKBACK_DAYS } from "@/services/foodics-attention.service";
import { DAY, countNoun } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";
import { CARD_RECENT_DAYS, CARD_SMALL_MINOR, type CardBatchRow, type CardMonth, type CashMonth } from "@/lib/foodics/takings";
import { cardGapKey, loadCardComparison, loadFoodicsSilenced, loadFoodicsTakings } from "@/services/foodics-takings.service";
import { loadFoodicsStatus } from "@/services/foodics-sync.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/** كم دفعةً تُعرض في الجدول — ما قبلها في مجاميع الأشهر. */
const BATCHES_SHOWN = 45;

/**
 * فودكس والبنك — ما قبضه نظامُ نقاط البيع أمام ما دخل الحساب.
 *
 * البطاقاتُ دفعةً بدفعة (`lib/foodics/takings.ts`)، والنقدُ والآجلُ شهراً بشهر. فودكس
 * هنا شاهدٌ: يُقال الفرقُ بطرفيه ولا يُسمّى ضياعاً، ولا يُكتب من الصفحة في البنك شيء.
 */
export default async function FoodicsBankPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/money/foodics");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="فودكس والبنك">
        <NoAccess what="مقارنة فودكس بالبنك" />
      </PageShell>
    );
  }

  const [status, t, silenced] = await Promise.all([loadFoodicsStatus(), loadFoodicsTakings(), loadFoodicsSilenced("foodics-card")]);
  const canEdit = can(user.role, "bank:edit");
  const canSync = can(user.role, "inventory:count");

  if (!t.hasOrders) {
    return (
      <PageShell user={user} width="wide" title="فودكس والبنك" intro="ما سجّله فودكس من مقبوضات بالبطاقة والنقد، مقارنةً بما دخل الحساب البنكي فعلاً.">
        <FoodicsStatusBar status={status} canSync={canSync} />
        <div className="mt-6">
          <EmptyState
            icon={Scale}
            title="لا توجد طلبات من فودكس بعد."
            hint="يقرأ النظام الطلبات ودفعاتها من فودكس، ثم يقارنها بتسويات الشبكة في كشف البنك. اضغط «زامن الآن» أعلاه."
          />
        </div>
      </PageShell>
    );
  }

  /* آخرُ شهرٍ اكتمل هو ما يُقال في الأعلى — الجاري ناقصٌ فرقُه يتحرّك */
  const thisMonth = currentMonthRiyadh();
  const month = t.card.months.find((m) => m.month < thisMonth) ?? t.card.months[0] ?? null;
  const cashMonth = t.cash.find((m) => m.month === month?.month) ?? t.cash[0] ?? null;
  /*
    «يحتاج قرارك» يعدّ دفعات آخر CARD_LOOKBACK_DAYS يوماً — والصفحةُ كانت تعدّ كلَّ ما في الكشف
    (٦ هنا و٣ هناك تحت الاسم نفسه). فالمعروضُ للمراجعة دفعاتُ البند نفسُه — المقارنةُ بمداه
    نفسه (قصُّ المدى الكامل عند يومٍ يغيّر الدفعات حوله، فيختلف العددان)، والأقدمُ يُطوى بعدده.
  */
  const since = addDays(todayInRiyadh(), -CARD_LOOKBACK_DAYS);
  const isGap = (b: CardBatchRow) => (b.verdict === "BANK_SHORT" || b.verdict === "BANK_OVER") && !silenced.has(cardGapKey(b.day));
  const flagged = (await loadCardComparison(since)).card.batches.filter(isGap);
  const olderGaps = t.card.batches.filter((b) => isGap(b) && b.day < since);
  const silencedRows = t.card.batches.filter((b) => silenced.has(cardGapKey(b.day)));
  const shown = t.card.batches.slice(0, BATCHES_SHOWN);
  const cashTotal = t.cash.reduce((s, m) => s + m.cashMinor, 0);
  const staffTotal = t.cash.reduce((s, m) => s + m.staffDrinksMinor, 0);

  return (
    <PageShell
      user={user}
      width="wide"
      title="فودكس والبنك"
      eyebrow={<><T s="كشف البنك حتى {0}" a={[<bdi key="0">{formatDay(t.lastBankDay)}</bdi>]} /></>}
      intro="ما سجّله فودكس من مقبوضات بالبطاقة والنقد، مقارنةً بما دخل الحساب البنكي فعلاً، وأين اختلفا."
    >
      <FoodicsStatusBar status={status} canSync={canSync} />

      {/* ── الخلاصة: آخرُ شهرٍ اكتمل ── */}
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        {month ? (
          <KeyFigure
            icon={CreditCard}
            label={`البطاقات: ${formatMonth(month.month)}`}
            tone={!month.notable ? "ok" : month.gapMinor > 0 ? "danger" : "warn"}
            value={month.notable ? <Money minor={Math.abs(month.gapMinor)} /> : <span className="text-2xl">متطابقان</span>}
            sub={
              <>
                <T s="{0}سجّل فودكس {1}، ودخل البنك {2}." a={[month.notable && <strong key="0" className="text-ink">{month.gapMinor > 0 ? "ما دخل البنك أقل مما سجّله فودكس. " : "دخل البنك أكثر مما سجّله فودكس. "}</strong>, <Money key="1" minor={month.foodicsMinor} />, <Money key="2" minor={month.bankMinor} />]} /></>
            }
            href="#months"
          />
        ) : (
          <KeyFigure icon={CreditCard} label="البطاقات" value={<span className="text-xl text-muted">غير معروف</span>} sub="لا توجد بعد دفعة في الكشف تقابل ما قرأه النظام من فودكس." />
        )}
        <KeyFigure
          icon={Banknote}
          label={cashMonth ? `نقد لم يدخل البنك: ${formatMonth(cashMonth.month)}` : "النقد"}
          value={cashMonth ? <Money minor={cashMonth.notBankedMinor} /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={cashMonth
            ? <><T s="سجّل فودكس مقبوضات نقدية بقيمة {0}{1} وهي مبيعات تخضع للضريبة." a={[<Money key="0" minor={cashMonth.cashMinor} />, cashMonth.bankOtherCreditsMinor === 0 ? "، ولا يوجد في الكشف إيداع من خارج الشبكة." : <Fragment key="1"><T s="، ودخل البنك من خارج الشبكة {0}." a={[<Money key="0" minor={cashMonth.bankOtherCreditsMinor} />]} /></Fragment>]} /></>
            : undefined}
          href="#cash"
        />
        <KeyFigure
          icon={Coffee}
          label={cashMonth ? `مشروبات الموظفين: ${formatMonth(cashMonth.month)}` : "مشروبات الموظفين"}
          value={cashMonth ? <Money minor={cashMonth.staffDrinksMinor} /> : <span className="text-xl text-muted">غير معروف</span>}
          sub="ما سُجّل على «House Account» بسعر القائمة. لا يُعدّ مبيعات ولا ديناً ولا تُحسب عليه ضريبة، ويدخل في الجرد فقط."
          href="#staff"
        />
      </div>

      <Callout tone="info" icon={Info} className="mt-4" title="كيف تقرأ هذه الصفحة">
        <ul className="list-disc space-y-0.5 ps-4">
          <li><T s="{0}: سجّل فودكس مدفوعات بطاقة لم يصل بعضها، كعملية مرفوضة سُجّلت مدفوعة، أو دفعة لم تُودَع بعد." a={[<strong key="0" className="text-ink">دخل البنك أقل</strong>]} /></li>
          <li><T s="{0}: دخلت أموال بطاقة لم يسجّلها فودكس بطاقةً، كبيع سُجّل نقداً وهو مدفوع بالبطاقة، أو عملية على الجهاز بلا طلب." a={[<strong key="0" className="text-ink">دخل البنك أكثر</strong>]} /></li>
          <li><T s="اعتمد على فرق {0}. أما فرق الدفعة الواحدة فتقريبي، لأن وقت إقفال الجهاز يختلف كل ليلة، فقد تحسب عملية قريبة من الإقفال زيادةً في دفعة ونقصاً في التي تليها." a={[<strong key="0" className="text-ink">الشهر</strong>]} /></li>
        </ul>
      </Callout>

      {/* ── دفعاتٌ فرقُها ظاهر ── */}
      <Section
        id="flagged"
        title="دفعات تحتاج مراجعتك"
        icon={TriangleAlert}
        count={flagged.length}
        hint={`دفعات بنكية يختلف مبلغها عن بطاقات فودكس المقابلة بأكثر من ${formatRiyalsDisplay(CARD_SMALL_MINOR)} ريال. إن عرفت السبب فتجاهلها ولن تظهر مرة أخرى.`}
      >
        {flagged.length === 0 ? (
          <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs leading-relaxed text-muted shadow-raised">
            <T s="لا توجد دفعة بفرق واضح في الفترة التي يغطيها الكشف.{0}" a={[silencedRows.length > 0 && <Fragment key="0"> <T s=" وتجاهلتَ {0} دفعة، تجدها أدناه." a={[silencedRows.length]} /></Fragment>]} /></p>
        ) : (
          <ul className="space-y-2">
            {flagged.map((b) => (
              <li key={b.day} className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${b.verdict === "BANK_SHORT" ? "border-danger/30 bg-danger-bg" : "border-warn/30 bg-warn-bg"}`}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold">
                    <T s="دفعة {0}: {1}{2}" a={[<bdi key="0">{formatDay(b.day)}</bdi>, b.verdict === "BANK_SHORT" ? "دخل البنك أقل بمقدار " : "دخل البنك أكثر بمقدار ", <Money key="2" minor={Math.abs(b.gapMinor)} />]} /></p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    <T s="سجّل فودكس بالبطاقة {0} {1}، ودخل البنك {2}.{3}" a={[<Money key="0" minor={b.foodicsMinor} />, <Window key="1" b={b} />, <Money key="2" minor={b.bankMinor} />, b.verdict === "BANK_SHORT"
                      ? " راجع تقرير إقفال الجهاز لتلك الليلة."
                      : " راجع طلبات تلك الليلة في فودكس، فربما دُفع بيع بالبطاقة وسُجّل نقداً."]} /></p>
                </div>
                <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1">
                  <LinkButton href={`/bank?show=in&month=${b.day.slice(0, 7)}#transactions`} variant="secondary" size="sm">الداخل في ذلك الشهر</LinkButton>
                  {canEdit && <SignalControls signalKey={cardGapKey(b.day)} dismissLabel="عرفت سببه" />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {olderGaps.length > 0 && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer font-bold"><T s="أقدم من {0}، فلا تدخل «يحتاج قرارك» ({1})" a={[countNoun(CARD_LOOKBACK_DAYS, DAY), olderGaps.length]} /></summary>
            <ul className="mt-2 space-y-1">
              {olderGaps.map((b) => (
                <li key={b.day} className="flex flex-wrap items-center gap-2">
                  <span><T s="دفعة {0} · {1}" a={[<bdi key="0">{formatDay(b.day)}</bdi>, <GapWords key="1" gapMinor={b.gapMinor} agrees={false} />]} /></span>
                  {canEdit && <SignalControls signalKey={cardGapKey(b.day)} dismissLabel="عرفت سببه" />}
                </li>
              ))}
            </ul>
          </details>
        )}
        {silencedRows.length > 0 && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer font-bold"><T s="ما تجاهلته ({0})" a={[silencedRows.length]} /></summary>
            <ul className="mt-2 space-y-1">
              {silencedRows.map((b) => (
                <li key={b.day} className="flex flex-wrap items-center gap-2">
                  <span><T s="دفعة {0} · {1}" a={[<bdi key="0">{formatDay(b.day)}</bdi>, <GapWords key="1" gapMinor={b.gapMinor} agrees={false} />]} /></span>
                  {canEdit && <SignalControls signalKey={cardGapKey(b.day)} silenced />}
                </li>
              ))}
            </ul>
          </details>
        )}
        {t.card.unsettled && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            <T s="بعد آخر دفعة في الكشف سجّل فودكس بالبطاقة {0} (منذ {1}). الكشف لم يصل إلى هذه المبالغ بعد، وستُقارن حين تستورد كشفاً أحدث." a={[<Money key="0" minor={t.card.unsettled.foodicsMinor} />, <bdi key="1">{formatMoment(new Date(t.card.unsettled.fromMs))}</bdi>]} /></p>
        )}
      </Section>

      {/* ── البطاقات شهراً بشهر ── */}
      <Section
        id="months"
        title="البطاقات شهراً بشهر"
        icon={Landmark}
        hint="دفعات البنك بحسب يوم البيع الذي تحمله (دفعة كل يوم تحمل مبيعات اليوم الذي قبله)، وما يقابلها من بطاقات فودكس. يقارب مجموع بطاقات الشهر في «المبيعات»، والفرق بينهما بيع ما بعد منتصف الليل وأيام لم يغطها الكشف بعد."
      >
        <DataTable<CardMonth>
          rows={t.card.months}
          keyOf={(m) => m.month}
          hrefOf={(m) => `/bank?show=in&month=${m.month}#transactions`}
          columns={[
            {
              key: "month",
              header: "الشهر",
              primary: true,
              cell: (m) => (
                <span className="block">
                  <span className="font-bold">{formatMonth(m.month)}</span>
                  {m.month >= thisMonth && <span className="ms-2"><Badge>غير مكتمل</Badge></span>}
                  {/* الصفُّ عن أيّام دفعاته — يُقال صراحةً كي لا يُقرأ مجموعَ الشهر */}
                  <span className="mt-0.5 block text-[11px] font-normal text-muted">
                    <T s="مبيعات {0} إلى {1}" a={[<bdi key="0">{formatDay(m.firstDay)}</bdi>, <bdi key="1">{formatDay(m.lastDay)}</bdi>]} />
                  </span>
                </span>
              ),
            },
            {
              key: "foodics", header: "سجّله فودكس بطاقة", numeric: true,
              cell: (m) => (
                <span className="block">
                  <Money minor={m.foodicsMinor} />
                  {t.cardByBusinessMonth[m.month] !== undefined && (
                    <span className="block text-[10px] font-normal text-muted">
                      <T s="والشهر كاملاً في المبيعات {0}" a={[<Money key="0" minor={t.cardByBusinessMonth[m.month]} />]} />
                    </span>
                  )}
                </span>
              ),
            },
            { key: "bank", header: "دخل البنك", numeric: true, cell: (m) => <Money minor={m.bankMinor} /> },
            { key: "gap", header: "الفرق", cell: (m) => <GapWords gapMinor={m.gapMinor} agrees={!m.notable} /> },
            { key: "batches", header: "الدفعات", numeric: true, secondary: true, cell: (m) => <span className="nums nums-count">{m.comparedBatches}</span> },
          ]}
        />
      </Section>

      {/* ── دفعةً بدفعة ── */}
      <Section
        title="دفعة بدفعة"
        icon={CreditCard}
        count={shown.length}
        hint={`كل دفعة دخلت البنك وما يقابلها من بطاقات فودكس، من إقفال الجهاز إلى الإقفال الذي بعده. آخر ${CARD_RECENT_DAYS} أيام في الكشف قد تكون ناقصة لأن بعض الشبكات تودع متأخرة، فلا يُحكم عليها بعد.`}
      >
        <DataTable<CardBatchRow>
          rows={shown}
          keyOf={(b) => b.day}
          columns={[
            {
              key: "day",
              header: "تاريخ الدفعة",
              primary: true,
              cell: (b) => (
                <span>
                  <span className="font-bold"><bdi>{formatDay(b.day)}</bdi></span>
                  {b.approximate && <span className="ms-2"><Badge>حسب يوم الوصول</Badge></span>}
                </span>
              ),
            },
            { key: "foodics", header: "سجّله فودكس", numeric: true, cell: (b) => <Money minor={b.foodicsMinor} /> },
            { key: "bank", header: "دخل البنك", numeric: true, cell: (b) => <Money minor={b.bankMinor} /> },
            {
              key: "gap",
              header: "الفرق",
              cell: (b) => (b.verdict === "RECENT"
                ? <Badge tone="info">قد تكون ناقصة</Badge>
                : <GapWords gapMinor={b.gapMinor} agrees={b.verdict === "AGREES"} quiet={b.verdict === "SMALL_GAP"} />),
            },
            { key: "n", header: "العمليات", numeric: true, secondary: true, cell: (b) => <span className="nums nums-count">{b.payments}</span> },
            { key: "window", header: "آخر عملية فيها", secondary: true, cell: (b) => (b.toMs === null ? <span className="text-muted">—</span> : <bdi className="text-xs text-muted">{formatMoment(new Date(b.toMs))}</bdi>) },
          ]}
        />
      </Section>

      {/* ── النقد ── */}
      <Section
        id="cash"
        title="النقد شهراً بشهر"
        icon={Banknote}
        hint="لا يمكن مقابلة النقد يوماً بيوم لأن الإيداع الواحد يجمع عدة أيام. لذلك يعرض الجدول ما سجّله فودكس نقداً، بجانب ما دخل البنك من خارج الشبكة، وما كتبته في الإقرار."
      >
        <DataTable<CashMonth>
          rows={t.cash}
          keyOf={(m) => m.month}
          columns={[
            { key: "month", header: "الشهر", primary: true, cell: (m) => <span className="font-bold">{formatMonth(m.month)}</span> },
            { key: "cash", header: "النقد المسجّل في فودكس", numeric: true, cell: (m) => <Money minor={m.cashMinor} /> },
            { key: "bank", header: "دخل البنك من خارج الشبكة", numeric: true, cell: (m) => (m.bankOtherCreditsMinor === 0 ? <span className="text-muted">لا شيء</span> : <Money minor={m.bankOtherCreditsMinor} />) },
            { key: "typed", header: "ما كتبته في الإقرار", numeric: true, cell: (m) => (m.typedForVatMinor === null ? <span className="text-warn">لم تكتب شيئاً</span> : <Money minor={m.typedForVatMinor} />) },
            { key: "variance", header: "فرق عدّ الصندوق", numeric: true, secondary: true, cell: (m) => (m.tillVarianceMinor === null ? <span className="text-muted">غير معروف</span> : <Money minor={m.tillVarianceMinor} signed />) },
          ]}
        />
        <Callout tone="warn" icon={Banknote} className="mt-4" action={can(user.role, "month:close") ? <LinkButton href="/close/vat" variant="secondary" size="sm">افتح الإقرار</LinkButton> : undefined}>
          <T s="{0} هذه مبيعات تخضع للضريبة، والإقرار يأخذ قيمتها مما تكتبه أنت شهراً بشهر. العمود «النقد المسجّل في فودكس» هو الرقم الذي تكتبه في الإقرار، ولا تنقل هذه الصفحة إليه شيئاً من تلقاء نفسها. أما «فرق عدّ الصندوق» فهو ما عُدّ عند الإقفال مطروحاً منه ما توقّعه فودكس." a={[<strong key="0" className="text-ink"><T s="سجّل فودكس نقداً {0} منذ {1}، ولا أثر لإيداعه في الكشف." a={[<Money key="0" minor={cashTotal} />, <bdi key="1">{formatDay(t.firstDay)}</bdi>]} /></strong>]} /></Callout>
      </Section>

      {/* ── مشروباتُ الموظّفين ── */}
      <Section
        id="staff"
        title="مشروبات الموظفين"
        icon={Coffee}
        hint="ما سُجّل في فودكس على «House Account» بسعر القائمة. ليست مبيعات ولا ديناً على أحد، فلا تدخل في الإيراد ولا في ضريبة المبيعات. وما صُنع منها يُخصم من المخزون في الجرد كأي مشروب آخر."
      >
        <DataTable<CashMonth>
          rows={t.cash}
          keyOf={(m) => m.month}
          columns={[
            { key: "month", header: "الشهر", primary: true, cell: (m) => <span className="font-bold">{formatMonth(m.month)}</span> },
            { key: "staff", header: "بسعر القائمة", numeric: true, cell: (m) => <Money minor={m.staffDrinksMinor} /> },
          ]}
        />
        <p className="mt-3 text-xs text-muted"><T s="المجموع منذ {0}: {1} بسعر القائمة. تكلفتها الفعلية أقل من ذلك، وتظهر في الجرد." a={[<bdi key="0">{formatDay(t.firstDay)}</bdi>, <Money key="1" minor={staffTotal} />]} /></p>
      </Section>
    </PageShell>
  );
}

/** الفرقُ بالكلمات: من أين زاد وبكم — لا رقمٌ بإشارةٍ يُسأل عن معناها. */
function GapWords({ gapMinor, agrees, quiet = false }: { gapMinor: number; agrees: boolean; quiet?: boolean }) {
  if (agrees) return <span className="inline-flex items-center gap-1 text-xs font-bold text-ok"><T s="{0}متطابقان" a={[<CircleCheck key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></span>;
  const cls = quiet ? "text-muted" : gapMinor > 0 ? "font-bold text-danger" : "font-bold text-warn";
  return <span className={`text-xs ${cls}`}>{gapMinor > 0 ? "البنك أقل بمقدار " : "البنك أكثر بمقدار "}<Money minor={Math.abs(gapMinor)} /></span>;
}

/** «من … إلى …» لمقطع الدفعة — أو لا شيء إن كان فارغاً. */
function Window({ b }: { b: CardBatchRow }) {
  if (b.fromMs === null || b.toMs === null) return <>(لم تقع عمليات في فترتها)</>;
  return <><T s="(من {0} إلى {1})" a={[<bdi key="0">{formatMoment(new Date(b.fromMs))}</bdi>, <bdi key="1">{formatMoment(new Date(b.toMs))}</bdi>]} /></>;
}
