import { redirect } from "next/navigation";
import { Banknote, CreditCard, Info, Landmark, Scale, TriangleAlert, UserRound } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { FoodicsStatusBar } from "@/components/foodics-status";
import { SignalControls } from "@/components/signal-controls";
import { Badge, Callout, DataTable, EmptyState, KeyFigure, LinkButton, NoAccess, Section } from "@/components/ui";
import { formatDay, formatMoment, formatMonth, formatWeekday } from "@/lib/riyadh-time";
import { CARD_RECENT_DAYS, type CardBatchRow, type CardMonth, type CardVerdict, type CashMonth } from "@/lib/foodics/takings";
import { cardGapKey, loadFoodicsSilenced, loadFoodicsTakings } from "@/services/foodics-takings.service";
import { loadFoodicsStatus } from "@/services/foodics-sync.service";

export const dynamic = "force-dynamic";

/** كم دفعةً تُعرض في الجدول — ما قبلها في مجاميع الأشهر. */
const BATCHES_SHOWN = 45;

const VERDICT: Record<CardVerdict, { label: string; tone?: "ok" | "warn" | "danger" | "info" }> = {
  AGREES: { label: "متطابقان", tone: "ok" },
  SMALL_GAP: { label: "فرقٌ صغير" },
  BANK_SHORT: { label: "وصل أقلّ", tone: "danger" },
  BANK_OVER: { label: "وصل أكثر", tone: "warn" },
  RECENT: { label: "قد لا تكتمل", tone: "info" },
};

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
      <PageShell user={user} width="wide" title="فودكس والبنك" intro="ما قبضه فودكس بالبطاقة والنقد، أمام ما دخل الحساب.">
        <FoodicsStatusBar status={status} canSync={canSync} />
        <div className="mt-6">
          <EmptyState
            icon={Scale}
            title="لا طلباتٍ من فودكس بعد."
            hint="تُقرأ الطلباتُ ودفعاتُها من واجهة فودكس، ثمّ تُقابَل بتسويات الشبكة في كشف البنك. اضغط «زامن الآن» أعلاه."
          />
        </div>
      </PageShell>
    );
  }

  const month = t.card.months[0] ?? null;
  const cashNow = t.cash[0] ?? null;
  const flagged = t.card.batches.filter((b) => (b.verdict === "BANK_SHORT" || b.verdict === "BANK_OVER") && !silenced.has(cardGapKey(b.day)));
  const silencedRows = t.card.batches.filter((b) => silenced.has(cardGapKey(b.day)));
  const shown = t.card.batches.slice(0, BATCHES_SHOWN);

  return (
    <PageShell
      user={user}
      width="wide"
      title="فودكس والبنك"
      eyebrow={<>كشفُ البنك حتى <bdi>{formatDay(t.lastBankDay)}</bdi></>}
      intro="ما قبضه فودكس بالبطاقة والنقد والآجل، أمام ما دخل الحساب فعلاً — وأين اختلفا."
    >
      <FoodicsStatusBar status={status} canSync={canSync} />

      {/* ── أرقامُ آخر شهرٍ قورِن ── */}
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        {month ? (
          <KeyFigure
            icon={CreditCard}
            label={`بطاقاتُ ${formatMonth(month.month)}: فودكس − البنك`}
            tone={month.notable ? (month.gapMinor > 0 ? "danger" : "warn") : "ok"}
            value={<Money minor={month.gapMinor} signed />}
            sub={
              <>
                فودكس <Money minor={month.foodicsMinor} /> · وصل البنكَ <Money minor={month.bankMinor} />.{" "}
                {month.gapMinor > 0 ? "قبض فودكس أكثر ممّا وصل." : month.gapMinor < 0 ? "وصل البنكَ أكثر ممّا سجّله فودكس بطاقةً." : "متطابقان."}
              </>
            }
            href="#months"
          />
        ) : (
          <KeyFigure icon={CreditCard} label="بطاقاتُ فودكس − البنك" value={<span className="text-xl text-muted">غير معروف</span>} sub="لا دفعةَ في الكشف تقابل ما قُرئ من فودكس بعد." />
        )}
        <KeyFigure
          icon={Banknote}
          label={cashNow ? `نقدُ ${formatMonth(cashNow.month)} في فودكس` : "النقد"}
          value={cashNow ? <Money minor={cashNow.cashMinor} /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={cashNow ? (cashNow.bankOtherCreditsMinor === 0 ? "لا إيداعَ في البنك من غير الشبكة هذا الشهر — النقدُ كلُّه خارج الحساب." : <>واردٌ آخر في البنك <Money minor={cashNow.bankOtherCreditsMinor} /></>) : undefined}
          href="#cash"
        />
        <KeyFigure
          icon={UserRound}
          label={cashNow ? `على الحساب الآجل في ${formatMonth(cashNow.month)}` : "الحساب الآجل"}
          value={cashNow ? <Money minor={cashNow.houseAccountMinor} /> : <span className="text-xl text-muted">غير معروف</span>}
          sub="بِيع وقُيّد على حسابٍ في فودكس — لم يدخل صندوقاً ولا بنكاً."
          href="#cash"
        />
      </div>

      {/* ── دفعاتٌ فرقُها ظاهر ── */}
      <Section
        id="flagged"
        title="دفعاتٌ فرقُها ظاهر"
        icon={TriangleAlert}
        count={flagged.length}
        hint="دفعةُ بنكٍ لم يُوجد لها مقطعٌ من بطاقات فودكس يقاربها. «وصل أقلّ»: فودكس قبض بطاقةً ولم يصل كلُّه. «وصل أكثر»: دخل الحسابَ مالُ بطاقةٍ لم يسجّله فودكس بطاقةً — بيعٌ سُجّل نقداً أو آجلاً ودُفع بالبطاقة، أو عمليّةٌ على الجهاز بلا طلب."
      >
        {flagged.length === 0 ? (
          <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs leading-relaxed text-muted shadow-raised">
            لا دفعةَ فرقُها ظاهر في ما يغطّيه الكشف.
            {silencedRows.length > 0 && <> وأسكتَّ {silencedRows.length} — تجدها أدناه.</>}
          </p>
        ) : (
          <ul className="space-y-2">
            {flagged.map((b) => (
              <li key={b.day} className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${b.verdict === "BANK_SHORT" ? "border-danger/30 bg-danger-bg" : "border-warn/30 bg-warn-bg"}`}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold">
                    دفعةُ <bdi>{formatDay(b.day)}</bdi> — {b.verdict === "BANK_SHORT" ? "وصل أقلّ بـ" : "وصل أكثر بـ"}<Money minor={Math.abs(b.gapMinor)} />
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    فودكس قبض بالبطاقة <Money minor={b.foodicsMinor} /> <Window b={b} />، ودخل البنكَ <Money minor={b.bankMinor} />.
                    {b.verdict === "BANK_SHORT"
                      ? " راجِع تقريرَ إقفال الجهاز لتلك الليلة: عمليّةٌ مرفوضة سُجّلت مدفوعة، أو دفعةٌ لم تودَع."
                      : " راجِع طلباتِ تلك الليلة في فودكس: ما دُفع بالبطاقة وسُجّل نقداً أو على حسابٍ آجل."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <LinkButton href={`/bank?show=in&month=${b.day.slice(0, 7)}#transactions`} variant="secondary" size="sm">واردُ ذلك الشهر</LinkButton>
                  {canEdit && <SignalControls signalKey={cardGapKey(b.day)} dismissLabel="عرفتُ سببَه" />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {silencedRows.length > 0 && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer font-bold">ما أسكتَّه ({silencedRows.length})</summary>
            <ul className="mt-2 space-y-1">
              {silencedRows.map((b) => (
                <li key={b.day} className="flex flex-wrap items-center gap-2">
                  <span>دفعةُ <bdi>{formatDay(b.day)}</bdi> · الفرق <Money minor={b.gapMinor} signed /></span>
                  {canEdit && <SignalControls signalKey={cardGapKey(b.day)} silenced />}
                </li>
              ))}
            </ul>
          </details>
        )}
        {t.card.unsettled && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            وبعد آخر دفعةٍ في الكشف قبض فودكس بالبطاقة <Money minor={t.card.unsettled.foodicsMinor} /> (منذ <bdi>{formatMoment(new Date(t.card.unsettled.fromMs))}</bdi>) —
            لم يبلغها الكشفُ بعد. تُقابَل حين يُستورَد كشفٌ أحدث.
          </p>
        )}
      </Section>

      {/* ── البطاقات شهراً بشهر ── */}
      <Section
        id="months"
        title="البطاقاتُ شهراً بشهر"
        icon={Landmark}
        hint="مجموعُ الدفعات التي حُكم فيها. حدودُ الإقفال تتقاصّ داخل الشهر، ففرقُه أصدقُ من فرق دفعةٍ بعينها."
      >
        <DataTable<CardMonth>
          rows={t.card.months}
          keyOf={(m) => m.month}
          hrefOf={(m) => `/bank?show=in&month=${m.month}#transactions`}
          columns={[
            { key: "month", header: "الشهر", primary: true, cell: (m) => <span className="font-bold">{formatMonth(m.month)}</span> },
            { key: "foodics", header: "بطاقاتُ فودكس", numeric: true, cell: (m) => <Money minor={m.foodicsMinor} /> },
            { key: "bank", header: "وصل البنك", numeric: true, cell: (m) => <Money minor={m.bankMinor} /> },
            { key: "gap", header: "الفرق", numeric: true, cell: (m) => (m.notable ? <Money minor={m.gapMinor} signed tone={m.gapMinor < 0 ? "warn" : "danger"} /> : <span className="text-muted"><Money minor={m.gapMinor} signed /></span>) },
            { key: "batches", header: "دفعات", numeric: true, secondary: true, cell: (m) => <span className="nums nums-count">{m.comparedBatches}</span> },
            { key: "exact", header: "تطابقت إلى الهللة", numeric: true, secondary: true, cell: (m) => <span className="nums nums-count">{m.exactBatches}</span> },
          ]}
        />
      </Section>

      {/* ── دفعةً بدفعة ── */}
      <Section
        title="دفعةً بدفعة"
        icon={CreditCard}
        count={shown.length}
        hint={`لكلّ دفعةٍ في البنك مقطعُ بطاقات فودكس الذي يقابلها — من إقفال الجهاز إلى الذي يليه. موضعُ الإقفال يُقدَّر، فالفرقُ الصغير قد يكون عمليّةً على حدّه. وآخرُ ${CARD_RECENT_DAYS} أيّامٍ قد لا تكتمل: بعضُ الشبكات تودع متأخّرة.`}
      >
        <DataTable<CardBatchRow>
          rows={shown}
          keyOf={(b) => b.day}
          columns={[
            {
              key: "day",
              header: "تاريخُ الدفعة",
              primary: true,
              cell: (b) => (
                <span>
                  <span className="font-bold"><bdi>{formatDay(b.day)}</bdi></span>
                  <span className="ms-2 text-xs text-muted">{formatWeekday(b.day)}</span>
                  {b.approximate && <span className="ms-2"><Badge>بيوم الوصول</Badge></span>}
                </span>
              ),
            },
            { key: "foodics", header: "بطاقاتُ فودكس", numeric: true, cell: (b) => <Money minor={b.foodicsMinor} /> },
            { key: "bank", header: "وصل البنك", numeric: true, cell: (b) => <Money minor={b.bankMinor} /> },
            { key: "gap", header: "الفرق", numeric: true, cell: (b) => <Money minor={b.gapMinor} signed /> },
            { key: "n", header: "عمليّات", numeric: true, secondary: true, cell: (b) => <span className="nums nums-count">{b.payments}</span> },
            { key: "verdict", header: "الحكم", cell: (b) => <Badge tone={VERDICT[b.verdict].tone}>{VERDICT[b.verdict].label}</Badge> },
          ]}
        />
      </Section>

      {/* ── النقدُ والآجل ── */}
      <Section
        id="cash"
        title="النقدُ والآجل شهراً بشهر"
        icon={Banknote}
        hint="النقدُ لا يُقابَل يوماً بيوم — الإيداعُ يجمع أيّاماً. فيُعرَض ما قبضه فودكس نقداً، وما دخل البنكَ من غير تسويات الشبكة، وما كتبتَه نقداً للإقرار. والفرقُ يُقال ولا يُسمّى."
      >
        <DataTable<CashMonth>
          rows={t.cash}
          keyOf={(m) => m.month}
          columns={[
            { key: "month", header: "الشهر", primary: true, cell: (m) => <span className="font-bold">{formatMonth(m.month)}</span> },
            { key: "cash", header: "نقدُ فودكس", numeric: true, cell: (m) => <Money minor={m.cashMinor} /> },
            { key: "bank", header: "واردٌ آخر في البنك", numeric: true, cell: (m) => (m.bankOtherCreditsMinor === 0 ? <span className="text-muted">لا شيء</span> : <Money minor={m.bankOtherCreditsMinor} />) },
            { key: "typed", header: "كتبتَه للإقرار", numeric: true, cell: (m) => (m.typedForVatMinor === null ? <span className="text-muted">لم يُكتب</span> : <Money minor={m.typedForVatMinor} />) },
            { key: "house", header: "على الحساب الآجل", numeric: true, secondary: true, cell: (m) => <Money minor={m.houseAccountMinor} /> },
            { key: "variance", header: "فرقُ إقفال الصندوق", numeric: true, secondary: true, cell: (m) => (m.tillVarianceMinor === null ? <span className="text-muted">غير معروف</span> : <Money minor={m.tillVarianceMinor} signed />) },
          ]}
        />
        <Callout tone="info" icon={Info} className="mt-4" action={can(user.role, "month:close") ? <LinkButton href="/close/vat" variant="secondary" size="sm">الإقرار الضريبيّ</LinkButton> : undefined}>
          <strong className="text-ink">نقدُ فودكس مبيعاتٌ خاضعةٌ للضريبة</strong> ولا أثرَ لها في كشف البنك. الإقرارُ يأخذ النقدَ ممّا تكتبه بيدك شهراً بشهر —
          والعمودُ «نقدُ فودكس» هو ما يقوله نظامُ البيع عن الشهر نفسه. لا يُكتب في الإقرار من هنا شيء.
        </Callout>
      </Section>
    </PageShell>
  );
}

/** «من … إلى …» لمقطع الدفعة — أو لا شيء إن كان فارغاً. */
function Window({ b }: { b: CardBatchRow }) {
  if (b.fromMs === null || b.toMs === null) return <>(لا عمليّاتٍ في نافذتها)</>;
  return <>(من <bdi>{formatMoment(new Date(b.fromMs))}</bdi> إلى <bdi>{formatMoment(new Date(b.toMs))}</bdi>)</>;
}
