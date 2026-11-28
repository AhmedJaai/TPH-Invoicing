import { Suspense } from "react";
import { RunwayLine } from "@/components/cash-runway";
import { SectionBoundary } from "@/components/ui-client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, CalendarDays, ChevronDown, FlaskConical, Percent, PiggyBank, Plus, Repeat, type LucideIcon } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Callout, EmptyState, LinkButton, NoAccess, Section } from "@/components/ui";
import { formatDay, formatMonth, todayInRiyadh } from "@/lib/riyadh-time";
import { COMMITMENT_MONTHS, loadCashOutlook } from "@/services/cash-outlook.service";
import { buildCommitments, type Commitment } from "@/lib/commitments";
import { buildCashAnswer } from "@/lib/cash-answer";
import { CashAnswerHero, CashDays, SkippedPast, dayLabel } from "@/components/cash-answer";
import { CashTimeline } from "@/components/cash-timeline";
import { CashFloor } from "@/components/cash-floor";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/**
 * النقد القادم — ما يخرج، ومتى، ومقابل أيّ رصيد.
 *
 * إسقاطٌ من المعلوم وحده (`lib/cash-outlook.ts`): دفعةُ الشهر المنقضي،
 * وفواتيرُ هذا الشهر حتى اليوم، والمصروفاتُ المتكرّرة المسجّلة. والوارد
 * لا يُحسَب لأنّ المبيعات غير موصولة — فخطُّ الرصيد حدٌّ أدنى، ويُقال.
 */
