import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import {
  Banknote, CalendarClock, FileText, History, Printer, Scale, ScrollText, Sparkles, Tags, Timer,
} from "lucide-react";
import { db } from "@/db";
import { invoices, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import {
  Badge, Card, DataTable, Delta, EmptyState, KeyValue, LinkButton, LinkTabs, Meter, Monogram, Section, Sparkline, TONE_TEXT,
  Timeline, type TimelineItem, type Tone,
} from "@/components/ui";
import { AgeingBar } from "@/components/supplier-intel";
import {
  DIMENSION_LABEL,
  GRADE_LABEL,
  buildSupplierHealth,
  type Grade,
} from "@/lib/supplier-health";
import { buildSupplierAccount, describeAccount } from "@/lib/supplier-account";
import { countNoun, DAY, INVOICE, LINE, MONTH, PRODUCT, TIME } from "@/lib/arabic";
import { loadOpenInvoiceAges, loadSupplierBalances } from "@/services/supplier-balance.service";
import { loadSupplierIntel, type TimelineEvent } from "@/services/supplier-intel.service";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { listOpenFindings } from "@/services/supplier-analysis.service";
import { FindingsList, RunAnalysis, type FindingView } from "@/components/ai-analysis";
import { splitSupplierCredit } from "@/lib/supplier-requests";
import { SupplierPolicy } from "@/components/supplier-policy";
import { formatDay, formatRange } from "@/lib/riyadh-time";
import { METHOD_LABEL, paymentStatusLabel } from "@/lib/payment-state";
import { invoiceHref } from "@/lib/invoice-profile";
import { ACTION_LABEL } from "@/lib/audit-labels";
import { MIN_SETTLED_SAMPLE, ageOwed, ageTone } from "@/lib/supplier-intel";

export const dynamic = "force-dynamic";

/**
 * ملفّ المورّد — مكانٌ واحد لكلّ ما يُسأل عنه قبل الدفع والتفاوض.
 *
 *   ١. كم عليك له ومنذ متى — الرقمُ من مصدر الأرصدة، وتحته أعمارُه
 *      ومعادلتُه بأطرافها، وكلُّ طرفٍ يفتح سجلّاته.
 *   ٢. ما نعرفه مقابل ما يقوله كشفه — والفرقُ ليس اتّهاماً.
 *   ٣. كيف تسدّد له — من التخصيصات الحقيقيّة وحدها، وما قلّت عيّنتُه «غير معروف».
 *   ٤. التفصيل خلف ألسنة (فواتيره · دفعاته · أسعاره · كشوفه · بياناته)،
 *      وبجانبه «آخر ما جرى» خطّاً زمنيّاً.
 *
 * وكشفُ حسابه المطبوع في `./statement`.
 */

const GRADE_TONE: Record<Grade, Tone | undefined> = {
  GOOD: "ok",
  FAIR: "warn",
  POOR: "danger",
  UNRATED: "muted",
};

type Tab = "invoices" | "payments" | "prices" | "statements" | "profile";

const TABS: { id: Tab; label: string }[] = [
  { id: "invoices", label: "فواتيره" },
  { id: "payments", label: "دفعاته" },
  { id: "prices", label: "أسعاره" },
  { id: "statements", label: "كشوفه" },
  { id: "profile", label: "بياناته" },
];

export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/suppliers");

  const { slug } = await params;
  const wantedTab = (await searchParams).tab;
  const tab: Tab = TABS.find((t) => t.id === wantedTab)?.id ?? "invoices";
  const showAmounts = can(user.role, "amounts:view");

  const [s] = await db.select().from(suppliers).where(eq(suppliers.slug, slug));
  if (!s) notFound();

  const [statsRes, balRows, ages, findingsRaw] = await Promise.all([
    db.execute<Record<string, number | string | null>>(sql`
      select
        (select count(*)::int from invoices where supplier_id = ${s.id})            as invoice_count,
        (select coalesce(sum(total_minor), 0)::bigint from invoices
          where supplier_id = ${s.id})                                             as billed,
        (select coalesce(sum(pa.amount_minor), 0)::bigint from payment_allocations pa
          join invoices i on i.id = pa.invoice_id where i.supplier_id = ${s.id})    as paid,
        (select count(*)::int from invoices
          where supplier_id = ${s.id} and tax_status = 'VALID')                     as tax_valid,
        (select count(*)::int from invoices
          where supplier_id = ${s.id} and tax_status = 'INVALID')                   as tax_invalid,
        (select count(*)::int from invoices
          where supplier_id = ${s.id} and tax_status = 'UNKNOWN')                   as tax_unknown,
        (select count(*)::int from statements where supplier_id = ${s.id})          as statement_count,
        -- آخرُ رصيدٍ ختاميّ قرأناه من كشوفه. وقد يغيب: كشفٌ وصل ولم
        -- يُقرأ رصيدُه ليس كشفاً يقول «صفر».
        (select closing_balance_minor from statements
          where supplier_id = ${s.id} and closing_balance_minor is not null
          order by period_end desc nulls last limit 1)                              as reported_balance,
        (select to_char(period_end, 'YYYY-MM-DD') from statements
          where supplier_id = ${s.id} and closing_balance_minor is not null
          order by period_end desc nulls last limit 1)                              as reported_at,
        -- الأشهر التي تغطّيها كشوفه لا عددُ ملفّاتها: كشفٌ تراكميّ لأربعة أشهر أربعة
        (select count(distinct to_char(m, 'YYYY-MM'))::int
           from statements st,
                generate_series(date_trunc('month', coalesce(st.period_start, st.period_end)),
                                date_trunc('month', st.period_end), interval '1 month') m
          where st.supplier_id = ${s.id} and st.period_end is not null)            as statement_months,
        (select count(distinct period_month)::int from invoices
          where supplier_id = ${s.id})                                             as active_months,
        (select count(*)::int from supplier_aliases where supplier_id = ${s.id})    as alias_count,
        (select count(*)::int from supplier_products where supplier_id = ${s.id})   as product_count,
        -- المقدَّمة المعلَنة — وحدها «لك عنده» (SCN-105)
        (select coalesce(sum(amount_minor - fee_minor), 0)::bigint from payments
          where supplier_id = ${s.id} and status = 'ADVANCE')                       as advance
    `),
    loadSupplierBalances(db, s.id),
    loadOpenInvoiceAges(s.id),
    showAmounts ? listOpenFindings(s.id) : Promise.resolve([]),
  ]);

  const stats = statsRes.rows[0];
  const n = (k: string) => Number(stats?.[k] ?? 0);
  const billed = n("billed");

  /*
    ما عليك له = فواتيره المفتوحة ناقصَ ما دفعتَه له ولم يُخصم من فاتورة —
    من `loadSupplierBalances` وحدها، كما في القائمة والرئيسية.
  */
  const bal = balRows[0];
  /* «المسدَّد» ما عدا المفتوحَ الذي يعدّه مصدرُ الأرصدة — لا عتبةٌ ثانية */
  const intel = await loadSupplierIntel(s.id, bal?.openCount ?? 0);
  const balance = bal?.owedMinor ?? 0;
  const creditLeft = bal?.creditLeftMinor ?? 0;
  const paidNet = bal?.paidNetMinor ?? n("paid");
  const creditSplit = splitSupplierCredit(creditLeft, n("advance"));
  const ageing = ageOwed(ages.get(s.id) ?? [], balance);
  const ageOf = new Map((ages.get(s.id) ?? []).map((a) => [a.id, a.ageDays]));

  const canAnalyze = can(user.role, "supplier:edit");
  const canApprove = can(user.role, "payment:approve");
  const findings: FindingView[] = findingsRaw.map((f) => ({
    id: f.id, supplierId: f.supplierId, supplierName: f.supplierName, supplierSlug: f.supplierSlug,
    kind: f.kind, severity: f.severity, title: f.title, explanation: f.explanation,
    amountMinor: f.amountMinor, action: f.action,
    refs: f.refs.map((r) => ({ label: r.label, type: r.type })),
    createdAt: f.createdAt.toISOString(),
  }));

  /*
    ══ حسابُ المورّد: ما نعرفه مقابل ما يقول ══

    والمقارنةُ بالكشف في زمنه: آخرُ رصيدٍ في كشفه يُقارَن بما نعرفه حتى
    تاريخه، وما دُفع بعده يُعرَض بجانبه (الكوب الذهبي: الفرق ١٥٢٫٣٧
    كذباً، وحقيقتُه ٦٬٠٠٦٫٧٥ عند تاريخ الكشف).
  */
  const reportedRaw = stats?.["reported_balance"];
  const reportedAt = typeof stats?.["reported_at"] === "string" ? (stats["reported_at"] as string) : null;

  const [atStatement] = reportedAt
    ? (await db.execute<{ billed: string; paid: string; allocated_after: string }>(sql`
        select
          (select coalesce(sum(total_minor), 0)::bigint from invoices
            where supplier_id = ${s.id} and invoice_date::date <= ${reportedAt}::date) as billed,
          (select coalesce(sum(amount_minor - fee_minor), 0)::bigint from payments
            where supplier_id = ${s.id} and status not in ('REVERSED','VOID')
              and paid_at::date <= ${reportedAt}::date)                                as paid,
          /* ما سُدّد بعد الكشف من فواتير سبقته — يبدو مفتوحاً عنده ومسدَّداً اليوم */
          (select coalesce(sum(pa.amount_minor), 0)::bigint
             from payment_allocations pa
             join payments p on p.id = pa.payment_id
             join invoices i on i.id = pa.invoice_id
            where p.supplier_id = ${s.id} and p.status not in ('REVERSED','VOID')
              and p.paid_at::date > ${reportedAt}::date
              and i.invoice_date::date <= ${reportedAt}::date)                         as allocated_after
      `)).rows
    : [];
  const invoicesAtStatement = reportedAt
    ? (await db.execute<{ invoice_number: string; total_minor: string }>(sql`
        select invoice_number, total_minor from invoices
         where supplier_id = ${s.id} and invoice_date::date <= ${reportedAt}::date
      `)).rows.map((r) => ({ invoiceNumber: r.invoice_number, totalMinor: Number(r.total_minor) }))
    : [];
  const paidAfterStatement = atStatement ? paidNet - Number(atStatement.paid) : 0;

  const account = buildSupplierAccount({
    billedMinor: atStatement ? Number(atStatement.billed) : billed,
    paidMinor: atStatement ? Number(atStatement.paid) : paidNet,
    reportedBalanceMinor: reportedRaw === null || reportedRaw === undefined ? null : Number(reportedRaw),
    allocatedAfterStatementMinor: atStatement ? Number(atStatement.allocated_after) : null,
    invoicesAtStatement,
  });

  /*
    تغيّر السعر للتقييم: متوسّط سعر الوحدة في أوّل شهر مقابل آخر شهر، من
    بنودٍ بسعرٍ موثوق وحدها — وإلّا بقي `null` ولم يُقيَّم البُعد.
  */
  const priceRows = (
    await db.execute<{ month: string; avg_unit: string; lines: number }>(sql`
      select i.period_month as month, avg(l.unit_price_minor)::bigint as avg_unit, count(*)::int as lines
      from invoice_lines l
      join invoices i on i.id = l.invoice_id
      where l.supplier_id = ${s.id} and l.unit_price_minor is not null and l.unit_price_minor > 0
      group by i.period_month
      having count(*) >= 3
      order by i.period_month
    `)
  ).rows;
  const priceChangePct =
    priceRows.length >= 2 && Number(priceRows[0].avg_unit) > 0
      ? ((Number(priceRows[priceRows.length - 1].avg_unit) - Number(priceRows[0].avg_unit)) / Number(priceRows[0].avg_unit)) * 100
      : null;

  const health = buildSupplierHealth({
    invoiceCount: n("invoice_count"),
    taxValidCount: n("tax_valid"),
    taxInvalidCount: n("tax_invalid"),
    taxUnknownCount: n("tax_unknown"),
    issuesInvoices: s.issuesInvoices,
    contractOnFile: s.contractOnFile,
    hasVatNumber: Boolean(s.vatNumber),
    statementCount: n("statement_months"),
    activeMonths: n("active_months"),
    priceChangePct,
  });

  /* ── بيانات اللسان المفتوح وحده ── */
  const recent = tab === "invoices"
    ? await db
        .select({
          id: invoices.id,
          number: invoices.invoiceNumber,
          date: invoices.invoiceDate,
          total: invoices.totalMinor,
          taxStatus: invoices.taxStatus,
          /* `${invoices}.id` لا `${invoices.id}` — الثاني يصمت في الاستعلام الفرعيّ */
          allocated: sql<number>`coalesce((
            select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = ${invoices}.id
          ), 0)`,
        })
        .from(invoices)
        .where(eq(invoices.supplierId, s.id))
        .orderBy(desc(invoices.invoiceDate))
        .limit(60)
    : [];

  const statementRows = (
    await db.execute<{ id: string; ps: string; pe: string; closing: number | null; lines: number; matched: number }>(sql`
      select st.id, st.period_start::text as ps, st.period_end::text as pe, st.closing_balance_minor as closing,
             (select count(*)::int from statement_lines sl where sl.statement_id = st.id) as lines,
             (select count(*)::int from statement_lines sl where sl.statement_id = st.id and sl.match_status = 'MATCHED') as matched
        from statements st
       where st.supplier_id = ${s.id}
       order by st.period_end desc
       limit 24
    `)
  ).rows;

  /*
    دفعاته — والسؤال الذي تُفتح له الصفحة قبل التفاوض «لِمَ عليّ هذا؟»
    لا يُجاب إلّا بالطرفين: ما فُوتر وما دُفع.
  */
  const paymentRows = showAmounts
    ? (await db.execute<{
        id: string; d: string; amount: string; fee: string; method: string;
        status: string; allocated: string; tx: string | null;
      }>(sql`
        select p.id, p.paid_at::date::text as d, p.amount_minor as amount, p.fee_minor as fee,
               p.method::text as method, p.status::text as status,
               coalesce((select sum(a.amount_minor)::int from payment_allocations a
                          where a.payment_id = p.id), 0) as allocated,
               (select bt.id from bank_transactions bt where bt.matched_payment_id = p.id limit 1) as tx
          from payments p
         where p.supplier_id = ${s.id}
         order by p.paid_at desc
         limit 60
      `)).rows
    : [];
  const paymentCount = showAmounts ? paymentRows.length : 0;

  const rel = intel.reliability;
  const rising = intel.prices.filter((p) => (p.lastMove?.pct ?? 0) > 0).length;

  const tabCount: Partial<Record<Tab, number>> = {
    invoices: n("invoice_count"),
    payments: showAmounts ? paymentCount : undefined,
    prices: intel.prices.length,
    statements: statementRows.length,
  };

  const timeline = toTimeline(intel.events, showAmounts);

  return (
    <PageShell
      user={user}
      width="wide"
      title={s.nameAr}
      eyebrow={
        <span className="flex flex-wrap items-center gap-2">
          <Monogram name={s.nameAr} className="h-6 w-6 text-[11px]" />
          <span>ملفّ المورّد</span>
          {!s.issuesInvoices && <Badge tone="warn">لا يصدر فواتير</Badge>}
          {s.paperInvoices && <Badge>فواتيرُه ورقيّة</Badge>}
          {!s.isActive && <Badge tone="danger">معطَّل</Badge>}
        </span>
      }
      intro={`${countNoun(n("invoice_count"), INVOICE)} · ${countNoun(n("active_months"), MONTH)} من التعامل · ${countNoun(n("product_count"), PRODUCT)}`}
      actions={
        showAmounts ? (
          <LinkButton href={`/suppliers/${s.slug}/statement`} icon={Printer}>كشف الحساب</LinkButton>
        ) : undefined
      }
    >
      {showAmounts && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-stretch">
          {/* ── الرقم الواحد: كم عليك له، ومنذ متى، وممّ تكوّن ── */}
          <Card className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-bold text-muted">
                <span className={`grid h-7 w-7 place-items-center rounded-lg ${balance > 0 ? "bg-warn-bg text-warn" : "bg-sunken text-ink-soft"}`}>
                  <Scale className="h-4 w-4" strokeWidth={2} aria-hidden />
                </span>
                {balance > 0 ? "عليك له" : creditLeft > 0 ? "رصيدٌ لك عنده" : "الحساب متّزن"}
              </p>
              {ageing.oldestOwedDays !== null && (
                <Badge tone={ageTone(ageing.oldestOwedDays) === "muted" ? undefined : ageTone(ageing.oldestOwedDays)} dot>
                  أقدمُ دَينٍ منذ {countNoun(ageing.oldestOwedDays, DAY)}
                </Badge>
              )}
            </div>
            <p className={`mt-4 text-[2.25rem] font-bold leading-none tracking-tight sm:text-[2.6rem] ${balance > 0 ? "text-warn" : ""}`}>
              <Money minor={balance > 0 ? balance : creditLeft} currency />
            </p>
            <p className="mt-2.5 text-xs leading-relaxed text-muted">
              {balance > 0
                ? `على ${countNoun(bal?.openCount ?? 0, INVOICE)} مفتوحة، بعد خصم ما دفعتَه له.`
                : creditLeft > 0
                  ? "مالٌ دفعتَه له ولم تصلك فاتورتُه — يُخصَم من فواتيره القادمة."
                  : n("invoice_count") === 0 && paidNet === 0
                    ? "لا فاتورة منه ولا دفعة له بعد — فلا حسابَ يُقال عنه شيء."
                    : "لا فاتورة مفتوحة ولا رصيدَ لك عنده."}
            </p>

            {balance > 0 && (
              <div className="mt-5">
                <AgeingBar buckets={ageing.buckets} />
                {ageing.unagedMinor > 0 && (
                  <p className="mt-2 text-[11px] text-warn">
                    <Money minor={ageing.unagedMinor} /> منه لا تُعرف فاتورتُه — حدّث الصفحة.
                  </p>
                )}
              </div>
            )}

            {/* ── ممّ تكوّن: كلُّ طرفٍ يفتح سجلّاته ── */}
            <dl className="mt-5 divide-y divide-line-soft rounded-lg border border-line-soft bg-sunken/50 px-3 text-xs">
              <Trace label="فُوتِرَ عليك" minor={billed} href={`/purchases/invoices?supplier=${s.slug}`} />
              <Trace label="دفعتَ له" minor={paidNet} href={`/suppliers/${s.slug}?tab=payments#detail`} />
              <Trace label="بقي مفتوحاً على فواتيره" minor={bal?.openMinor ?? 0} href={`/purchases/invoices?supplier=${s.slug}&paid=OPEN`} />
              {creditSplit.unbackedMinor > 0 && (
                <Trace label="دفعتَ بلا فاتورة" minor={creditSplit.unbackedMinor} href={`/suppliers?unbacked=1#unbacked-${s.slug}`} />
              )}
              {creditSplit.advanceMinor > 0 && <Trace label="مقدَّمةٌ معلَنة" minor={creditSplit.advanceMinor} />}
            </dl>
          </Card>

          <div className="grid gap-3">
            {/* ── ما نعرفه مقابل ما يقوله كشفه ── */}
            <Card>
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <ScrollText className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                ما نعرفه مقابل ما يقوله كشفه
              </h2>
              <dl className="mt-3 grid grid-cols-3 gap-3">
                <Compare
                  label="ما نعرفه"
                  value={account.knownBalanceMinor === null ? null : account.knownBalanceMinor}
                  missing="غير معروف"
                  sub={reportedAt ? `حتى ${formatDay(reportedAt)}` : "من فواتيرنا"}
                />
                <Compare
                  label="ما يقوله كشفه"
                  value={account.reportedBalanceMinor}
                  missing="لم يصل"
                  sub={reportedAt ? "آخر رصيدٍ ختاميّ" : "أو وصل ولم يُقرأ"}
                />
                <Compare
                  label="الفرق"
                  value={account.differenceMinor === null ? null : Math.abs(account.differenceMinor)}
                  missing="لا مقارنة"
                  tone={account.status === "DIFFERS" ? "warn" : account.status === "AGREED" ? "ok" : undefined}
                />
              </dl>
              <p className={`mt-3 text-xs leading-relaxed ${account.status === "DIFFERS" ? "text-ink-soft" : "text-muted"}`}>
                {describeAccount(account)}
                {paidAfterStatement > 0 && <> · ودفعتَ بعد كشفه <Money minor={paidAfterStatement} /></>}
                {account.allocatedAfterStatementMinor ? <> · وخُصّص بعده على فواتير سبقته <Money minor={account.allocatedAfterStatementMinor} /></> : null}
              </p>
            </Card>

            {/* ── كيف تسدّد له — من التخصيصات وحدها ── */}
            <Card>
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Timer className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                كيف تسدّد له
              </h2>
              {rel.invoiceCount === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-muted">غير معروف — لا فاتورة منه بعد، فلا سدادَ يُقاس.</p>
              ) : (
                <>
                  <div className="mt-3 flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-muted">سُدّد من فواتيره</span>
                    <span className="font-bold"><span className="nums">{rel.settledCount}</span> من <span className="nums">{rel.invoiceCount}</span></span>
                  </div>
                  <div className="mt-1.5">
                    <Meter value={rel.settledCount} max={rel.invoiceCount} tone={rel.settledCount === rel.invoiceCount ? "ok" : "accent"} label="الفواتير المسدَّدة" />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div className="min-w-0">
                      <dt className="text-[11px] text-muted">من الفاتورة إلى سدادها</dt>
                      <dd className="mt-1 text-sm font-bold">
                        {rel.averageDays === null ? (
                          <span className="font-medium text-muted">غير معروف</span>
                        ) : (
                          <>عادةً {countNoun(rel.medianDays ?? rel.averageDays, DAY)}</>
                        )}
                      </dd>
                      <dd className="mt-0.5 text-[11px] leading-relaxed text-muted">
                        {rel.averageDays === null
                          ? `يلزم ${countNoun(MIN_SETTLED_SAMPLE, INVOICE)} مسدَّدة بدفعةٍ معروفة — عندنا ${rel.sampleCount}`
                          : `الوسيط من ${countNoun(rel.sampleCount, INVOICE)} · المتوسّط ${countNoun(rel.averageDays, DAY)}${rel.prepaidCount > 0 ? ` · ${rel.prepaidCount} سبقها رصيد` : ""}`}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] text-muted">آخرُ دفعةٍ له</dt>
                      <dd className="mt-1 text-sm font-bold">
                        {intel.lastPayment ? <Money minor={intel.lastPayment.amountMinor} /> : <span className="font-medium text-muted">لا دفعة بعد</span>}
                      </dd>
                      {intel.lastPayment && <dd className="mt-0.5 text-[11px] text-muted">{formatDay(intel.lastPayment.date)}</dd>}
                    </div>
                  </dl>
                </>
              )}
              {rising > 0 && (
                <Link
                  href={`/suppliers/${s.slug}?tab=prices#detail`}
                  className="mt-4 flex min-h-11 items-center gap-2 rounded-lg bg-warn-bg px-3 text-xs font-bold text-warn transition-colors hover:brightness-95 sm:min-h-9"
                >
                  <Tags className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  {countNoun(rising, PRODUCT)} ارتفع سعرُه في آخر شراء — انظر أسعاره
                </Link>
              )}
            </Card>
          </div>
        </div>
      )}

      {showAmounts && (findings.length > 0 || canAnalyze) && (
        <Section
          title="اقتراحات التحليل"
          icon={Sparkles}
          count={findings.length > 0 ? findings.length : undefined}
          hint="يقرأ فواتيره ودفعاته وكشوفه وحوالات البنك، ويقترح ما يصحّح حسابه. لا يُكتب شيءٌ حتى تُقرّه."
          action={canAnalyze ? <RunAnalysis suppliers={[{ id: s.id, name: s.nameAr }]} label="حلّل حسابه" /> : undefined}
        >
          {findings.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-3 text-xs text-muted">
              لا اقتراح مفتوح. حلّل حسابه لترى ما يقوله التحليل — يقترح ولا يكتب.
            </p>
          ) : (
            <FindingsList findings={findings} canApprove={canApprove} showSupplier={false} collapseAfter={2} />
          )}
        </Section>
      )}

      {/* ── التفصيل خلف ألسنة، وبجانبه آخرُ ما جرى ── */}
      <div className="mt-10 grid gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section id="detail" className="min-w-0 scroll-mt-24" aria-label="تفصيل حسابه">
          <div className="mb-4">
            <LinkTabs
              label="تفصيل حسابه"
              items={TABS.filter((t) => showAmounts || t.id !== "payments").map((t) => ({
                href: `/suppliers/${s.slug}?tab=${t.id}#detail`,
                label: t.label,
                count: tabCount[t.id],
                active: tab === t.id,
              }))}
            />
          </div>

          {tab === "invoices" && (
            <>
              <DataTable
                rows={recent}
                keyOf={(r) => r.id}
                /* ملفُّ الفاتورة كلُّه مال — لا يُفتح لمن لا يرى المبالغ */
                hrefOf={(r) => (showAmounts ? invoiceHref(r.id) : undefined)}
                searchOf={(r) => `${r.number} ${formatDay(r.date)}`}
                searchLabel="ابحث برقم الفاتورة"
                empty={<EmptyState compact icon={FileText} title="لا فواتير منه بعد." hint="ترفع فاتورةً منه فتظهر هنا، ويبدأ حسابُه." action={<LinkButton href="/upload" size="sm" variant="primary">ارفع مستنداً</LinkButton>} />}
                columns={[
                  {
                    key: "number",
                    header: "رقم الفاتورة",
                    primary: true,
                    cell: (r) => showAmounts ? (
                      <Link href={invoiceHref(r.id)} className="relative font-mono text-[13px] hover:text-accent" dir="ltr">{r.number ?? "—"}</Link>
                    ) : (
                      <span className="font-mono text-[13px]" dir="ltr">{r.number ?? "—"}</span>
                    ),
                  },
                  { key: "date", header: "التاريخ", cell: (r) => <span className="whitespace-nowrap text-ink-soft">{formatDay(r.date)}</span> },
                  {
                    key: "tax",
                    header: "الضريبة",
                    secondary: true,
                    cell: (r) => (
                      <Badge tone={r.taxStatus === "VALID" ? "ok" : r.taxStatus === "INVALID" ? "danger" : undefined} dot>
                        {r.taxStatus === "VALID" ? "مستوفية" : r.taxStatus === "INVALID" ? "ناقصة" : r.taxStatus === "UNKNOWN" ? "لم تُقرأ" : "لا تُقيَّد"}
                      </Badge>
                    ),
                  },
                  ...(showAmounts
                    ? [
                        {
                          key: "total",
                          header: "الإجمالي",
                          numeric: true as const,
                          cell: (r: (typeof recent)[number]) => <Money minor={r.total} />,
                        },
                        {
                          /* «ما بقي» على الفاتورة نفسها — قبل خصم رصيدك عنده، ومعه عمرُها */
                          key: "remaining",
                          header: "ما بقي",
                          numeric: true as const,
                          cell: (r: (typeof recent)[number]) => {
                            const rem = r.total - Number(r.allocated);
                            if (rem <= SETTLED_TOLERANCE_MINOR) return <span className="text-[11px] font-bold text-ok">✓ مسدَّدة</span>;
                            const age = ageOf.get(r.id);
                            return (
                              <span className="inline-flex flex-col items-end">
                                <span className="font-bold"><Money minor={rem} tone="warn" /></span>
                                {age !== undefined && (
                                  <span className={`text-[10px] ${TONE_TEXT[ageTone(age)]}`}>منذ {countNoun(age, DAY)}</span>
                                )}
                              </span>
                            );
                          },
                        },
                      ]
                    : []),
                ]}
              />
              {n("invoice_count") > recent.length && (
                <p className="mt-2 text-xs text-muted">
                  تُعرض آخرُ {recent.length} من {countNoun(n("invoice_count"), INVOICE)} —{" "}
                  <Link href={`/purchases/invoices?supplier=${s.slug}`} className="font-bold text-accent hover:underline">كلُّها في الفواتير</Link>.
                </p>
              )}
            </>
          )}

          {tab === "payments" && showAmounts && (
            <DataTable
              rows={paymentRows}
              keyOf={(r) => r.id}
              hrefOf={(r) => (r.tx ? `/bank?tx=${r.tx}` : undefined)}
              empty={<EmptyState compact icon={Banknote} title="لا دفعة مسجّلة له." hint="تُقيَّد الدفعة من حركة البنك أو من إيصال سداد مؤرشف." action={<LinkButton href="/bank" size="sm">افتح حركة البنك</LinkButton>} />}
              columns={[
                { key: "date", header: "التاريخ", primary: true, cell: (r) => <span className="whitespace-nowrap">{formatDay(r.d)}</span> },
                { key: "amount", header: "المبلغ", numeric: true, cell: (r) => <span className="font-bold"><Money minor={Number(r.amount)} /></span> },
                { key: "allocated", header: "خُصّص على فواتيره", numeric: true, cell: (r) => <Money minor={Number(r.allocated)} /> },
                {
                  key: "left",
                  header: "بلا فاتورة",
                  numeric: true,
                  cell: (r) => {
                    const left = Number(r.amount) - Number(r.fee) - Number(r.allocated);
                    return left > 100 && r.status !== "REVERSED" && r.status !== "VOID"
                      ? <span className="font-bold"><Money minor={left} tone="warn" /></span>
                      : <span className="text-muted">—</span>;
                  },
                },
                { key: "method", header: "طريقته", secondary: true, cell: (r) => <span className="text-xs text-ink-soft">{METHOD_LABEL[r.method] ?? r.method}</span> },
                {
                  key: "state",
                  header: "حالها",
                  cell: (r) => (
                    <Badge tone={r.status === "REVERSED" || r.status === "VOID" ? "danger" : r.status === "APPLIED" ? "ok" : undefined} dot>
                      {paymentStatusLabel(r.status)}
                    </Badge>
                  ),
                },
                {
                  key: "tx",
                  header: "حركتها",
                  secondary: true,
                  cell: (r) => r.tx ? <span className="text-xs font-bold text-accent">في الكشف</span> : <span className="text-xs text-muted">لا حركة</span>,
                },
              ]}
            />
          )}

          {tab === "prices" && (
            <>
              <p className="mb-3 max-w-3xl text-xs leading-relaxed text-muted">
                سعرُ الوحدة الفعليّ في كلّ شراءٍ منه — بعد الخصم، وداخل هذا المورّد وحده. وآخرُ تغيّرٍ هو السعرُ الحاليّ مقابل آخر سعرٍ خالفه.
              </p>
              <DataTable
                rows={intel.prices}
                keyOf={(p) => p.normalized}
                hrefOf={(p) => (showAmounts ? invoiceHref(p.lastInvoiceId, "lines") : undefined)}
                searchOf={(p) => p.displayName}
                searchLabel="ابحث عن صنف"
                empty={
                  <EmptyState
                    compact
                    icon={Tags}
                    title="لا بنود مقروءة من فواتيره."
                    hint="تُبنى الأسعار من بنود الفواتير — حين يُقرأ محتوى فاتورةٍ منه يظهر سعرُ كلّ صنفٍ فيها هنا."
                  />
                }
                columns={[
                  {
                    key: "item",
                    header: "الصنف",
                    primary: true,
                    cell: (p) => (
                      <span className="block min-w-0">
                        <span className="block truncate font-bold" dir="auto">{p.displayName}</span>
                        <span className="block text-[11px] font-normal text-muted">
                          اشتُري {countNoun(p.purchases, TIME)} · آخرها {formatDay(p.lastDate)}
                        </span>
                      </span>
                    ),
                  },
                  ...(showAmounts
                    ? [
                        { key: "now", header: "السعر الآن", numeric: true as const, cell: (p: (typeof intel.prices)[number]) => <span className="font-bold"><Money minor={p.lastMinor} /></span> },
                        {
                          key: "move",
                          header: "آخر تغيّر",
                          cell: (p: (typeof intel.prices)[number]) =>
                            p.lastMove ? (
                              <span className="inline-flex flex-wrap items-center gap-1.5">
                                <Delta pct={p.lastMove.pct} favourable={p.lastMove.pct === null ? null : p.lastMove.pct <= 0} />
                                <span className="text-[11px] text-muted">من <Money minor={p.lastMove.previousMinor} /></span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted">{p.purchases > 1 ? "لم يتغيّر" : "شراءٌ واحد"}</span>
                            ),
                        },
                        {
                          key: "since",
                          header: "منذ أوّل شراء",
                          secondary: true,
                          cell: (p: (typeof intel.prices)[number]) =>
                            p.changePct === null ? <span className="text-[11px] text-muted">—</span> : <Delta pct={p.changePct} favourable={p.changePct <= 0} />,
                        },
                        {
                          key: "trend",
                          header: "المسار",
                          secondary: true,
                          cell: (p: (typeof intel.prices)[number]) =>
                            p.lastMove ? (
                              <Sparkline values={p.points} label={`مسار سعر ${p.displayName}`} tone={(p.lastMove?.pct ?? 0) > 0 ? "warn" : "accent"} />
                            ) : (
                              <span className="text-[11px] text-muted">ثابت</span>
                            ),
                        },
                      ]
                    : []),
                ]}
              />
            </>
          )}

          {tab === "statements" && (
            statementRows.length === 0 ? (
              <EmptyState
                compact
                icon={ScrollText}
                title={s.issuesStatements ? "لا كشف حساب واحد منه." : "لا يصدر كشوفاً — كما أُعلن في ملفّه."}
                hint={
                  s.issuesStatements
                    ? `تعاملتَ معه ${countNoun(n("active_months"), MONTH)} بلا كشف. والكشف هو ما يكشف الفاتورة التي حُمّلت عليك ولم تصلك — لا يكشفها تفتيشُ أرشيفك، لأنّها ليست فيه.`
                    : "فحسابُه عندنا من فواتيره ودفعاته وحدها، وكشفُ حسابه منّا يُطبع من «كشف الحساب»."
                }
                action={
                  <>
                    {s.issuesStatements && <LinkButton href={`/statements?supplier=${encodeURIComponent(s.slug)}`} variant="primary" size="sm">ارفع كشفه وطابقه</LinkButton>}
                    {showAmounts && <LinkButton href={`/suppliers/${s.slug}/statement`} size="sm" icon={Printer}>كشفُ حسابه منّا</LinkButton>}
                  </>
                }
              />
            ) : (
              <>
                <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
                  {statementRows.map((st) => (
                    <li key={st.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-info-bg text-info">
                        <ScrollText className="h-4 w-4" strokeWidth={2} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold">{formatRange(st.ps.slice(0, 10), st.pe.slice(0, 10))}</span>
                        <span className="block text-[11px] text-muted">
                          {Number(st.lines) > 0
                            ? `${countNoun(Number(st.lines), LINE)} · طوبق منها ${Number(st.matched)}`
                            : "لم تُقرأ أسطرُه — طابِقه لتُقرأ"}
                        </span>
                      </span>
                      {showAmounts && (
                        <span className="shrink-0 text-end">
                          <span className="block text-[11px] text-muted">رصيدُه الختاميّ</span>
                          {st.closing === null
                            ? <span className="block text-[13px] font-bold text-muted">غير معروف</span>
                            : <span className="block text-[13px] font-bold"><Money minor={Number(st.closing)} /></span>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <LinkButton href={`/statements?supplier=${encodeURIComponent(s.slug)}`} size="sm" variant="primary">طابقها بفواتيرك</LinkButton>
                  {showAmounts && <LinkButton href={`/suppliers/${s.slug}/statement`} size="sm" icon={Printer}>كشفُ حسابه منّا</LinkButton>}
                </div>
              </>
            )
          )}

          {tab === "profile" && (
            <div className="space-y-4">
              {/* السياسةُ أوّلاً: هي وحدها في هذا اللسان ما **يُغيَّر**، وما تحتها عرضٌ وتقييم. */}
              <SupplierPolicy
                supplierId={s.id}
                canEdit={canAnalyze}
                initial={{
                  issuesInvoices: s.issuesInvoices,
                  paperInvoices: s.paperInvoices,
                  contractRequired: s.contractRequired,
                  contractOnFile: s.contractOnFile,
                }}
              />

              <Card>
                <h3 className="mb-4 text-sm font-bold">بياناته</h3>
                <KeyValue
                  columns={4}
                  items={[
                    { label: "الرقم الضريبي", value: <Fact value={s.vatNumber} missing="ناقص" ltr /> },
                    { label: "السجل التجاري", value: <Fact value={s.crNumber} missing="ناقص" ltr /> },
                    { label: "شروط السداد", value: <Fact value={s.paymentTerms} missing="غير محدّدة" soft /> },
                    {
                      label: "عقد التوريد",
                      value: <Fact value={s.contractOnFile ? "موجود" : null} missing={s.contractRequired && !s.issuesInvoices ? "ناقص" : "غير مطلوب"} soft={!(s.contractRequired && !s.issuesInvoices)} />,
                    },
                    { label: "الاسم في الدرايف", value: <Fact value={s.driveFolderName} ltr /> },
                    { label: "المعرّف", value: <Fact value={s.slug} ltr /> },
                    { label: "أسماء بديلة", value: <Fact value={String(n("alias_count"))} /> },
                    {
                      label: "فواتيره",
                      value: <Fact value={!s.issuesInvoices ? "لا يصدر فواتير" : s.paperInvoices ? "ضريبية — ورقيّة باليد" : "ضريبية"} />,
                    },
                  ]}
                />
              </Card>

              {/* «تعاملك معه» تقييمٌ لا فعلَ له — خلف لسانٍ يُفتَح عند التفاوض. */}
              <div>
                <h3 className="mb-2 text-xs font-bold text-muted">
                  تعاملك معه — وما لا تكفي بياناته يبقى غير مقيَّم، ولا يُعطى صفراً
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {health.map((d) => (
                    <Card key={d.dimension}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-bold">{DIMENSION_LABEL[d.dimension]}</p>
                        <Badge tone={GRADE_TONE[d.grade] === "muted" ? undefined : GRADE_TONE[d.grade]} dot>{GRADE_LABEL[d.grade]}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-ink-soft">{d.reason}</p>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <aside aria-labelledby="events-title" className="min-w-0">
          <h2 id="events-title" className="mb-4 flex items-center gap-2 text-[15px] font-bold sm:text-base">
            <History className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden />
            آخر ما جرى
          </h2>
          {timeline.length === 0 ? (
            <EmptyState compact icon={CalendarClock} title="لا شيء جرى معه بعد." hint="فاتورةٌ تُرفع أو دفعةٌ تُقيَّد تظهر هنا بترتيبها." />
          ) : (
            <div className="rounded-xl border border-line bg-raised p-4 shadow-raised sm:p-5">
              <Timeline items={timeline} />
            </div>
          )}
        </aside>
      </div>
    </PageShell>
  );
}

/* ───────────────────── الخطّ الزمنيّ ───────────────────── */

/**
 * أحداثُ الملفّ بترتيبها: الفواتير والدفعات والكشوف وقيودُ السجلّ. وما
 * تكرّر من السجلّ في يومٍ واحد (ثلاثُ مطابقاتٍ لكشفٍ في دقيقة) سطرٌ واحد بعدده.
 */
function toTimeline(events: readonly TimelineEvent[], showAmounts: boolean): TimelineItem[] {
  const out: (TimelineItem & { key?: string; times?: number })[] = [];
  for (const e of events) {
    const day = e.at.slice(0, 10);
    if (e.kind === "AUDIT") {
      const key = `${e.title}|${day}`;
      const prev = out[out.length - 1];
      if (prev?.key === key) {
        prev.times = (prev.times ?? 1) + 1;
        continue;
      }
      out.push({
        id: e.id,
        key,
        title: ACTION_LABEL[e.title as keyof typeof ACTION_LABEL] ?? e.title,
        meta: formatDay(day),
        body: e.meta ? `بيد ${e.meta}` : undefined,
        icon: History,
      });
      continue;
    }
    if (e.kind === "INVOICE") {
      out.push({
        id: e.id,
        title: <>فاتورة <bdi className="font-mono">{e.title}</bdi></>,
        meta: formatDay(day),
        body: showAmounts && e.amountMinor !== null ? <Money minor={e.amountMinor} /> : undefined,
        icon: FileText,
        tone: "accent",
        href: showAmounts ? e.href : undefined,
      });
      continue;
    }
    if (e.kind === "PAYMENT") {
      if (!showAmounts) continue;
      out.push({
        id: e.id,
        title: <>دفعة · {METHOD_LABEL[e.title] ?? e.title}</>,
        meta: formatDay(day),
        body: (
          <>
            {e.amountMinor !== null && <Money minor={e.amountMinor} />}
            {e.cancelled && <span className="ms-2 font-bold text-danger">{paymentStatusLabel(e.meta ?? "")}</span>}
          </>
        ),
        icon: Banknote,
        tone: e.cancelled ? "danger" : "ok",
        href: e.href,
      });
      continue;
    }
    const [from, to] = e.title.split("|");
    out.push({
      id: e.id,
      title: "وصل كشفُ حساب",
      meta: formatDay(day),
      body: (
        <>
          {formatRange(from, to)}
          {showAmounts && (
            <> · رصيدُه {e.amountMinor === null ? <span className="text-muted">غير معروف</span> : <Money minor={e.amountMinor} />}</>
          )}
        </>
      ),
      icon: ScrollText,
      tone: "info",
    });
  }
  return out.map((item) => {
    const { key, times, ...rest } = item;
    void key;
    return times && times > 1
      ? { ...rest, title: <>{rest.title} <span className="nums font-normal text-muted">×{times}</span></> }
      : rest;
  });
}

/* ───────────────────── أجزاء ───────────────────── */

/** طرفٌ من معادلة الحساب — ومعه بابُ سجلّاته. */
function Trace({ label, minor, href }: { label: string; minor: number; href?: string }) {
  /*
    الصفُّ كلُّه يُضغَط، و`<dl>` لا يقبل رابطاً بين يديه وبين `<dt>`: فالرابطُ
    داخل الاسم، ويمتدّ غطاؤه على الصفّ — ويبقى الاسمُ والقيمةُ زوجاً لقارئ الشاشة.
  */
  return (
    <div className="relative flex min-h-10 items-center justify-between gap-3 py-1.5 transition-colors hover:text-accent">
      <dt className="min-w-0 text-ink-soft">
        {href ? <Link href={href} className="after:absolute after:inset-0">{label}</Link> : label}
      </dt>
      <dd className="shrink-0 font-bold"><Money minor={minor} /></dd>
    </div>
  );
}

function Compare({
  label,
  value,
  missing,
  sub,
  tone,
}: {
  label: string;
  value: number | null;
  missing: string;
  sub?: string;
  tone?: "warn" | "ok";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`mt-1 text-[15px] font-bold sm:text-base ${tone ? TONE_TEXT[tone] : ""}`}>
        {value === null ? <span className="text-sm font-medium text-muted">{missing}</span> : <Money minor={value} />}
      </dd>
      {sub && <dd className="mt-0.5 text-[10px] leading-snug text-muted">{sub}</dd>}
    </div>
  );
}

function Fact({ value, missing, ltr, soft }: { value?: string | null; missing?: string; ltr?: boolean; soft?: boolean }) {
  if (!value) return <span className={soft ? "text-muted" : "text-warn"}>{missing ?? "—"}</span>;
  return ltr ? <bdi dir="ltr" className="font-mono text-[13px]">{value}</bdi> : <>{value}</>;
}
