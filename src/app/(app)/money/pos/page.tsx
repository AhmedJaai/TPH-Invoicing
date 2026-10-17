import { redirect } from "next/navigation";
import { CalendarX, CreditCard, Info, Landmark, Percent, TrendingUp, Upload } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { SignalControls } from "@/components/signal-controls";
import { Badge, Callout, DataTable, EmptyState, KeyFigure, LinkButton, NoAccess, Section } from "@/components/ui";
import { DAY, countNoun } from "@/lib/arabic";
import { formatDay, formatMonth, formatWeekday } from "@/lib/riyadh-time";
import {
  SETTLEMENT_GRACE_DAYS, USUAL_MIN_MONTHS, formatRate, missingSettlementKey, type MonthFees, type SettlementDay,
} from "@/lib/bank/pos-watch";
import { feeRiseKey, loadPosWatch, MISSING_LOOKBACK_DAYS } from "@/services/pos-watch.service";

export const dynamic = "force-dynamic";

/** كم يوماً من أيّام التسوية يُعرض — ما قبله في حركة البنك. */
const DAYS_SHOWN = 45;

/**
 * تسوياتُ الشبكة — كم تأخذ الشبكةُ فعلاً، وأيُّ يومِ بيعٍ لم تصل تسويتُه.
 *
 * من حركات البنك وحدها (`pos-watch.ts`): لا مبيعاتٌ تُفترَض ولا نسبةٌ تُخمَّن.
 * والغائبُ يُسأل عنه ولا يُسمّى ضياعاً — وصاحبُه يُسكته إن كان يعرف سببَه.
 */
