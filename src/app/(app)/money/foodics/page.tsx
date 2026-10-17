import { redirect } from "next/navigation";
import { Banknote, CircleCheck, Coffee, CreditCard, Info, Landmark, Scale, TriangleAlert } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { FoodicsStatusBar } from "@/components/foodics-status";
import { SignalControls } from "@/components/signal-controls";
import { Badge, Callout, DataTable, EmptyState, KeyFigure, LinkButton, NoAccess, Section } from "@/components/ui";
import { currentMonthRiyadh, formatDay, formatMoment, formatMonth } from "@/lib/riyadh-time";
import { formatRiyalsDisplay } from "@/lib/money";
import { CARD_RECENT_DAYS, CARD_SMALL_MINOR, type CardBatchRow, type CardMonth, type CashMonth } from "@/lib/foodics/takings";
import { cardGapKey, loadFoodicsSilenced, loadFoodicsTakings } from "@/services/foodics-takings.service";
import { loadFoodicsStatus } from "@/services/foodics-sync.service";

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
      <PageShell user={user} width="wide" title="فودكس والبنك" intro="ما سجّله فودكس من مقبوضات، بالبطاقة والنقد، مقارنةً بما دخل الحساب البنكي فعلاً.">
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
  const flagged = t.card.batches.filter((b) => (b.verdict === "BANK_SHORT" || b.verdict === "BANK_OVER") && !silenced.has(cardGapKey(b.day)));
  const silencedRows = t.card.batches.filter((b) => silenced.has(cardGapKey(b.day)));
  const shown = t.card.batches.slice(0, BATCHES_SHOWN);
  const cashTotal = t.cash.reduce((s, m) => s + m.cashMinor, 0);
  const staffTotal = t.cash.reduce((s, m) => s + m.staffDrinksMinor, 0);

  return (
    <PageShell
      user={user}
      width="wide"
      title="فودكس والبنك"
      eyebrow={<>كشف البنك حتى <bdi>{formatDay(t.lastBankDay)}</bdi></>}
      intro="ما سجّله فودكس من مقبوضات، بالبطاقة والنقد، مقارنةً بما دخل الحساب البنكي فعلاً، وأين اختلفا."
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
                {month.notable && <strong className="text-ink">{month.gapMinor > 0 ? "دخل البنك أقل مما سجّله فودكس. " : "دخل البنك أكثر مما سجّله فودكس. "}</strong>}
                سجّل فودكس <Money minor={month.foodicsMinor} /> ودخل البنك <Money minor={month.bankMinor} />.
              </>
            }
            href="#months"
          />
        ) : (
          <KeyFigure icon={CreditCard} label="البطاقات" value={<span className="text-xl text-muted">غير معروف</span>} sub="لا توجد دفعة في الكشف تقابل ما قُرئ من فودكس بعد." />
        )}
        <KeyFigure
          icon={Banknote}
          label={cashMonth ? `نقد لم يدخل البنك: ${formatMonth(cashMonth.month)}` : "النقد"}
          value={cashMonth ? <Money minor={cashMonth.notBankedMinor} /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={cashMonth
            ? <>سجّل فودكس مقبوضات نقدية بقيمة <Money minor={cashMonth.cashMinor} />{cashMonth.bankOtherCreditsMinor === 0 ? "، ولا توجد إيداعات في الكشف من غير الشبكة." : <>، ودخل البنك من غير الشبكة <Money minor={cashMonth.bankOtherCreditsMinor} />.</>} وهذه مبيعات خاضعة للضريبة.</>
            : undefined}
          href="#cash"
        />
        <KeyFigure
          icon={Coffee}
          label={cashMonth ? `مشروبات الموظفين: ${formatMonth(cashMonth.month)}` : "مشروبات الموظفين"}
          value={cashMonth ? <Money minor={cashMonth.staffDrinksMinor} /> : <span className="text-xl text-muted">غير معروف</span>}
          sub="ما سُجّل على «House Account» بسعر القائمة. ليست مبيعات ولا ديناً ولا ضريبة عليها، وتُحتسب في الجرد فقط."
          href="#staff"
        />
      </div>

      <Callout tone="info" icon={Info} className="mt-4" title="كيف تقرأ هذه الصفحة">
        <ul className="list-disc space-y-0.5 ps-4">
          <li><strong className="text-ink">دخل البنك أقل</strong>: سجّل فودكس مدفوعات بطاقة لم تصل كلها، كعملية مرفوضة سُجّلت مدفوعة، أو دفعة لم تُودع بعد.</li>
          <li><strong className="text-ink">دخل البنك أكثر</strong>: دخلت أموال بطاقة لم يسجّلها فودكس كبطاقة، كبيع سُجّل نقداً وهو مدفوع بالبطاقة، أو عملية على الجهاز دون طلب.</li>
          <li>اعتمد على فرق <strong className="text-ink">الشهر</strong>. أما فرق الدفعة الواحدة فتقريبي، لأن وقت إقفال الجهاز يتغير كل ليلة، فقد تظهر عملية قريبة من وقت الإقفال زائدة في دفعة وناقصة في التي بعدها.</li>
        </ul>
      </Callout>

      {/* ── دفعاتٌ فرقُها ظاهر ── */}
      <Section
        id="flagged"
        title="دفعات تحتاج مراجعتك"
        icon={TriangleAlert}
        count={flagged.length}
        hint={`دفعات بنكية يزيد فرقها عن بطاقات فودكس المقابلة لها على ${formatRiyalsDisplay(CARD_SMALL_MINOR)} ريال. إذا عرفت السبب فتجاهلها ولن تظهر مرة أخرى.`}
      >
        {flagged.length === 0 ? (
          <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs leading-relaxed text-muted shadow-raised">
            لا توجد دفعة بفرق ظاهر ضمن الفترة التي يغطيها الكشف.
            {silencedRows.length > 0 && <> وتجاهلت {silencedRows.length} دفعة، تجدها أدناه.</>}
          </p>
        ) : (
          <ul className="space-y-2">
            {flagged.map((b) => (
              <li key={b.day} className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${b.verdict === "BANK_SHORT" ? "border-danger/30 bg-danger-bg" : "border-warn/30 bg-warn-bg"}`}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold">
                    دفعة <bdi>{formatDay(b.day)}</bdi>: {b.verdict === "BANK_SHORT" ? "دخل البنك أقل بمقدار " : "دخل البنك أكثر بمقدار "}<Money minor={Math.abs(b.gapMinor)} />
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    سجّل فودكس بالبطاقة <Money minor={b.foodicsMinor} /> <Window b={b} />، ودخل البنك <Money minor={b.bankMinor} />.
                    {b.verdict === "BANK_SHORT"
                      ? " راجع تقرير إقفال الجهاز لتلك الليلة."
                      : " راجع طلبات تلك الليلة في فودكس، فقد يكون بيع دُفع بالبطاقة وسُجّل نقداً."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <LinkButton href={`/bank?show=in&month=${b.day.slice(0, 7)}#transactions`} variant="secondary" size="sm">الوارد في ذلك الشهر</LinkButton>
                  {canEdit && <SignalControls signalKey={cardGapKey(b.day)} dismissLabel="عرفت سببه" />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {silencedRows.length > 0 && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer font-bold">ما تجاهلته ({silencedRows.length})</summary>
            <ul className="mt-2 space-y-1">
              {silencedRows.map((b) => (
                <li key={b.day} className="flex flex-wrap items-center gap-2">
                  <span>دفعة <bdi>{formatDay(b.day)}</bdi> · <GapWords gapMinor={b.gapMinor} agrees={false} /></span>
                  {canEdit && <SignalControls signalKey={cardGapKey(b.day)} silenced />}
                </li>
              ))}
            </ul>
          </details>
        )}
        {t.card.unsettled && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            بعد آخر دفعة في الكشف سجّل فودكس بالبطاقة <Money minor={t.card.unsettled.foodicsMinor} /> (منذ <bdi>{formatMoment(new Date(t.card.unsettled.fromMs))}</bdi>). لم يصل الكشف إلى هذه المبالغ بعد، وستُقارن عند استيراد كشف أحدث.
          </p>
        )}
      </Section>

      {/* ── البطاقات شهراً بشهر ── */}
      <Section
        id="months"
        title="البطاقات شهراً بشهر"
        icon={Landmark}
        hint="مجموع دفعات الشهر عند الطرفين. الشهر الجاري غير مكتمل حتى يكتمل كشفه."
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
              cell: (m) => <span className="font-bold">{formatMonth(m.month)}{m.month >= thisMonth && <span className="ms-2"><Badge>غير مكتمل</Badge></span>}</span>,
            },
            { key: "foodics", header: "سجّله فودكس بطاقة", numeric: true, cell: (m) => <Money minor={m.foodicsMinor} /> },
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
        hint={`كل دفعة في البنك وما يقابلها من بطاقات فودكس، من إقفال الجهاز إلى الإقفال الذي يليه. وآخر ${CARD_RECENT_DAYS} أيام من الكشف قد لا تكون مكتملة لأن بعض الشبكات تودع متأخرة، لذلك لا يُحكم عليها.`}
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
                ? <Badge tone="info">قد لا تكون مكتملة</Badge>
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
        hint="لا يمكن مقابلة النقد يوماً بيوم لأن الإيداع يجمع أياماً. لذلك يعرض هذا الجدول ما سجّله فودكس نقداً بجانب ما دخل البنك من غير الشبكة وما كتبته للإقرار."
      >
        <DataTable<CashMonth>
          rows={t.cash}
          keyOf={(m) => m.month}
          columns={[
            { key: "month", header: "الشهر", primary: true, cell: (m) => <span className="font-bold">{formatMonth(m.month)}</span> },
            { key: "cash", header: "النقد المسجّل في فودكس", numeric: true, cell: (m) => <Money minor={m.cashMinor} /> },
            { key: "bank", header: "دخل البنك من غير الشبكة", numeric: true, cell: (m) => (m.bankOtherCreditsMinor === 0 ? <span className="text-muted">لا شيء</span> : <Money minor={m.bankOtherCreditsMinor} />) },
            { key: "typed", header: "ما كتبته للإقرار", numeric: true, cell: (m) => (m.typedForVatMinor === null ? <span className="text-warn">لم تكتب شيئاً</span> : <Money minor={m.typedForVatMinor} />) },
            { key: "variance", header: "فرق عدّ الصندوق", numeric: true, secondary: true, cell: (m) => (m.tillVarianceMinor === null ? <span className="text-muted">غير معروف</span> : <Money minor={m.tillVarianceMinor} signed />) },
          ]}
        />
        <Callout tone="warn" icon={Banknote} className="mt-4" action={can(user.role, "month:close") ? <LinkButton href="/close/vat" variant="secondary" size="sm">افتح الإقرار</LinkButton> : undefined}>
          <strong className="text-ink">سجّل فودكس نقداً <Money minor={cashTotal} /> منذ <bdi>{formatDay(t.firstDay)}</bdi>، ولا أثر لإيداعه في الكشف.</strong>{" "}
          هذه مبيعات خاضعة للضريبة، ويأخذ الإقرار قيمتها مما تكتبه بنفسك شهراً بشهر. العمود «النقد المسجّل في فودكس» هو الرقم الذي تكتبه في الإقرار، ولا يُكتب في الإقرار شيء من هذه الصفحة تلقائياً. و«فرق عدّ الصندوق» هو ما عُدّ عند الإقفال مطروحاً منه ما توقعه فودكس.
        </Callout>
      </Section>

      {/* ── مشروباتُ الموظّفين ── */}
      <Section
        id="staff"
        title="مشروبات الموظفين"
        icon={Coffee}
        hint="ما سُجّل في فودكس على «House Account» بسعر القائمة. ليست مبيعات ولا ديناً على أحد، ولا تدخل في الإيراد ولا في ضريبة المبيعات. وما صُنع منها يُخصم من المخزون في الجرد كأي مشروب."
      >
        <DataTable<CashMonth>
          rows={t.cash}
          keyOf={(m) => m.month}
          columns={[
            { key: "month", header: "الشهر", primary: true, cell: (m) => <span className="font-bold">{formatMonth(m.month)}</span> },
            { key: "staff", header: "بسعر القائمة", numeric: true, cell: (m) => <Money minor={m.staffDrinksMinor} /> },
          ]}
        />
        <p className="mt-3 text-xs text-muted">المجموع منذ <bdi>{formatDay(t.firstDay)}</bdi>: <Money minor={staffTotal} /> بسعر القائمة. كلفتها الفعلية أقل من ذلك، وتظهر في الجرد.</p>
      </Section>
    </PageShell>
  );
}

/** الفرقُ بالكلمات: من أين زاد وبكم — لا رقمٌ بإشارةٍ يُسأل عن معناها. */
function GapWords({ gapMinor, agrees, quiet = false }: { gapMinor: number; agrees: boolean; quiet?: boolean }) {
  if (agrees) return <span className="inline-flex items-center gap-1 text-xs font-bold text-ok"><CircleCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />متطابقان</span>;
  const cls = quiet ? "text-muted" : gapMinor > 0 ? "font-bold text-danger" : "font-bold text-warn";
  return <span className={`text-xs ${cls}`}>{gapMinor > 0 ? "البنك أقل بمقدار " : "البنك أكثر بمقدار "}<Money minor={Math.abs(gapMinor)} /></span>;
}

/** «من … إلى …» لمقطع الدفعة — أو لا شيء إن كان فارغاً. */
function Window({ b }: { b: CardBatchRow }) {
  if (b.fromMs === null || b.toMs === null) return <>(لا توجد عمليات في فترتها)</>;
  return <>(من <bdi>{formatMoment(new Date(b.fromMs))}</bdi> إلى <bdi>{formatMoment(new Date(b.toMs))}</bdi>)</>;
}
