import { WhyNumber } from "@/components/why-number";
import { WhatsNew } from "@/components/whats-new";
import { ShareBrief } from "@/components/share-brief";
import { buildBrief } from "@/lib/morning-brief";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowLeft, CalendarCheck, CircleCheck, Inbox, Landmark, ShoppingBasket, Sparkles, Store, Wallet,
} from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, EmptyState, Kbd, KeyFigure, LinkButton, Meter, Section, Stepper, buttonClass } from "@/components/ui";
import { SectionBoundary } from "@/components/ui-client";
import { TaskList } from "@/components/task-list";
import { Changes } from "@/components/changes";
import { prioritize } from "@/lib/attention";
import { attentionItems } from "@/lib/work";
import { buildChanges, notable } from "@/lib/changes";
import { gatherChangeFacts } from "@/lib/changes-facts";
import { DAY, ITEM, SUPPLIER, countNoun } from "@/lib/arabic";
import { previousMonth } from "@/lib/filing";
import { currentMonthRiyadh, formatDay, formatMonth, formatWeekday } from "@/lib/riyadh-time";
import { loadStartState } from "@/services/start.service";
import { loadBalanceTotals, loadOverdueBalances } from "@/services/supplier-balance.service";
import { loadPaymentRun } from "@/services/payment-run.service";
import { loadRecurringInputs, weekDue } from "@/services/cash-outlook.service";
import type { WeekDue } from "@/lib/cash-outlook";
import { greeting, loadCashPosition, loadCloseProgress, longDate } from "@/services/briefing.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/** كم مهمّةً تُعرَض قبل «افتح الطابور». */
const SHOWN = 5;

/**
 * اليوم — إحاطةُ الصباح.
 *
 * شاشةٌ واحدة هادئة تجيب «ماذا أحتاج أن أعرف أو أفعل اليوم؟»:
 *
 *   ١. جملةٌ تقول الحال، وفعلٌ واحدٌ بارز: أهمُّ ما ينتظر.
 *   ٢. أربعةُ أرقامٍ لها جواب: كم عليك · كم يخرج هذا الأسبوع · كم في البنك
 *      وهل يكفي · كم اشتريت — وكلٌّ يفتح موضعه. والمجهولُ «غير معروف» لا صفر.
 *   ٣. ما ينتظر قرارك — العددُ نفسُه في القشرة والطابور.
 *   ٤. بجانبه: تقدّمُ إقفال الشهر، وما تغيّر منذ الأسبوع الماضي.
 *
 * والأقسامُ البطيئة (الإقفال) تصل بعد الصفحة في `Suspense` — فلا ينتظرها ما فوقها.
 */
