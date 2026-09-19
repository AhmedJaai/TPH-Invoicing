import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, statements, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Card, DataTable, EmptyState, LinkButton, Section, Stat, TONE_TEXT, type Tone } from "@/components/ui";
import {
  DIMENSION_LABEL,
  GRADE_LABEL,
  buildSupplierHealth,
  type Grade,
} from "@/lib/supplier-health";
import { buildSupplierAccount, describeAccount } from "@/lib/supplier-account";
import { countNoun, INVOICE, MONTH, PRODUCT } from "@/lib/arabic";
import { loadSupplierBalances } from "@/services/supplier-balance.service";
import { listOpenFindings } from "@/services/supplier-analysis.service";
import { FindingsList, RunAnalysis, type FindingView } from "@/components/ai-analysis";
import { formatRiyalsDisplay } from "@/lib/money";
import { splitSupplierCredit } from "@/lib/supplier-requests";
import { SupplierPolicy } from "@/components/supplier-policy";
import { formatDay, formatRange } from "@/lib/riyadh-time";

export const dynamic = "force-dynamic";

/**
 * ملفّ المورّد.
 *
 * كانت صفحة المورّدين جدولاً: كم فاتورة وكم رصيد. وهي تجيب «من هم» ولا
 * تجيب «كيف حالي معه» — وهذا هو السؤال قبل التفاوض. فصار لكل مورّد
 * صفحةٌ تجمع ماله ووثائقه وضريبته وكشوفه وسعره في مكان واحد.
 */

/** طريقةُ السداد بالعربية — والسدادُ من حساب المالك لا يظهر في كشف المقهى أبداً. */
const METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: "حوالة بنكية",
  CASH: "نقداً",
  EMPLOYEE_ADVANCE: "عهدة موظّف",
  OWNER_ACCOUNT: "من حساب المالك",
};

/** حالُ الدفعة — والمردودةُ لا تُحسَب مدفوعة. */
const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNAPPLIED: "لم تُخصَّص",
  PARTIALLY_APPLIED: "خُصّصت جزئياً",
  APPLIED: "خُصّصت",
  OVERPAYMENT: "زائدة عن فواتيره",
  ADVANCE: "مقدَّمة معلَنة",
  REVERSED: "مردودة",
  VOID: "ملغاة",
};

const GRADE_TONE: Record<Grade, Tone | undefined> = {
  GOOD: "ok",
  FAIR: "warn",
  POOR: "danger",
  UNRATED: "muted",
};

type Tab = "invoices" | "payments" | "statements" | "profile";

