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
import { Badge, Delta, EmptyState, LinkButton, Meter, Section, Stepper, buttonClass } from "@/components/ui";
import { TaskList } from "@/components/task-list";
import { Changes } from "@/components/changes";
import { prioritize } from "@/lib/attention";
import { attentionItems } from "@/lib/work";
import { buildChanges, notable } from "@/lib/changes";
import { gatherChangeFacts } from "@/lib/changes-facts";
import { DAY, INVOICE, ITEM, SUPPLIER, countNoun } from "@/lib/arabic";
import { previousMonth } from "@/lib/filing";
import { currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadStartState } from "@/services/start.service";
import { loadBalanceTotals, loadOverdueBalances } from "@/services/supplier-balance.service";
import { loadPaymentRun } from "@/services/payment-run.service";
import { greeting, loadCashPosition, loadCloseProgress, longDate } from "@/services/briefing.service";

export const dynamic = "force-dynamic";

/** كم مهمّةً تُعرَض قبل «افتح الطابور». */
const SHOWN = 5;

/**
 * اليوم — إحاطةُ الصباح.
 *
 * شاشةٌ واحدة هادئة تجيب «ماذا أحتاج أن أعرف أو أفعل اليوم؟»:
 *
 *   ١. جملةٌ تقول الحال، وفعلٌ واحدٌ بارز: أهمُّ ما ينتظر.
 *   ٢. أربعةُ أرقامٍ لها جواب: كم عليك · كم تدفع هذا الشهر · كم في البنك ·
 *      كم اشتريت — وكلٌّ يفتح موضعه. والمجهولُ «غير معروف» لا صفر.
 *   ٣. ما ينتظر قرارك — العددُ نفسُه في القشرة والطابور.
 *   ٤. بجانبه: تقدّمُ إقفال الشهر، وما تغيّر منذ الأسبوع الماضي.
 *
 * والأقسامُ البطيئة (الإقفال) تصل بعد الصفحة في `Suspense` — فلا ينتظرها ما فوقها.
 */