/** ما يُسأل عنه لعرض بنود «الجديد» — صلاحياتُ `NewsItem.needs`. */
const NEWS_CAPABILITIES = ["payment:approve", "bank:view", "document:upload", "document:view"] as const;

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/");

  // مدير المشتريات لا يرى المال — تُعرض له وجهته مباشرةً
  if (!can(user.role, "amounts:view")) redirect("/upload");

  const runMonth = previousMonth(currentMonthRiyadh());
  const canPay = can(user.role, "payment:approve");
  const canBank = can(user.role, "bank:view");

  const attentionP = attentionItems(user.role);
  /* «ما الذي تغيّر» يجري مع الطابور لا بعده — يأخذ منه ارتفاعَ الأسعار وعداً */
  const factsP = gatherChangeFacts(attentionP.then((a) => {
    const rises = a.find((i) => i.id === "price-rises");
    return { count: rises?.count ?? 0, amountMinor: rises?.impact.amountMinor ?? 0 };
  }));
  const [attention, balances, overdue, start, run, cash, recurring, facts] = await Promise.all([
    attentionP,
    loadBalanceTotals(),
    loadOverdueBalances(),
    loadStartState(),
    canPay || canBank ? loadPaymentRun(runMonth) : Promise.resolve(null),
    canBank ? loadCashPosition() : Promise.resolve(null),
    canPay || canBank ? loadRecurringInputs() : Promise.resolve([]),
    factsP,
  ]);
  /* «ماذا أدفع هذا الأسبوع؟» — من الدفعة نفسها والمتكرّر، كما في «النقد القادم» */
  const week = run ? weekDue(run, recurring) : null;

  const { totals } = balances;
  const oldestDays = overdue.reduce((m, r) => Math.max(m, r.oldestDays), 0);

  const changes = notable(buildChanges(facts)).filter((c) => c.id !== "outstanding" && c.id !== "purchases");

  const { top } = prioritize(attention, SHOWN);
  const first = top[0];

  const pct = facts.purchasesPrevMonth > 0
    ? ((facts.purchasesThisMonth - facts.purchasesPrevMonth) / facts.purchasesPrevMonth) * 100
    : null;

  const name = user.name && user.name !== "وضع التجربة" ? user.name.split(" ")[0] : null;
  const title = name ? `${greeting()}، ${name}` : greeting();

  /* جملةُ الحال — تُبنى من الأرقام نفسها التي تحتها، لا من نموذج */
  const summary: string[] = [];
  if (start.knowsNothing) {
    summary.push("لم يقرأ النظام أي بيانات حتى الآن. خطوتان فقط، ويعرف لمن تدين وأين ذهبت أموالك.");
  } else {
    summary.push(attention.length === 0 ? "لا شيء يحتاج قرارك اليوم." : `${countNoun(attention.length, ITEM)} بانتظار قرارك.`);
    if (canPay && run && run.readyTotalMinor > 0) summary.push(`ودفعة ${formatMonth(runMonth)} جاهزة للتحويل (${countNoun(run.ready.length, SUPPLIER)}).`);
  }

  return (
    <PageShell
      user={user}
      width="wide"
      eyebrow={longDate()}
      title={title}
      display
      intro={summary.join(" ")}
      actions={
        <>
          {/* الإحاطةُ نصّاً لمن يريد إطلاعَ شريكه أو محاسبه — من الأرقام نفسها أدناه */}
          {!start.knowsNothing && (
            <ShareBrief
              text={buildBrief({
                dateLabel: longDate(),
                knowsNothing: start.knowsNothing,
                owedMinor: totals.owedMinor,
                owedSuppliers: totals.owedSuppliers,
                weekMinor: week ? week.totalMinor : null,
                balanceMinor: cash ? cash.balanceMinor : undefined,
                pending: attention.length,
              })}
            />
          )}
          {first && (
            <LinkButton href={first.href} variant="primary" size="lg" icon={ArrowLeft}>
              {`ابدأ بالأهم: ${first.actionLabel ?? "افتح"}`}
            </LinkButton>
          )}
        </>
      }
    >
      {!start.knowsNothing && (
        <WhatsNew allowed={NEWS_CAPABILITIES.filter((c) => can(user.role, c))} />
      )}

      {start.incomplete && (
        <section aria-labelledby="start-title" className="mb-8 rounded-2xl border border-accent-line bg-accent-soft/60 p-5 sm:p-6">
          <h2 id="start-title" className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="h-[18px] w-[18px] text-accent" strokeWidth={2} aria-hidden />
            {start.knowsNothing ? "ابدأ من هنا" : "خطوات قليلة لتكتمل الصورة"}
          </h2>
          <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-soft">
            {start.knowsNothing
              ? "لن يعرض النظام «صفراً» وهو لم يقرأ شيئاً. أكمل الخطوات بالترتيب."
              : "ما لم يُستورد بعد يظهر «غير معروف» وليس صفراً، والأرقام أدناه مبنية على ما قُرئ فقط."}
          </p>
          <Stepper
            steps={start.steps.map((s) => ({
              id: s.id,
              title: s.title,
              detail: s.done ? undefined : s.detail,
              state: s.done ? "done" : s === start.steps.find((x) => !x.done) ? "current" : "todo",
              action: s.done ? undefined : (
                <Link href={s.href} className={buttonClass(s === start.steps.find((x) => !x.done) ? "primary" : "secondary", "sm")}>
                  {s.action}
                </Link>
              ),
            }))}
          />
        </section>
      )}

      {/* ── الأرقامُ الأربعة: كلٌّ جوابُ سؤال، وكلٌّ يفتح موضعه ── */}
      {!start.knowsNothing && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KeyFigure
            icon={Store}
            label="المستحق للمورّدين"
            href="/suppliers"
            value={<Money minor={totals.owedMinor} />}
            tone={totals.owedMinor > 0 ? "warn" : undefined}
            sub={
              totals.owedMinor === 0
                ? "لا يوجد على المقهى أي مبلغ مستحق الآن."
                : `${countNoun(totals.owedSuppliers, SUPPLIER)}${oldestDays > 0 ? ` · أقدم مبلغ مستحق منذ ${countNoun(oldestDays, DAY)}` : ""}`
            }
          >
            {totals.creditLeftMinor > 0 && (
              <p className="text-xs text-ink-soft"><T s="ولك عندهم رصيد {0}" a={[<Money key="0" minor={totals.creditLeftMinor} />]} /></p>
            )}
            {/* الرقمُ يتغيّر بقيدٍ أو سداد — وهنا يُقال بماذا، ومن فعله */}
            <WhyNumber figure="owed" auditHref={can(user.role, "audit:view") ? "/settings/audit?kind=money" : undefined} />
          </KeyFigure>
          {week && (
            <KeyFigure
              icon={Wallet}
              label="مدفوعات هذا الأسبوع"
              href="/cash"
              tone={cash?.balanceMinor != null && cash.balanceMinor < week.totalMinor ? "danger" : undefined}
              value={
                week.lines.length === 0
                  ? <span className="text-[1.35rem] text-muted">لا مدفوعات مستحقة</span>
                  : <Money minor={week.totalMinor} />
              }
              sub={weekSummary(week, runMonth)}
            >
              {canPay && run && run.ready.length > 0 && (
                <Link href="/payments" className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent hover:underline hover:underline-offset-4 sm:min-h-0">
                  <T s="جهّز الدفعة {0}" a={[<ArrowLeft key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></Link>
              )}
            </KeyFigure>
          )}
          {cash && (
            <KeyFigure
              icon={Landmark}
              label="رصيد البنك"
              href="/cash"
              value={cash.balanceMinor === null ? <span className="text-[1.35rem] text-muted">غير معروف</span> : <Money minor={cash.balanceMinor} />}
              sub={cash.balanceMinor === null ? "لا يوجد كشف يظهر فيه الرصيد. استورد كشفاً فيه عمود الرصيد." : `آخر رصيد معروف · ${formatDay(cash.asOf)}`}
            >
              {cash.balanceMinor !== null && week && week.totalMinor > 0 && (
                cash.balanceMinor >= week.totalMinor ? (
                  <p className="text-xs text-ink-soft"><T s="يكفي لمدفوعات هذا الأسبوع، ويتبقى {0}" a={[<Money key="0" minor={cash.balanceMinor - week.totalMinor} />]} /></p>
                ) : (
                  <p className="text-xs font-bold text-danger"><T s="لا يكفي لمدفوعات هذا الأسبوع، وينقصه {0}" a={[<Money key="0" minor={week.totalMinor - cash.balanceMinor} />]} /></p>
                )
              )}
            </KeyFigure>
          )}
          <KeyFigure
            icon={ShoppingBasket}
            label={`مشتريات ${formatMonth(facts.thisMonthLabel)}`}
            href="/purchases/invoices"
            value={<Money minor={facts.purchasesThisMonth} />}
            sub={
              pct === null
                ? "محسوبة من الفواتير المسجّلة، لا من كشف البنك."
                : facts.daysElapsedInMonth === null
                  ? `عن ${formatMonth(facts.prevMonthLabel)}`
                  : `عن أول ${countNoun(facts.daysElapsedInMonth, DAY)} من ${formatMonth(facts.prevMonthLabel)}`
            }
            delta={pct}
          />
        </div>
      )}

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        {/* ── ما ينتظر قرارك ── */}
        <Section
          title="ما يحتاج قرارك"
          icon={Inbox}
          count={attention.length > 0 ? attention.length : undefined}
          className="mt-0!"
          action={
            attention.length > 0 ? (
              <Link href="/attention" className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent hover:underline hover:underline-offset-4 sm:min-h-0">
                <T s="اعرض القائمة كاملة {0}" a={[<ArrowLeft key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></Link>
            ) : undefined
          }
        >
          {attention.length > 0 ? (
            <>
              <TaskList items={top} />
              {attention.length > SHOWN && (
                <Link
                  href="/attention"
                  className="mt-2 flex min-h-11 items-center justify-center gap-1 rounded-xl border border-dashed border-line text-xs font-medium text-ink-soft transition-colors hover:border-accent-line hover:text-accent"
                >
                  <T s="و{0} أخرى في القائمة{1}" a={[countNoun(attention.length - SHOWN, ITEM), <ArrowLeft key="1" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></Link>
              )}
              <p className="mt-3 hidden text-[11px] text-muted lg:block">
                <T s="تنقّل بين البنود بالمفتاحين {0} و{1}، وافتح البند بمفتاح {2}." a={[<Kbd key="0">J</Kbd>, <Kbd key="1">K</Kbd>, <Kbd key="2">Enter</Kbd>]} /></p>
            </>
          ) : start.knowsNothing ? (
            <EmptyState
              compact
              title="هنا يظهر ما يحتاج قرارك"
              hint="بعد أن يقرأ النظام مستنداتك وكشف البنك، ستظهر هنا الأمور التي تحتاج قرارك."
            />
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-ok/25 bg-ok-bg px-5 py-6">
              <CircleCheck className="h-6 w-6 shrink-0 text-ok" strokeWidth={2} aria-hidden />
              <div>
                <p className="text-sm font-bold text-ok">لا شيء يحتاج قرارك.</p>
                <p className="mt-0.5 text-xs text-ink-soft">لا مبالغ دُفعت مرتين، ولا دفعات بلا مستند، ولا مستندات تنتظر المراجعة.</p>
              </div>
            </div>
          )}
        </Section>

        <div className="space-y-10">
          {can(user.role, "month:close") && !start.knowsNothing && (
            <SectionBoundary what={`تقدّم إقفال ${formatMonth(runMonth)}`}>
              <Suspense fallback={<CloseCardSkeleton />}>
                <CloseCard month={runMonth} />
              </Suspense>
            </SectionBoundary>
          )}

          {!start.knowsNothing && (
            <Section title="ما الجديد" icon={Sparkles} hint="منذ الأسبوع الماضي." className="mt-0!">
              <Changes changes={changes} />
            </Section>
          )}
        </div>
      </div>
    </PageShell>
  );
}

async function CloseCard({ month }: { month: string }) {
  const p = await loadCloseProgress(month);
  const blockers = p.report.blockers.length;
  const next = p.report.blockers[0] ?? p.report.warnings[0];
  return (
    <Section title={`إقفال ${formatMonth(month)}`} icon={CalendarCheck} className="mt-0!">
      <Link
        href="/close"
        className="block rounded-xl border border-line bg-raised p-4 shadow-raised transition-[border-color,box-shadow] hover:border-accent-line hover:shadow-lifted sm:p-5"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-bold">
            {p.closed ? "مقفل" : <><T s="{0} من {1} فحوص اجتازت" a={[<span key="0" className="nums">{p.passed}</span>, <span key="1" className="nums">{p.total}</span>]} /></>}
          </span>
          {p.closed ? (
            <Badge tone="ok" dot>مقفل</Badge>
          ) : blockers > 0 ? (
            <Badge tone="danger" dot>{blockers === 1 ? "عائق واحد" : blockers === 2 ? "عائقان" : `${blockers} عوائق`}</Badge>
          ) : (
            <Badge tone="accent" dot>جاهز للإقفال</Badge>
          )}
        </span>
        <span className="mt-3 block">
          <Meter value={p.closed ? p.total : p.passed} max={p.total} tone={p.closed || blockers === 0 ? "ok" : "accent"} label="تقدّم الإقفال" />
        </span>
        {!p.closed && next && (
          <span className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${next.state === "BLOCK" ? "bg-danger" : "bg-warn"}`} aria-hidden />
            <span><span className="font-bold text-ink">{next.label}:</span> {next.detail}</span>
          </span>
        )}
      </Link>
    </Section>
  );
}

function CloseCardSkeleton() {
  return (
    <div aria-busy="true">
      <div className="skeleton mb-3 h-5 w-40" />
      <div className="skeleton h-32 rounded-xl" />
    </div>
  );
}

/**
 * سطرُ «هذا الأسبوع»: المتأخّرُ من الدفعة أوّلاً، ثمّ أقربُ متكرّرٍ بيومه —
 * وما لا يومَ له يُذكَر ولا يُحسب، كي لا يُقرأ الرقمُ كاملاً وهو ناقص.
 */
function weekSummary(week: WeekDue, runMonth: string): string {
  const suppliers = week.lines.filter((l) => l.kind === "SUPPLIER");
  const recurring = week.lines.filter((l) => l.kind === "RECURRING");
  const parts: string[] = [];
  if (suppliers.length > 0) parts.push(`دفعة ${formatMonth(runMonth)} متأخرة ${suppliers.length === 1 ? "لمورّد واحد" : suppliers.length === 2 ? "لمورّدين" : `لـ${countNoun(suppliers.length, SUPPLIER)}`}`);
  if (recurring.length > 0 && recurring[0].date) {
    parts.push(`${recurring[0].label} ${formatWeekday(recurring[0].date)}${recurring.length > 1 ? ` و${countNoun(recurring.length - 1, ITEM)} آخر` : ""}`);
  }
  if (week.undated > 0) parts.push(`و${countNoun(week.undated, ITEM)} مصروف متكرر بلا يوم محدد`);
  return parts.length > 0 ? parts.join(" · ") : "لا دفعات متأخرة ولا مصروفات متكررة مستحقة خلال الأيام السبعة القادمة.";
}