export default async function CashPage({ searchParams }: { searchParams: Promise<{ vat?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/cash");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="النقد القادم">
        <NoAccess what="النقد القادم" />
      </PageShell>
    );
  }

  const withVat = (await searchParams).vat !== "off";
  const o = await loadCashOutlook({ withVat, canSeePayroll: can(user.role, "payroll:view") });
  const hasPayroll = o.buckets.some((b) => b.lines.some((l) => l.kind === "PAYROLL"));
  /* المحاسبُ لا يعتمد الدفعة — فسطرُ المورّد يفتح حساباته لا صفحةً تقول «خارج صلاحيتك» */
  const canPay = can(user.role, "payment:approve");
  const payHref = canPay ? "/payments" : "/suppliers";
  /* صفحةُ الإقرار لمن يُقفل الشهر — وغيرُه يقرأ السطرَ ولا يُرسَل إلى «خارج صلاحيتك» */
  const canVat = can(user.role, "month:close");
  const buckets = o.buckets.map((b) => ({
    ...b,
    lines: b.lines.map((l) => (l.kind === "SUPPLIER" ? { ...l, href: payHref } : l.kind === "VAT" && !canVat ? { ...l, href: "/cash" } : l)),
  }));
  const balanceKnown = o.balanceMinor !== null;

  /* الجوابُ المؤرَّخ من وقائع الإسقاط نفسها — بلا تحميلٍ ثانٍ (`lib/cash-answer.ts`) */
  const today = todayInRiyadh();
  const answer = buildCashAnswer({
    commitments: buildCommitments({ today, fromMonth: o.thisMonth, months: COMMITMENT_MONTHS, ...o.inputs, expiries: [] }),
    today,
    balanceMinor: o.balanceMinor,
    balanceAsOf: o.balanceAsOf,
    withVat,
    floorMinor: o.floorMinor,
  });
  /* سطرٌ لا يملك الدورُ صفحتَه يُقرأ ولا يُفتح — لا رابطَ إلى «خارج صلاحيتك» */
  const hrefFor = (c: Commitment): string | null =>
    c.kind === "SUPPLIER_RUN" ? (canPay ? c.href ?? null : "/suppliers")
    : c.kind === "VAT" ? (canVat ? c.href ?? null : null)
    : c.href ?? null;
  const vatToggle = withVat
    ? <LinkButton href="/cash?vat=off" variant="quiet" size="sm" icon={Percent}>اعرضه بدون الضريبة</LinkButton>
    : <LinkButton href="/cash" variant="secondary" size="sm" icon={Percent}>أدخل الضريبة</LinkButton>;
  const ahead = o.vatAhead.length + o.prepaid.length + o.vatUnknown.length;

  return (
    <PageShell
      user={user}
      width="wide"
      title="النقد القادم"
      intro="هل يكفي المال حتى آخر الشهر، ومتى يضيق: ما سيخرج يوماً بيوم مقابل آخر رصيد معروف."
      actions={
        <>
          <LinkButton href="/cash/calendar" icon={CalendarDays} variant="quiet">التقويم الكامل</LinkButton>
          <LinkButton href="/settings#recurring" icon={Plus} variant="secondary">مصروف متكرر</LinkButton>
        </>
      }
    >
      <CashAnswerHero a={answer} canImport={can(user.role, "bank:edit")} />

      {/* أيّامُ النقد الباقية بمعدّل الصرف — سطرٌ يُحسب بعد الرسم، وعطبُه لا يُسقط الصفحة */}
      {balanceKnown && (
        <div className="mt-3 px-1">
          <SectionBoundary what="الأيام التي تكفيها السيولة">
            <Suspense fallback={null}>
              <RunwayLine />
            </Suspense>
          </SectionBoundary>
        </div>
      )}

      {/* ── يوماً بيوم ── */}
      <Section
        title={`يوماً بيوم حتى آخر ${formatMonth(answer.horizonEnd.month)}`}
        icon={CalendarClock}
        action={vatToggle}
        hint={withVat
          ? "كل ما سيخرج بمبلغه المعروف، والرصيد بعد كل يوم. اضغط السطر لتفتح مصدره."
          : `معروض بدون الضريبة بطلبك${o.vatOff.some((v) => (v.amountMinor ?? 0) > 0) ? `، والمستبعد ${o.vatOff.filter((v) => (v.amountMinor ?? 0) > 0).map((v) => v.label).join(" و")}` : ""}.`}
      >
        {answer.days.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="لا توجد مبالغ معروفة ستخرج حتى آخر الشهر القادم."
            hint="لا توجد دفعة مورّدين مفتوحة ولا مصروفات متكررة مسجّلة. سجّل الإيجار والاشتراكات كمصروفات متكررة، وأضف الموظفين في مسيّر الرواتب، لتظهر هنا في مواعيدها."
            action={<LinkButton href="/settings#recurring" variant="primary" icon={Plus}>سجّل مصروفاً متكرراً</LinkButton>}
          />
        ) : (
          <CashDays a={answer} hrefFor={hrefFor} />
        )}
        <SkippedPast items={answer.skippedPast} />
      </Section>

      {o.recurringCount === 0 && answer.days.length > 0 && (
        <Callout
          tone="accent"
          icon={Repeat}
          className="mt-4"
          title={hasPayroll ? "الإيجار والفواتير الثابتة لا تظهر بعد" : "الإيجار والرواتب لا يظهران بعد"}
          action={<LinkButton href="/settings#recurring" variant="primary" size="sm" icon={Plus}>سجّلها</LinkButton>}
        >
          {hasPayroll
            ? "لا توجد مصروفات متكررة مسجّلة، فالأيام أعلاه تعرض دفعات المورّدين والرواتب والضريبة. سجّل الإيجار وما يتكرر كل شهر مع يومه ليدخل في الجواب."
            : "لا توجد مصروفات متكررة مسجّلة، فالأيام أعلاه تعرض دفعات المورّدين فقط. سجّل ما يتكرر كل شهر مع يومه ليدخل في الجواب."}
        </Callout>
      )}

      {/* ── ما بعد الأفق: يُجنَّب له ولا يُطرح ── */}
      {ahead > 0 && (
        <Section title="خصّص له مبلغاً" icon={PiggyBank} hint="موعده بعد الفترة أعلاه فلا يُطرح منها، لكنه سيُدفع.">
          <ul className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {o.vatAhead.map((v) => (
              <AheadRow key={v.periodKey} icon={Percent} title={`ضريبة القيمة المضافة: ${v.label}`}
                sub={<>تُسدَّد قبل <bdi>{formatDay(v.deadline)}</bdi>{v.accruing ? " · المبلغ حتى اليوم ويزيد مع كل يوم بيع" : ""}</>}
                amount={<Money minor={v.amountMinor ?? 0} />} href={canVat ? `/close/vat?period=${v.periodKey}` : undefined} />
            ))}
            {o.vatUnknown.map((v) => (
              <AheadRow key={v.periodKey} icon={Percent} title={`ضريبة القيمة المضافة: ${v.label}`}
                sub={<>موعدها <bdi>{formatDay(v.deadline)}</bdi> · أحد أشهرها بلا كشف بنك، فمبيعاته غير معروفة</>}
                amount={<span className="text-[11px] font-bold text-warn">غير معروف</span>} href={canVat ? `/close/vat?period=${v.periodKey}` : undefined} />
            ))}
            {o.prepaid.map((p) => (
              <AheadRow key={p.label} icon={CalendarClock} title={p.label}
                sub={p.scheduled
                  ? <>الدفعة التالية في <bdi>{p.dueDay ? formatDay(p.dueDay) : formatMonth(p.dueMonth)}</bdi> · مسجّلة في المصروفات المتكررة</>
                  : <>تغطي حتى {formatMonth(p.coveredThrough)}، والتالية نحو {formatMonth(p.dueMonth)} · تقدير بمبلغ السابقة</>}
                amount={<Money minor={p.estimateMinor} />} href="/settings#recurring" />
            ))}
          </ul>
          {o.heldMinor > 0 && (
            <p className="mt-3 text-xs text-muted"><T s="ومحجوز {0} إلى أن تصل الفواتير الصحيحة، ولا يُحسب هنا." a={[<Money key="0" minor={o.heldMinor} />]} /></p>
          )}
        </Section>
      )}

      {/* ── ماذا لو أجّلت؟ — أداةٌ لا جواب، فتُطوى حتى تُطلب ── */}
      {o.buckets.length > 0 && (
        <details className="group mt-10 rounded-2xl border border-line bg-raised shadow-raised">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-hover sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-info-bg text-info"><FlaskConical className="h-4 w-4" strokeWidth={2} aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold">ماذا لو أجّلت دفعة؟</span>
              <span className="block text-xs leading-relaxed text-muted">انقل أي مورّد أو مصروف إلى المرحلة التالية وانظر ما يبقى. تجربة لا تُحفظ، إلا إن اعتمدتها في دفعة الشهر.</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" strokeWidth={2} aria-hidden />
          </summary>
          <div className="border-t border-line-soft p-3 sm:p-5">
            <CashTimeline buckets={buckets} balanceMinor={o.balanceMinor} runMonth={o.runMonth} canPay={canPay} />
          </div>
        </details>
      )}

      <section id="floor" className="mt-10 scroll-mt-24 rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
        <h2 className="text-base font-bold">الحد الأدنى للرصيد</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          {o.floorMinor === null
            ? "لم تحدد حداً أدنى للرصيد. اكتب الرصيد الذي لا تريد أن ينزل حسابك تحته، وسيسمّي الجواب أعلاه أول يوم ينزل فيه عنه."
            : !balanceKnown
              ? "حددت حداً أدنى، لكن الرصيد غير معروف، فلا يمكن تقييم الوضع. استورد كشفاً فيه الرصيد."
              : answer.firstBelowFloor
                ? <>ينزل الرصيد تحته <bdi>{dayLabel(answer.firstBelowFloor.day)}</bdi>، والتفاصيل في أعلى الصفحة.</>
                : "المبالغ المعروفة لن تنزل بالرصيد تحت الحد الأدنى حتى آخر الشهر القادم، علماً أنها لا تشمل المصروفات غير المسجّلة."}
        </p>
        <div className="mt-4">
          {can(user.role, "bank:edit")
            ? <CashFloor floorMinor={o.floorMinor} />
            : <p className="text-xs text-muted">{o.floorMinor === null ? "يحدده المالك أو المحاسب." : <><T s="الحد الحالي {0}." a={[<Money key="0" minor={o.floorMinor} />]} /></>}</p>}
        </div>
      </section>
    </PageShell>
  );
}

function AheadRow({ icon: Icon, title, sub, amount, href }: { icon: LucideIcon; title: string; sub: React.ReactNode; amount: React.ReactNode; href?: string }) {
  const body = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Icon className="h-4 w-4" strokeWidth={2} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[13px] font-bold">{title}</span>
        <span className="block text-[11px] leading-relaxed text-muted">{sub}</span>
      </span>
      <span className="shrink-0 text-[13px] font-bold">{amount}</span>
    </>
  );
  const cls = "flex min-h-14 items-center gap-3 px-4 py-2.5 sm:px-5";
  return <li>{href ? <Link href={href} className={`${cls} transition-colors hover:bg-hover`}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}