export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/");

  // مدير المشتريات لا يرى المال — تُعرض له وجهته مباشرةً
  if (!can(user.role, "amounts:view")) redirect("/upload");

  const runMonth = previousMonth(currentMonthRiyadh());
  const canPay = can(user.role, "payment:approve");

  const [attention, balances, overdue, start, run, cash] = await Promise.all([
    attentionItems(),
    loadBalanceTotals(),
    loadOverdueBalances(),
    loadStartState(),
    canPay ? loadPaymentRun(runMonth) : Promise.resolve(null),
    can(user.role, "bank:view") ? loadCashPosition() : Promise.resolve(null),
  ]);

  const { totals } = balances;
  const oldestDays = overdue.reduce((m, r) => Math.max(m, r.oldestDays), 0);

  const rises = attention.find((i) => i.id === "price-rises");
  const facts = await gatherChangeFacts(rises?.count ?? 0, rises?.impact.amountMinor ?? 0);
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
    summary.push("النظامُ لا يعرف شيئاً بعد — خطوتان تكفيان ليعرف لمن تدين وأين ذهب المال.");
  } else {
    summary.push(attention.length === 0 ? "لا شيء ينتظر قرارك اليوم." : `ينتظر قرارك ${countNoun(attention.length, ITEM)}.`);
    if (run && run.readyTotalMinor > 0) summary.push(`ودفعةُ ${formatMonth(runMonth)} جاهزةٌ للتحويل (${countNoun(run.ready.length, SUPPLIER)}).`);
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
        first ? (
          <LinkButton href={first.href} variant="primary" size="lg" icon={ArrowLeft}>
            {`ابدأ بالأهمّ: ${first.actionLabel ?? "افتح"}`}
          </LinkButton>
        ) : undefined
      }
    >
      {start.incomplete && (
        <section aria-labelledby="start-title" className="mb-8 rounded-2xl border border-accent-line bg-accent-soft/60 p-5 sm:p-6">
          <h2 id="start-title" className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="h-[18px] w-[18px] text-accent" strokeWidth={2} aria-hidden />
            {start.knowsNothing ? "ابدأ من هنا" : "بقي ما يُكمل الصورة"}
          </h2>
          <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-soft">
            {start.knowsNothing
              ? "لا يقول لك النظامُ «عليك صفر» وهو لم يقرأ شيئاً. أكمل الخطوات بترتيبها."
              : "ما لم يُستورَد مجهولٌ لا صفر — والأرقامُ أدناه على ما قُرئ وحده."}
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
          <HeroFigure
            icon={Store}
            label="عليك للمورّدين"
            href="/suppliers"
            value={<Money minor={totals.owedMinor} />}
            tone={totals.owedMinor > 0 ? "warn" : undefined}
            sub={
              totals.owedMinor === 0
                ? "لا مستحقّ على المقهى الآن."
                : `${countNoun(totals.owedSuppliers, SUPPLIER)}${oldestDays > 0 ? ` · أقدمُ دَينٍ منذ ${countNoun(oldestDays, DAY)}` : ""}`
            }
            extra={totals.creditLeftMinor > 0 ? <>ولك عندهم <Money minor={totals.creditLeftMinor} /></> : undefined}
          />
          {run && (
            <HeroFigure
              icon={Wallet}
              label={`دفعة ${formatMonth(runMonth)}`}
              href="/payments"
              value={<Money minor={run.readyTotalMinor} />}
              sub={
                run.ready.length === 0 && run.held.length === 0
                  ? "لا مستحقّات جاهزة للتحويل."
                  : `جاهزةٌ لـ${run.ready.length === 1 ? "مورّدٍ واحد" : run.ready.length === 2 ? "مورّدَين" : countNoun(run.ready.length, SUPPLIER)}${run.held.length > 0 ? ` · ومحجوزٌ ${countNoun(run.held.length, INVOICE)}` : ""}`
              }
            />
          )}
          {cash && (
            <HeroFigure
              icon={Landmark}
              label="في البنك"
              href="/cash"
              value={cash.balanceMinor === null ? <span className="text-[1.35rem] text-muted">غير معروف</span> : <Money minor={cash.balanceMinor} />}
              sub={cash.balanceMinor === null ? "لا كشفَ يحمل الرصيد — استورد كشفاً فيه عمودُ الرصيد." : `آخرُ رصيدٍ معروف · ${formatDay(cash.asOf)}`}
            />
          )}
          <HeroFigure
            icon={ShoppingBasket}
            label={`مشتريات ${formatMonth(facts.thisMonthLabel)}`}
            href="/purchases/invoices"
            value={<Money minor={facts.purchasesThisMonth} />}
            sub={
              pct === null
                ? "من الفواتير المسجّلة، لا من كشف البنك."
                : facts.daysElapsedInMonth === null
                  ? `عن ${formatMonth(facts.prevMonthLabel)}`
                  : `عن أوّل ${countNoun(facts.daysElapsedInMonth, DAY)} من ${formatMonth(facts.prevMonthLabel)}`
            }
            delta={pct}
          />
        </div>
      )}

      <div className="mt-10 grid gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        {/* ── ما ينتظر قرارك ── */}
        <Section
          title="ما ينتظر قرارك"
          icon={Inbox}
          count={attention.length > 0 ? attention.length : undefined}
          className="mt-0!"
          action={
            attention.length > 0 ? (
              <Link href="/attention" className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent hover:underline hover:underline-offset-4 sm:min-h-0">
                افتح الطابور كاملاً <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              </Link>
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
                  وبقي {countNoun(attention.length - SHOWN, ITEM)} في الطابور
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </Link>
              )}
              <p className="mt-3 hidden text-[11px] text-muted lg:block">
                تنقّل بين البنود بـ<kbd className="rounded border border-line px-1">J</kbd> و<kbd className="rounded border border-line px-1">K</kbd>، وافتح بـ<kbd className="rounded border border-line px-1">Enter</kbd>.
              </p>
            </>
          ) : start.knowsNothing ? (
            <EmptyState
              compact
              title="يظهر هنا ما يحتاج قرارك"
              hint="حين يقرأ النظامُ مستنداتك وكشفَ بنكك — لا قبل ذلك، ولا يقول «سليم» عن غير علم."
            />
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-ok/25 bg-ok-bg px-5 py-6">
              <CircleCheck className="h-6 w-6 shrink-0 text-ok" strokeWidth={2} aria-hidden />
              <div>
                <p className="text-sm font-bold text-ok">لا شيء ينتظر قرارك.</p>
                <p className="mt-0.5 text-xs text-ink-soft">لا مالٌ خرج مرّتين، ولا دفعةٌ بلا مستند، ولا مستندٌ ينتظر.</p>
              </div>
            </div>
          )}
        </Section>

        <div className="space-y-10">
          {can(user.role, "month:close") && !start.knowsNothing && (
            <Suspense fallback={<CloseCardSkeleton />}>
              <CloseCard month={runMonth} />
            </Suspense>
          )}

          {!start.knowsNothing && (
            <Section title="ما الذي تغيّر" icon={Sparkles} hint="منذ الأسبوع الماضي." className="mt-0!">
              <Changes changes={changes} />
            </Section>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function HeroFigure({
  icon: Icon,
  label,
  value,
  sub,
  href,
  tone,
  delta,
  extra,
}: {
  icon: typeof Store;
  label: string;
  value: React.ReactNode;
  sub: string;
  href: string;
  tone?: "warn";
  delta?: number | null;
  extra?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[9.5rem] flex-col rounded-2xl border border-line bg-raised p-4 shadow-raised transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-accent-line hover:shadow-lifted sm:p-5"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold text-muted">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-sunken text-ink-soft transition-colors group-hover:bg-accent-soft group-hover:text-accent">
            <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          {label}
        </span>
        {delta !== undefined && <Delta pct={delta} />}
      </span>
      <span className={`mt-4 block text-[1.75rem] font-bold leading-none tracking-tight sm:text-[2.1rem] ${tone === "warn" ? "text-warn" : ""}`}>
        {value}
      </span>
      <span className="mt-auto pt-3 text-xs leading-relaxed text-muted">
        {sub}
        {extra && <span className="mt-0.5 block text-ink-soft">{extra}</span>}
      </span>
    </Link>
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
            {p.closed ? "مُقفَل" : <><span className="nums">{p.passed}</span> من <span className="nums">{p.total}</span> فحوصٍ سليمة</>}
          </span>
          {p.closed ? (
            <Badge tone="ok" dot>مُقفَل</Badge>
          ) : blockers > 0 ? (
            <Badge tone="danger" dot>{blockers === 1 ? "مانعٌ واحد" : blockers === 2 ? "مانعان" : `${blockers} موانع`}</Badge>
          ) : (
            <Badge tone="accent" dot>جاهزٌ للإقفال</Badge>
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
