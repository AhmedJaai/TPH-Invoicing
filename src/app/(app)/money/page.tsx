import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, ChartColumn, CircleAlert, Info, Landmark, PieChart, Receipt, Scale, Upload,
} from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Figure } from "@/components/figure";
import { CashFlowChart } from "@/components/cash-flow-chart";
import { BarList, Callout, EmptyState, LinkButton, LinkTabs, NoAccess, Section } from "@/components/ui";
import { DAY, INVOICE, TRANSACTION, countNoun } from "@/lib/arabic";
import { daysSinceRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { BANK_STALE_DAYS } from "@/lib/attention";
import { loadMoneyView } from "@/services/money-view.service";

export const dynamic = "force-dynamic";

/**
 * أين ذهب المال — من كلّ ريالٍ خرج من الحساب، أين ذهب؟
 *
 *   ١. ثلاثةُ أرقام للفترة: الصادر (ببيان مصدره)، والوارد، والصافي.
 *   ٢. الصادرُ مقسوماً على أبوابه حتى يُجمَع إليه — وما لم يُصنَّف معلَنٌ
 *      بمبلغه ومعه فعلُ تصنيفه، لا مطمورٌ في غيره.
 *   ٣. الوارد والصادر شهراً بشهر، والشهرُ الجزئيّ معلَن.
 *
 * والإيرادُ لا يُعرَض هنا: المبيعات لا تصل إلى هذه الصفحة، والواردُ إيداعاتُ
 * الشبكة والتحويلات. فيُقال ذلك ولا يُكتب «الإيراد ٠٫٠٠».
 */
export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/money");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} title="أين ذهب المال">
        <NoAccess />
      </PageShell>
    );
  }

  const p = await searchParams;
  const asked = p.month && /^\d{4}-\d{2}$/.test(p.month) ? p.month : null;
  const v = await loadMoneyView(asked);
  const month = asked && v.months.includes(asked) ? asked : null;

  /*
    ── بلا كشفٍ لا جوابَ هنا ──

    كانت الصفحةُ على قاعدةٍ بلا كشف تقول «الصادر ٠٫٠٠ · كلُّ الصادر معروفُ
    الوجه» بالأخضر. أصفارٌ عن غير علم. فيُقال ما ينقص، ومعه فعلُه.
  */
  if (v.txCount === 0) {
    return (
      <PageShell user={user} width="wide" title="أين ذهب المال" intro="من كشف بنكك، لا من تقدير.">
        <EmptyState
          icon={Landmark}
          title="لم يُستورَد كشفُ بنكٍ بعد."
          hint="بلا كشفٍ لا يُعرَف ما خرج من الحساب ولا أين — فلا يُعرَض هنا رقمٌ يُقرأ صفراً. استورد كشف الحساب، فتظهر هنا أبوابُ الصادر وحركةُ كلّ شهر."
          action={<LinkButton href="/bank#import" variant="primary" icon={Upload}>استورد كشف البنك</LinkButton>}
        />
      </PageShell>
    );
  }

  const staleDays = v.lastDay ? daysSinceRiyadh(v.lastDay) : null;
  const stale = staleDays !== null && staleDays > BANK_STALE_DAYS;
  const netMinor = v.inMinor - v.outMinor;
  const periodLabel = month ? formatMonth(month) : "الفترة كلّها";

  /* الشهرُ الذي لم يغطّه الكشفُ كلَّه — أوّلُ الكشف وآخرُه */
  const partial = new Map<string, string>();
  if (v.firstDay && !v.firstDay.endsWith("-01")) partial.set(v.firstDay.slice(0, 7), `من ${formatDay(v.firstDay)}`);
  if (v.lastDay && !isMonthEnd(v.lastDay)) partial.set(v.lastDay.slice(0, 7), `حتى ${formatDay(v.lastDay)}`);

  const monthHref = (m: string | null) => (m ? `/money?month=${m}` : "/money");
  const expenseTotal = v.buckets.filter((b) => b.kind === "expense" || b.kind === "fees").reduce((s, b) => s + b.minor, 0);

  return (
    <PageShell
      user={user}
      width="wide"
      title="أين ذهب المال"
      eyebrow={
        <span className={stale ? "font-bold text-warn" : ""}>
          {stale && <CircleAlert className="me-1 inline-block h-3.5 w-3.5 align-[-2px]" strokeWidth={2} aria-hidden />}
          من كشف البنك: <bdi>{formatDay(v.firstDay)}</bdi> إلى <bdi>{formatDay(v.lastDay)}</bdi>
          {stale && <> — وقف منذ {countNoun(staleDays, DAY)}</>}
        </span>
      }
      intro="كلُّ ريالٍ خرج من حسابك وإلى أين ذهب، وما دخل إليه — من الكشف نفسه لا من تقدير. وما لم يُصنَّف معلَنٌ بمبلغه."
      actions={stale ? <LinkButton href="/bank#import" icon={Upload} variant="primary">استورد الأحدث</LinkButton> : undefined}
    >
      {v.months.length > 1 && (
        <div className="mb-5">
          <LinkTabs
            label="الفترة"
            items={[
              { href: monthHref(null), label: "الفترة كلّها", active: month === null },
              ...v.months.map((m) => ({
                href: monthHref(m),
                label: partial.has(m) ? `${formatMonth(m)} (جزئيّ)` : formatMonth(m),
                active: m === month,
              })),
            ]}
          />
        </div>
      )}

      {/* ── الأرقامُ الثلاثة للفترة ── */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <Figure
          icon={<ArrowUpRight strokeWidth={2} aria-hidden />}
          label={`الصادر · ${periodLabel}`}
          provenance={v.outflow}
          unit="حركة"
          href={month ? `/bank?month=${month}#transactions` : "/bank#transactions"}
          /*
            الرقمُ يستثني ما لم يُعرف وجهه — والاستثناءُ يُقال بعدده ومبلغه
            تحته، لا خلف زرّ.
          */
          note={
            v.unknown.count > 0 ? (
              <span className="text-warn">
                وخارجه {countNoun(v.unknown.count, TRANSACTION)} بـ<Money minor={v.unknown.minor} /> لم يُعرف وجهها.
              </span>
            ) : (
              "كلُّ الصادر في هذه الفترة معروفُ الوجه."
            )
          }
        />
        <Figure
          icon={<ArrowDownLeft strokeWidth={2} aria-hidden />}
          label={`الوارد · ${periodLabel}`}
          value={<Money minor={v.inMinor} />}
          href={month ? `/bank?show=in&month=${month}#transactions` : "/bank?show=in#transactions"}
          note="إيداعاتُ الشبكة والتحويلات إلى الحساب — لا «مبيعات»."
        />
        <Figure
          icon={<Scale strokeWidth={2} aria-hidden />}
          label="الصافي"
          value={<Money minor={netMinor} />}
          tone={netMinor < 0 ? "danger" : undefined}
          note={
            month && partial.has(month)
              ? `شهرٌ جزئيّ (${partial.get(month)}) — لا يُقارَن بشهرٍ كامل.`
              : "الوارد ناقصاً كلَّ ما خرج، ومنه ما لم يُصنَّف."
          }
        />
      </div>

      <Callout tone="info" icon={Info} className="mt-4">
        <strong className="text-ink">الإيراد غير معروف هنا.</strong> مبيعاتُ فودكس لا تصل إلى هذه الصفحة، فلا يُحسب ربحٌ ولا هامش —
        والصافي أعلاه حركةُ الحساب لا ربحُ المقهى.
      </Callout>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* ── أين ذهب الصادر ── */}
        <Section
          title="أين ذهب"
          icon={PieChart}
          className="mt-0!"
          hint={`الصادرُ في ${periodLabel} مقسوماً على أبوابه — والمجموعُ هو الصادرُ كلُّه. سدادُ المورّدين محسوبٌ في المشتريات، وسحبُ المالك ليس مصروفاً.`}
          action={
            <Link href={month ? `/money/expenses?month=${month}` : "/money/expenses"} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent hover:underline sm:min-h-0">
              المصروفات بالتفصيل <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </Link>
          }
        >
          <div className="rounded-2xl border border-line bg-raised p-3 shadow-raised sm:p-4">
            {v.buckets.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted">لا صادرَ في {periodLabel}.</p>
            ) : (
              <BarList
                items={v.buckets.map((b) => ({
                  key: b.key,
                  label: b.label,
                  minor: b.minor,
                  href: b.href,
                  sub: `${countNoun(b.count, TRANSACTION)} · ${share(b.minor, v.outMinor)}`,
                }))}
              />
            )}

            {/* ما لم يُصنَّف يُعلَن بمبلغه ومعه فعلُه — لا شريطاً بين الأشرطة */}
            {v.unknown.count > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-warn/25 bg-warn-bg px-3 py-2.5">
                <CircleAlert className="h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
                <p className="min-w-0 flex-1 text-xs text-ink-soft">
                  <span className="font-bold text-warn">لم يُصنَّف بعد: <Money minor={v.unknown.minor} /></span>
                  {" "}— {countNoun(v.unknown.count, TRANSACTION)}، فتوزيعُ ما فوقه ناقصٌ بقدرها.
                </p>
                <LinkButton href="/bank?show=unknown#transactions" size="sm" variant="primary">صنّفها</LinkButton>
              </div>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line-soft px-2 pt-3 text-xs">
              <div>
                <dt className="text-muted">الصادرُ كلُّه</dt>
                <dd className="mt-0.5 text-sm font-bold"><Money minor={v.outMinor} /></dd>
              </div>
              <div>
                <dt className="text-muted">منه مصروفٌ تشغيليّ ورسوم</dt>
                <dd className="mt-0.5 text-sm font-bold"><Money minor={expenseTotal} /></dd>
              </div>
            </dl>
          </div>
        </Section>

        {/* ── شهراً بشهر ── */}
        <Section
          title="شهراً بشهر"
          icon={ChartColumn}
          className="mt-0!"
          hint="الوارد والصادر في كلّ شهر من الكشف. اضغط شهراً لتقرأ أبوابه."
        >
          <CashFlowChart months={v.flow.months} partial={partial} hrefOf={(m) => monthHref(m)} active={month} />
        </Section>
      </div>

      {/* ── الضريبة في الفواتير — ليست حركة بنك، لكنّها مالٌ يعود أو يضيع ── */}
      <Section title="ضريبةُ المشتريات" icon={Receipt} hint="من الفواتير المسجّلة، لا من الكشف.">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <Link href="/purchases/invoices?tax=VALID" className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3.5 shadow-raised transition-colors hover:border-accent-line">
            <span>
              <span className="block text-xs font-bold text-muted">قابلةٌ للاسترداد</span>
              <span className="mt-0.5 block text-[11px] text-muted">من فواتير ضريبيّة كاملة</span>
            </span>
            <span className="text-lg font-bold text-ok"><Money minor={v.vat.recoverableMinor} /></span>
          </Link>
          <Link href="/purchases/invoices?tax=INVALID" className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3.5 shadow-raised transition-colors hover:border-accent-line">
            <span>
              <span className="block text-xs font-bold text-muted">معرَّضةٌ للضياع</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                {v.vat.unknownInvoices > 0
                  ? `ولم يُقرأ تفصيلُ ${countNoun(v.vat.unknownInvoices, INVOICE)} بعد`
                  : "من فواتير لا تصلح للخصم"}
              </span>
            </span>
            <span className={`text-lg font-bold ${v.vat.atRiskMinor > 0 ? "text-danger" : ""}`}><Money minor={v.vat.atRiskMinor} /></span>
          </Link>
        </div>
      </Section>
    </PageShell>
  );
}

function isMonthEnd(day: string): boolean {
  const d = new Date(`${day}T12:00:00Z`);
  const next = new Date(d);
  next.setUTCDate(d.getUTCDate() + 1);
  return next.getUTCMonth() !== d.getUTCMonth();
}

/** النسبة من الصادر كلّه — تقريبٌ إلى عددٍ صحيح، وما دون الواحد «أقلّ من ١٪». */
function share(minor: number, total: number): string {
  if (total <= 0) return "";
  const pct = (minor / total) * 100;
  return pct < 1 ? "أقلّ من 1٪" : `${Math.round(pct)}٪`;
}