const TABS: { id: Tab; label: string }[] = [
  { id: "invoices", label: "فواتيره" },
  { id: "payments", label: "دفعاته" },
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
  const tab: Tab = TABS.some((t) => t.id === wantedTab) ? (wantedTab as Tab) : "invoices";
  const showAmounts = can(user.role, "amounts:view");

  const [s] = await db.select().from(suppliers).where(eq(suppliers.slug, slug));
  if (!s) notFound();

  const [stats] = (
    await db.execute<Record<string, number | string | null>>(sql`
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
    `)
  ).rows;

  const n = (k: string) => Number(stats?.[k] ?? 0);
  const billed = n("billed");

  /*
    ما عليك له = فواتيره المفتوحة ناقصَ ما دفعتَه له ولم يُخصم من فاتورة.

    كان «المسدَّد» التخصيصاتِ وحدها، فمالٌ دُفع ولم يُخصّص لا يُرى: غاناش
    دُفع له ٢٩ ألفاً فوق فواتيره والصفحة تقول «يطالب بأكثر ممّا نعرف».
  */
  const [bal] = await loadSupplierBalances(db, s.id);
  const balance = bal?.owedMinor ?? 0;
  const creditLeft = bal?.creditLeftMinor ?? 0;
  const paidNet = bal?.paidNetMinor ?? n("paid");
  const creditSplit = splitSupplierCredit(creditLeft, n("advance"));

  const canAnalyze = can(user.role, "supplier:edit");
  const canApprove = can(user.role, "payment:approve");
  const findings: FindingView[] = showAmounts
    ? (await listOpenFindings(s.id)).map((f) => ({
        id: f.id, supplierId: f.supplierId, supplierName: f.supplierName, supplierSlug: f.supplierSlug,
        kind: f.kind, severity: f.severity, title: f.title, explanation: f.explanation,
        amountMinor: f.amountMinor, action: f.action,
        refs: f.refs.map((r) => ({ label: r.label, type: r.type })),
        createdAt: f.createdAt.toISOString(),
      }))
    : [];

  /*
    ══ حسابُ المورّد: ما نعرفه مقابل ما يقول ══

    كان المستحقّ `المفوتر − المسدَّد` وحدهما — وذلك يصحّ حين يكون كلُّ
    ما بيننا وبينه فواتيرَ عندنا. ومورّدو المقهى ليسوا كذلك: منهم من
    يعطي كشفاً ولا يعطي فواتير. فيقول النظام «لا شيء عليك» ويقول هو
    «عليك ثلاثة آلاف»، ولا موضع يجمع القولين.
  */
  const reportedRaw = stats?.["reported_balance"];
  const reportedAt = typeof stats?.["reported_at"] === "string" ? (stats["reported_at"] as string) : null;

  /*
    ── المقارنة بالكشف في زمنه ──

    كان آخرُ رصيدٍ في كشفه (بتاريخ ١٥ يوليو) يُقارَن بحساب **اليوم**.
    فمصنع الكوب الذهبي: «الفرق ١٥٢٫٣٧ — نعرف أكثر ممّا يطالب»، وقد دُفع
    له ٥٬٨٥٤٫٣٨ بعد تاريخ الكشف؛ والفرق الحقيقيّ عند ذلك التاريخ ٦٬٠٠٦٫٧٥.
    فيُحسب ما نعرفه حتى تاريخ الكشف، ويُعرَض ما دُفع بعده بجانبه.
  */
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
    reportedBalanceMinor: reportedRaw === null || reportedRaw === undefined
      ? null
      : Number(reportedRaw),
    allocatedAfterStatementMinor: atStatement ? Number(atStatement.allocated_after) : null,
    invoicesAtStatement,
  });

  /*
    تغيّر السعر: متوسّط سعر الوحدة في أوّل شهر مقابل آخر شهر.
    ولا يُحسب إلّا من بنود بسعر وحدة موثوق — وإلّا بقي `null` ولم يُقيَّم
    البُعد. حسابُه من بنودٍ نصفها بلا سعر يُنتج نسبةً تكذب.
  */
  const priceRows = (
    await db.execute<{ month: string; avg_unit: string; lines: number }>(sql`
      select i.period_month as month,
             avg(l.unit_price_minor)::bigint as avg_unit,
             count(*)::int as lines
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
      ? ((Number(priceRows[priceRows.length - 1].avg_unit) - Number(priceRows[0].avg_unit)) /
          Number(priceRows[0].avg_unit)) * 100
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

  const recent = await db
    .select({
      id: invoices.id,
      number: invoices.invoiceNumber,
      date: invoices.invoiceDate,
      month: invoices.periodMonth,
      total: invoices.totalMinor,
      taxStatus: invoices.taxStatus,
    })
    .from(invoices)
    .where(eq(invoices.supplierId, s.id))
    .orderBy(desc(invoices.invoiceDate))
    .limit(12);

  const statementRows = await db
    .select({ id: statements.id, periodStart: statements.periodStart, periodEnd: statements.periodEnd })
    .from(statements)
    .where(eq(statements.supplierId, s.id))
    .orderBy(desc(statements.periodEnd))
    .limit(12);

  /*
    دفعاته — وكانت الصفحة لا تعرض منها واحدة.

    فالمورّد الذي يقول النظام إنّ عليه ١٬٧٩٦ لا يُرى في صفحته **ما دُفع
    له**، ولا كيف بلغ الرقم ما بلغ. والسؤال الذي تُفتَح له هذه الصفحة
    قبل التفاوض هو «لِمَ عليّ هذا؟» — ولا يُجاب إلّا بالطرفين.
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
         limit 40
      `)).rows
    : [];

  return (
    <PageShell
      user={user}
      width="wide"
      title={s.nameAr}
      intro={`${countNoun(n("invoice_count"), INVOICE)} · ${countNoun(n("active_months"), MONTH)} من التعامل · ${countNoun(n("product_count"), PRODUCT)}`}
      actions={
        <>
          {/* كان يفتح كشوف كلّ المورّدين — فيُبحث عنه من جديد (BTN-032) */}
          <LinkButton href={`/statements?supplier=${encodeURIComponent(s.slug)}`} size="sm">كشوفه</LinkButton>
          <LinkButton href={`/purchases/invoices?supplier=${s.slug}`} size="sm">فواتيره</LinkButton>
        </>
      }
    >
      {/*
        ── رقمٌ واحد يُتتبَّع ──

        كانت أربعَ بطاقاتٍ متساوية: «المفوتر» و«المستحقّ له» و«حال
        العلاقة» و«تغيّر السعر». ثلاثٌ منها لا تُسأل عند فتح الصفحة،
        والرابعة — وهي المقصودة — تُعرَض رقماً بلا بيان: «المستحقّ له
        ٠٫٠٠» ثمّ في سطر تحته «دفعتَ له بلا فاتورة ٢٦٬٧٦٧٫٤٠». فيقرأ
        صاحبُ المقهى صفراً ولا يعرف أنّ عنده عند المورّد ستّةً وعشرين
        ألفاً.

        والسؤالُ الذي تُفتَح له هذه الصفحة واحد: **لِمَ يقول النظام إنّ
        عليّ هذا؟** فيُعرَض الرقم كبيراً، وتحته معادلتُه بأطرافها — ما
        فُوتر، وما دُفع، وما بقي — وكلُّ طرفٍ يفتح سجلّاته.
      */}
      {showAmounts && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
          <Card tone={balance > 0 ? "warn" : creditLeft > 0 ? undefined : "ok"}>
            <p className="text-xs font-medium text-muted">
              {balance > 0 ? "عليك له" : creditLeft > 0 ? "رصيدٌ لك عنده" : "الحساب متّزن"}
            </p>
            <p className={`nums mt-2 font-display text-[2.4rem] font-black leading-none ${balance > 0 ? "text-warn" : ""}`}>
              <Money minor={balance > 0 ? balance : creditLeft} />
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {balance > 0
                ? `على ${countNoun(bal?.openCount ?? 0, INVOICE)} مفتوحة، بعد خصم ما دفعتَه له.`
                : creditLeft > 0
                  ? "مالٌ دفعتَه له ولم تصلك فاتورتُه — يُخصَم من فواتيره القادمة."
                  : "لا فاتورة مفتوحة ولا رصيدَ لك عنده."}
            </p>

            {/* ── ممّ تكوّن: كلُّ طرفٍ يفتح سجلّاته ── */}
            <dl className="mt-4 divide-y divide-line border-t border-line pt-1 text-xs">
              <Trace label="فُوتِرَ عليك" minor={billed} href={`/purchases/invoices?supplier=${s.slug}`} />
              <Trace label="دفعتَ له" minor={paidNet} href={`/suppliers/${s.slug}?tab=payments`} />
              <Trace
                label="بقي مفتوحاً على فواتيره"
                minor={bal?.openMinor ?? 0}
                href={`/purchases/invoices?supplier=${s.slug}&paid=OPEN`}
              />
              {creditSplit.unbackedMinor > 0 && (
                <Trace
                  label="دفعتَ بلا فاتورة"
                  minor={creditSplit.unbackedMinor}
                  href={`/suppliers?unbacked=1#unbacked-${s.slug}`}
                />
              )}
              {creditSplit.advanceMinor > 0 && (
                <Trace label="مقدَّمةٌ معلَنة" minor={creditSplit.advanceMinor} />
              )}
            </dl>
          </Card>

          {/* ── حسابه مقابل كشفه — الاستثناء الذي يستحقّ النظر ── */}
          <Section
            className="mt-0"
            title="ما نعرفه مقابل ما يقوله كشفه"
            hint="والفرق ليس اتّهاماً — قد يكون فاتورةً حمّلها علينا ولم تصلنا، أو سداداً لم يصل كشفُه بعد."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label="ما نعرفه"
                value={
                  account.knownBalanceMinor === null
                    ? "غير معروف"
                    : <Money minor={account.knownBalanceMinor} />
                }
                tone={account.knownBalanceMinor === null ? "muted" : undefined}
                sub={
                  account.knownBalanceMinor === null
                    ? "لا فاتورة منه عندنا — وذلك ليس صفراً"
                    : reportedAt
                      ? `حتى ${reportedAt} — تاريخ كشفه${paidAfterStatement > 0 ? ` · ودفعتَ بعده ${formatRiyalsDisplay(paidAfterStatement)}` : ""}`
                      : "المفوتر ناقص كلِّ ما دفعتَه له"
                }
              />
              <Stat
                label="ما يقوله كشفه"
                value={
                  account.reportedBalanceMinor === null
                    ? "لم يصل"
                    : <Money minor={account.reportedBalanceMinor} />
                }
                tone={account.reportedBalanceMinor === null ? "muted" : undefined}
                sub={account.reportedBalanceMinor === null ? "أو وصل ولم يُقرأ رصيدُه" : `آخر رصيدٍ ختاميّ · ${reportedAt}`}
              />
              <Stat
                label="الفرق"
                value={
                  account.differenceMinor === null
                    ? "لا مقارنة"
                    : <Money minor={Math.abs(account.differenceMinor)} />
                }
                tone={
                  account.status === "DIFFERS" ? "warn"
                  : account.status === "AGREED" ? "ok" : "muted"
                }
                sub={
                  describeAccount(account)
                  + (account.allocatedAfterStatementMinor
                    ? ` · وخُصّص بعد كشفه على فواتير سبقته ${formatRiyalsDisplay(account.allocatedAfterStatementMinor)}`
                    : "")
                }
              />
            </div>
          </Section>
        </div>
      )}

      {showAmounts && canAnalyze && (
        <Section
          title="اقتراحات تنتظر قرارك"
          hint="يقرأ فواتيره ودفعاته وكشوفه وحوالات البنك، ويقترح ما يصحّح حسابه. لا يُكتب شيءٌ حتى تُقرّه."
          action={<RunAnalysis suppliers={[{ id: s.id, name: s.nameAr }]} label="حلّل حسابه" />}
        >
          {findings.length === 0 ? (
            <p className="text-xs text-muted">لا اقتراحات مفتوحة. حلّل حسابه لترى ما يقوله التحليل.</p>
          ) : (
            <FindingsList findings={findings} canApprove={canApprove} showSupplier={false} />
          )}
        </Section>
      )}

      {/* ── التفصيل خلف ألسنة — لا سبعةُ أقسامٍ متتالية ── */}
      <Section
        title="تفصيل حسابه"
        hint="الفواتير والدفعات والكشوف — كلٌّ في لسانه، فلا تُقرأ سبعةُ جداول لتُوجَد واحد."
        className="mt-8"
      >
        <nav className="scroll-x mb-4 flex items-center gap-5 overflow-x-auto border-b border-line" aria-label="تفصيل حسابه">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/suppliers/${s.slug}?tab=${t.id}`}
              aria-current={tab === t.id ? "page" : undefined}
              className={`flex min-h-11 shrink-0 items-center border-b-2 text-xs transition-colors sm:min-h-0 sm:pb-2.5 sm:pt-1 ${
                tab === t.id ? "border-ink font-bold text-ink" : "border-transparent text-muted hover:text-ink-soft"
              }`}
            >
              {t.label}
              {t.id === "invoices" && n("invoice_count") > 0 && <span className="nums ms-1.5 text-muted">{n("invoice_count")}</span>}
              {t.id === "payments" && paymentRows.length > 0 && <span className="nums ms-1.5 text-muted">{paymentRows.length}</span>}
              {t.id === "statements" && statementRows.length > 0 && <span className="nums ms-1.5 text-muted">{statementRows.length}</span>}
            </Link>
          ))}
        </nav>

        {tab === "invoices" && (
          <>
            <DataTable
              rows={recent}
              keyOf={(r) => r.id}
              empty={<EmptyState title="لا فواتير منه بعد." hint="ترفع فاتورةً منه فتظهر هنا." />}
              columns={[
                {
                  key: "number",
                  header: "رقم الفاتورة",
                  primary: true,
                  cell: (r) => <span className="nums" dir="ltr">{r.number ?? "—"}</span>,
                },
                { key: "date", header: "التاريخ", cell: (r) => <span>{formatDay(r.date)}</span> },
                { key: "month", header: "الشهر", secondary: true, cell: (r) => <span className="nums">{r.month}</span> },
                {
                  key: "tax",
                  header: "الضريبة",
                  cell: (r) => (
                    <span className={r.taxStatus === "VALID" ? "text-ok" : r.taxStatus === "INVALID" ? "text-danger" : "text-muted"}>
                      {r.taxStatus === "VALID" ? "مستوفية" : r.taxStatus === "INVALID" ? "ناقصة" : r.taxStatus === "UNKNOWN" ? "لم تُقرأ" : "لا تُقيَّد"}
                    </span>
                  ),
                },
                ...(showAmounts
                  ? [{
                      key: "total",
                      header: "الإجمالي",
                      numeric: true as const,
                      cell: (r: (typeof recent)[number]) => <Money minor={r.total} />,
                    }]
                  : []),
              ]}
            />
            {n("invoice_count") > recent.length && (
              <p className="mt-2 text-xs text-muted">
                تُعرض آخرُ {recent.length} من {countNoun(n("invoice_count"), INVOICE)} —{" "}
                <Link href={`/purchases/invoices?supplier=${s.slug}`} className="underline underline-offset-4">كلُّها</Link>.
              </p>
            )}
          </>
        )}

        {tab === "payments" && (
          <DataTable
            rows={paymentRows}
            keyOf={(r) => r.id}
            empty={
              <EmptyState
                title="لا دفعة مسجّلة له."
                hint="تُقيَّد الدفعة من حركة البنك أو من إيصال سداد مؤرشف."
              />
            }
            columns={[
              { key: "date", header: "التاريخ", primary: true, cell: (r) => <span>{formatDay(r.d)}</span> },
              { key: "amount", header: "المبلغ", numeric: true, cell: (r) => <span className="font-medium"><Money minor={Number(r.amount)} /></span> },
              {
                key: "allocated", header: "خُصّص على فواتيره", numeric: true,
                cell: (r) => <Money minor={Number(r.allocated)} />,
              },
              {
                key: "left", header: "بلا فاتورة", numeric: true,
                cell: (r) => {
                  const left = Number(r.amount) - Number(r.fee) - Number(r.allocated);
                  return left > 100
                    ? <span className="font-bold text-warn"><Money minor={left} /></span>
                    : <span className="text-muted">—</span>;
                },
              },
              {
                key: "method", header: "طريقته", secondary: true,
                cell: (r) => <span className="text-xs text-ink-soft">{METHOD_LABEL[r.method] ?? r.method}</span>,
              },
              {
                key: "state", header: "حالها",
                cell: (r) =>
                  r.status === "REVERSED" || r.status === "VOID" ? (
                    <span className="text-danger">{PAYMENT_STATUS_LABEL[r.status] ?? r.status}</span>
                  ) : (
                    <span className="text-muted">{PAYMENT_STATUS_LABEL[r.status] ?? r.status}</span>
                  ),
              },
              {
                key: "tx", header: "حركتها", secondary: true,
                cell: (r) =>
                  r.tx ? (
                    <Link href={`/bank?tx=${r.tx}`} className="text-xs underline underline-offset-4">في الكشف</Link>
                  ) : (
                    <span className="text-xs text-muted">لا حركة</span>
                  ),
              },
            ]}
          />
        )}

        {tab === "statements" && (
          statementRows.length === 0 ? (
            <EmptyState
              title="لا كشف حساب واحد منه."
              hint={`تعاملتَ معه ${countNoun(n("active_months"), MONTH)} بلا كشف. والكشف هو ما يكشف الفاتورة التي حُمّلت عليك ولم تصلك — فاتورةٌ ناقصة لا يكشفها تفتيشُ أرشيفك، لأنّها ليست فيه.`}
              action={<LinkButton href={`/statements?supplier=${encodeURIComponent(s.slug)}`} variant="primary">ارفع كشفاً</LinkButton>}
            />
          ) : (
            <>
              <ul className="flex flex-wrap gap-2">
                {statementRows.map((st) => (
                  <li key={st.id} className="rounded-xl border border-line bg-raised px-3 py-1.5 text-xs shadow-raised">
                    {formatRange(st.periodStart, st.periodEnd)}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <LinkButton href={`/statements?supplier=${encodeURIComponent(s.slug)}`} size="sm">طابقها بفواتيرك</LinkButton>
              </div>
            </>
          )
        )}

        {tab === "profile" && (
          <div className="space-y-4">
            {/*
              السياسةُ أوّلاً: هي الشيء الوحيد في هذا اللسان الذي
              **يُغيَّر**، وما تحتها عرضٌ وتقييم.
            */}
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
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Fact label="الرقم الضريبي" value={s.vatNumber} missing="ناقص" ltr />
                <Fact label="السجل التجاري" value={s.crNumber} missing="ناقص" ltr />
                <Fact label="شروط السداد" value={s.paymentTerms} missing="غير محدّدة" />
                <Fact
                  label="عقد التوريد"
                  value={s.contractOnFile ? "موجود" : null}
                  missing={s.contractRequired && !s.issuesInvoices ? "ناقص" : "غير مطلوب"}
                />
                <Fact label="الاسم في الدرايف" value={s.driveFolderName} ltr />
                <Fact label="المعرّف" value={s.slug} ltr />
                <Fact label="أسماء بديلة" value={String(n("alias_count"))} />
                <Fact
                  label="فواتيره"
                  value={
                    !s.issuesInvoices ? "لا يصدر فواتير"
                    : s.paperInvoices ? "ضريبية — ورقيّة باليد"
                    : "ضريبية"
                  }
                />
              </dl>
            </Card>

            {/*
              «تعاملك معه» تقييمٌ لا فعلَ له — فمكانُه خلف لسانٍ يُفتَح عند
              التفاوض، لا قسمٌ في منتصف الصفحة بين المال وفواتيره.
            */}
            <div>
              <h3 className="mb-2 text-xs font-bold text-muted">
                تعاملك معه — وما لا تكفي بياناته يبقى غير مقيَّم، ولا يُعطى صفراً
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {health.map((d) => (
                  <Card key={d.dimension} tone={GRADE_TONE[d.grade]}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-bold">{DIMENSION_LABEL[d.dimension]}</p>
                      <span className={`shrink-0 text-[11px] font-bold ${d.grade === "UNRATED" ? "text-muted" : TONE_TEXT[GRADE_TONE[d.grade] ?? "muted"]}`}>
                        {GRADE_LABEL[d.grade]}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-ink-soft">{d.reason}</p>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}
      </Section>
    </PageShell>
  );
}

/** طرفٌ من معادلة الحساب — ومعه بابُ سجلّاته. */
function Trace({ label, minor, href }: { label: string; minor: number; href?: string }) {
  const body = (
    <>
      <dt className="min-w-0 text-muted">{label}</dt>
      <dd className="nums shrink-0 font-bold"><Money minor={minor} /></dd>
    </>
  );
  if (!href) return <div className="flex items-baseline justify-between gap-3 py-1.5">{body}</div>;
  return (
    <Link
      href={href}
      className="flex items-baseline justify-between gap-3 py-1.5 transition-colors hover:text-ink"
    >
      {body}
    </Link>
  );
}

function Fact({
  label,
  value,
  missing,
  ltr,
}: {
  label: string;
  value?: string | null;
  missing?: string;
  ltr?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd
        className={`mt-0.5 truncate text-sm ${value ? "font-medium" : "text-warn"} ${ltr ? "nums" : ""}`}
        dir={ltr ? "ltr" : undefined}
      >
        {value ?? missing ?? "—"}
      </dd>
    </div>
  );
}