export default async function PosPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/money/pos");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="تسويات الشبكة">
        <NoAccess what="تسويات الشبكة" />
      </PageShell>
    );
  }

  const w = await loadPosWatch();
  const canEdit = can(user.role, "bank:edit");

  if (w.txCount === 0) {
    return (
      <PageShell user={user} width="wide" title="تسويات الشبكة" intro="ما يصل من مبيعات البطاقات، وما تخصمه الشبكة منه.">
        <EmptyState
          icon={CreditCard}
          title="لا توجد حركات شبكة في كشف البنك بعد."
          hint="يقرأ النظام التسويات ورسومها من كشف الحساب نفسه. استورد كشفاً يحتوي على إيداعات نقاط البيع لتظهر هنا نسبة الرسم الفعلية وأيام التسوية."
          action={can(user.role, "bank:edit") ? <LinkButton href="/bank#import" variant="primary" icon={Upload}>استورد كشف البنك</LinkButton> : undefined}
        />
      </PageShell>
    );
  }

  const latest = w.months[0];
  const shownDays = w.days.slice(0, DAYS_SHOWN);

  return (
    <PageShell
      user={user}
      width="wide"
      title="تسويات الشبكة"
      eyebrow={<>من كشف البنك حتى <bdi>{formatDay(w.lastBankDay)}</bdi></>}
      intro="ما وصل إلى الحساب من مبيعات البطاقات، وما خصمته الشبكة منه رسوماً وضريبة، والأيام المعتادة التي لم تصل تسويتها."
    >
      {/* ── أرقامُ آخر شهر ── */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={Landmark}
          label={`تسويات ${formatMonth(latest.month)}`}
          value={<Money minor={latest.settlementMinor} />}
          sub="إيداعات الشبكة في الحساب قبل خصم الرسم. ليست «المبيعات»، فهي لا تشمل النقد ولا تطبيقات التوصيل."
          href={`/bank?show=in&month=${latest.month}#transactions`}
        />
        <KeyFigure
          icon={Percent}
          label="الرسم الفعلي"
          value={latest.rateBp === null ? <span className="text-xl text-muted">غير معروف</span> : <span className="nums">{formatRate(latest.rateBp)}</span>}
          sub={
            latest.rateBp === null
              ? "لا توجد تسويات في هذا الشهر لحساب النسبة عليها."
              : latest.usualBp === null
                ? `رسوم العمليات ÷ التسويات. تُعرف «العادة» بعد ${countMonths(USUAL_MIN_MONTHS)} في الكشف.`
                : `رسوم العمليات ÷ التسويات، وعادتها ${formatRate(latest.usualBp)} (وسيط الأشهر السابقة).`
          }
        />
        <KeyFigure
          icon={CreditCard}
          label="ما خصمته الشبكة"
          value={<Money minor={latest.feeMinor + latest.fixedFeeMinor + latest.vatMinor} />}
          sub={
            <>
              رسم العمليات <Money minor={latest.feeMinor} />
              {latest.fixedFeeMinor > 0 && <> · رسم ثابت <Money minor={latest.fixedFeeMinor} /></>}
              {" "}· ضريبة الرسم <Money minor={latest.vatMinor} />
            </>
          }
          href={`/bank?show=fees&month=${latest.month}#transactions`}
        />
      </div>

      {w.feeRise && (
        <Callout
          tone="warn"
          icon={TrendingUp}
          className="mt-4"
          title={`رسم ${formatMonth(w.feeRise.month)} أعلى من المعتاد: ${formatRate(w.feeRise.rateBp)} والمعتاد ${formatRate(w.feeRise.usualBp)}`}
          action={canEdit ? <SignalControls signalKey={feeRiseKey(w.feeRise.month)} snoozeDays={30} /> : undefined}
        >
          الفرق على تسويات ذلك الشهر <Money minor={w.feeRise.excessMinor ?? 0} />. قد يكون السبب تغيّر نوع البطاقات (بطاقات ائتمانية أكثر) أو تغيّر سعر العقد. راجع البنك إن لم تعرف السبب، أو تجاهل التنبيه إن كان الارتفاع متفقاً عليه.
        </Callout>
      )}

      {/* ── تسوياتٌ لم تصل ── */}
      <Section
        id="missing"
        title="أيام لم تصل تسويتها"
        icon={CalendarX}
        count={w.missing.length}
        hint={`أيام تصل فيها التسوية عادةً في مثل هذا اليوم من الأسابيع السابقة، ولا توجد لها تسوية في الكشف، ومضى عليها ${countNoun(SETTLEMENT_GRACE_DAYS, DAY)} على الأقل. يشمل الفحص آخر ${countNoun(MISSING_LOOKBACK_DAYS, DAY)} من الكشف.`}
      >
        {w.missing.length === 0 ? (
          <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs leading-relaxed text-muted shadow-raised">
            لا توجد أيام معتادة بلا تسوية ضمن الفترة التي يغطيها الكشف حتى <bdi>{formatDay(w.lastBankDay)}</bdi>.
            {w.silencedMissing.length > 0 && <> وتجاهلت {countNoun(w.silencedMissing.length, DAY)}، تجدها أدناه.</>}
          </p>
        ) : (
          <ul className="space-y-2">
            {w.missing.map((m) => (
              <li key={m.day} className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold">
                    {formatWeekday(m.day)} <bdi>{formatDay(m.day)}</bdi>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    لم تصل تسوية لهذا اليوم، بينما وصلت في مثله في {m.seenWeeks} من الأسابيع الستة السابقة
                    {m.usualMinor !== null && <>، ووسيطها <Money minor={m.usualMinor} /> (تقدير وليس مبلغاً فعلياً)</>}.
                    راجع تقرير الجهاز لذلك اليوم ثم البنك، وإن كان المقهى مغلقاً فتجاهل التنبيه.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <LinkButton href={`/bank?show=in&month=${m.day.slice(0, 7)}#transactions`} variant="secondary" size="sm">الوارد في ذلك الشهر</LinkButton>
                  {canEdit && <SignalControls signalKey={missingSettlementKey(m.day)} dismissLabel="كان مغلقاً / وصلت" />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {w.silencedMissing.length > 0 && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer font-bold">ما تجاهلته ({w.silencedMissing.length})</summary>
            <ul className="mt-2 space-y-1">
              {w.silencedMissing.map((day) => (
                <li key={day} className="flex flex-wrap items-center gap-2">
                  <span>{formatWeekday(day)} <bdi>{formatDay(day)}</bdi></span>
                  {canEdit && <SignalControls signalKey={missingSettlementKey(day)} silenced />}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      {/* ── الرسمُ شهراً بشهر ── */}
      <Section
        title="الرسم شهراً بشهر"
        icon={Percent}
        hint="النسبة = رسوم العمليات ÷ التسويات لجميع الشبكات معاً. أما الرسم الثابت (للجهاز أو الاشتراك الشهري) فيُعرض منفصلاً ولا يدخل في النسبة، وإلا ارتفعت النسبة في شهر قليل المبيعات دون أي تغيير في السعر."
      >
        <DataTable<MonthFees>
          rows={w.months}
          keyOf={(m) => m.month}
          hrefOf={(m) => `/bank?show=fees&month=${m.month}#transactions`}
          columns={[
            {
              key: "month",
              header: "الشهر",
              primary: true,
              cell: (m) => (
                <span className="font-bold">
                  {formatMonth(m.month)}
                  {w.lastBankDay && m.month === w.lastBankDay.slice(0, 7) && <span className="ms-2"><Badge>غير مكتمل</Badge></span>}
                </span>
              ),
            },
            { key: "settled", header: "التسويات", numeric: true, cell: (m) => <Money minor={m.settlementMinor} /> },
            { key: "fee", header: "رسم العمليات", numeric: true, cell: (m) => <Money minor={m.feeMinor} /> },
            {
              key: "rate",
              header: "النسبة",
              numeric: true,
              cell: (m) => (m.rateBp === null ? <span className="text-muted">غير معروف</span> : <span className="nums font-bold">{formatRate(m.rateBp)}</span>),
            },
            {
              key: "usual",
              header: "العادة",
              numeric: true,
              secondary: true,
              cell: (m) => (m.usualBp === null ? <span className="text-muted">—</span> : <span className="nums">{formatRate(m.usualBp)}</span>),
            },
            { key: "fixed", header: "رسم ثابت", numeric: true, secondary: true, cell: (m) => (m.fixedFeeMinor > 0 ? <Money minor={m.fixedFeeMinor} /> : <span className="text-muted">—</span>) },
            { key: "vat", header: "ضريبة الرسوم", numeric: true, secondary: true, cell: (m) => <Money minor={m.vatMinor} /> },
          ]}
        />
        {latest.schemes.length > 1 && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            تسويات {formatMonth(latest.month)} موزعة حسب رمز الشبكة كما في الكشف:{" "}
            {latest.schemes.map((s, i) => (
              <span key={s.code}>
                {i > 0 && " · "}
                {s.label} <Money minor={s.settlementMinor} />
              </span>
            ))}
            . ولا يمكن نسبة الرسم إلى شبكة بعينها، لأن رمزه في الكشف يختلف عن رمز تسويته.
          </p>
        )}
      </Section>

      {/* ── يوماً بيوم ── */}
      <Section
        title="يوماً بيوم"
        icon={CreditCard}
        count={shownDays.length}
        hint="لكل يوم بيع: ما وصل له من تسويات، وما يحمل تاريخه من رسم وضريبة. يؤخذ اليوم من رمز الدفعة في وصف البنك، وما لا يحمل الرمز يُنسب إلى يوم وصوله ويُوسَم بذلك."
      >
        <DataTable<SettlementDay>
          rows={shownDays}
          keyOf={(d) => d.day}
          /* `-260718-` بشرطتَيه نصٌّ لا مبلغ — فيجد حركاتِ الدفعة في وصف البنك */
          hrefOf={(d) => (d.byValueDate ? `/bank?show=in&month=${d.day.slice(0, 7)}#transactions` : `/bank?show=all&q=-${d.day.slice(2).replaceAll("-", "")}-#transactions`)}
          columns={[
            {
              key: "day",
              header: "يوم البيع",
              primary: true,
              cell: (d) => (
                <span>
                  <span className="font-bold"><bdi>{formatDay(d.day)}</bdi></span>
                  <span className="ms-2 text-xs text-muted">{formatWeekday(d.day)}</span>
                  {d.byValueDate && <span className="ms-2"><Badge>حسب يوم الوصول</Badge></span>}
                </span>
              ),
            },
            { key: "settled", header: "التسوية", numeric: true, cell: (d) => (d.batches > 0 ? <Money minor={d.settlementMinor} /> : <span className="text-muted">لا تسوية</span>) },
            { key: "batches", header: "الدفعات", numeric: true, secondary: true, cell: (d) => <span className="nums nums-count">{d.batches}</span> },
            { key: "fee", header: "الرسم", numeric: true, secondary: true, cell: (d) => <Money minor={d.feeMinor} /> },
            { key: "vat", header: "ضريبة الرسم", numeric: true, secondary: true, cell: (d) => <Money minor={d.vatMinor} /> },
            { key: "net", header: "الصافي", numeric: true, cell: (d) => <Money minor={d.netMinor} signed /> },
          ]}
        />
      </Section>

      <Callout tone="info" icon={Info} className="mt-8" action={<LinkButton href="/money/foodics" variant="secondary" size="sm">فودكس والبنك</LinkButton>}>
        <strong className="text-ink">هل طابقت التسوية مبيعات البطاقات؟</strong> هذه الصفحة تعتمد على كشف البنك فقط، ويُعرف فيها غياب التسوية من عادة الأيام السابقة. أما مقارنة كل دفعة بما سجّله فودكس بالبطاقة فتجدها في «فودكس والبنك».
      </Callout>
    </PageShell>
  );
}

function countMonths(n: number): string {
  return n === 3 ? "ثلاثة أشهر" : `${n} أشهر`;
}
