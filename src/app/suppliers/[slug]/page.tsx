import { notFound, redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, statements, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Card, DataTable, EmptyState, LinkButton, Section, Stat, StatGrid, TONE_TEXT, type Tone } from "@/components/ui";
import {
  DIMENSION_LABEL,
  GRADE_LABEL,
  buildSupplierHealth,
  overallGrade,
  type Grade,
} from "@/lib/supplier-health";
import { buildSupplierAccount, describeAccount } from "@/lib/supplier-account";
import { countNoun, INVOICE, MONTH, PRODUCT } from "@/lib/arabic";
import { loadSupplierBalances } from "@/services/supplier-balance.service";
import { listOpenFindings } from "@/services/supplier-analysis.service";
import { FindingsList, RunAnalysis, type FindingView } from "@/components/ai-analysis";
import { formatRiyalsDisplay } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * ملفّ المورّد.
 *
 * كانت صفحة المورّدين جدولاً: كم فاتورة وكم رصيد. وهي تجيب «من هم» ولا
 * تجيب «كيف حالي معه» — وهذا هو السؤال قبل التفاوض. فصار لكل مورّد
 * صفحةٌ تجمع ماله ووثائقه وضريبته وكشوفه وسعره في مكان واحد.
 */

const GRADE_TONE: Record<Grade, Tone | undefined> = {
  GOOD: "ok",
  FAIR: "warn",
  POOR: "danger",
  UNRATED: "muted",
};

export default async function SupplierPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/suppliers");

  const { slug } = await params;
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
        (select count(*)::int from supplier_products where supplier_id = ${s.id})   as product_count
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
  const overall = overallGrade(health);

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
    .limit(6);

  return (
    <PageShell
      user={user}
      width="wide"
      title={s.nameAr}
      intro={`${countNoun(n("invoice_count"), INVOICE)} · ${countNoun(n("active_months"), MONTH)} من التعامل · ${countNoun(n("product_count"), PRODUCT)}`}
      actions={
        <>
          <LinkButton href="/statements" size="sm">كشوفه</LinkButton>
          <LinkButton href={`/purchases/invoices?supplier=${s.slug}`} size="sm">فواتيره</LinkButton>
        </>
      }
    >
      {showAmounts && (
        <StatGrid>
          <Stat label="المفوتر" minor={billed} sub={`${countNoun(n("active_months"), MONTH)} من التعامل`} />
          <Stat
            label="المستحقّ له"
            minor={balance}
            tone={balance > 0 ? "warn" : "ok"}
            sub={
              creditLeft > 0
                ? `لك عنده ${formatRiyalsDisplay(creditLeft)} دفعتَها بلا فاتورة`
                : balance > 0
                  ? "بعد خصم ما دفعتَه له"
                  : "لا رصيد"
            }
          />
          <Stat
            label="حال العلاقة"
            value={GRADE_LABEL[overall]}
            tone={GRADE_TONE[overall]}
            sub="أسوأ الأبعاد هو الحاكم"
          />
          <Stat
            label="تغيّر السعر"
            value={priceChangePct === null ? "غير مقيس" : `${priceChangePct > 0 ? "+" : ""}${Math.round(priceChangePct)}٪`}
            tone={priceChangePct === null ? "muted" : priceChangePct > 5 ? "warn" : "ok"}
            sub={priceChangePct === null ? "لا تكفي بنوده" : "أوّل شهر مقابل آخره"}
          />
        </StatGrid>
      )}

      {showAmounts && (
        <Section
          title="حسابه"
          hint="ما نعرفه من فواتيرنا، مقابل ما يقوله آخرُ كشفٍ وصل منه. والفرق ليس اتّهاماً — قد يكون فاتورةً حمّلها علينا ولم تصلنا، أو سداداً لم يصل كشفُه بعد."
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
      )}

      {showAmounts && canAnalyze && (
        <Section
          title="تحليل الذكاء"
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

      <Section
        title="أبعاد العلاقة"
        hint="ليست درجةً واحدة من مئة — رقمٌ كهذا يُخفي سببه فلا يُفيد عند التفاوض. وما لا تكفي بياناته يبقى غير مقيَّم، ولا يُعطى صفراً."
      >
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
      </Section>

      <Section title="بياناته">
        <Card>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Fact label="الرقم الضريبي" value={s.vatNumber} missing="ناقص" ltr />
            <Fact label="السجل التجاري" value={s.crNumber} missing="ناقص" ltr />
            <Fact label="شروط السداد" value={s.paymentTerms} missing="غير محدّدة" />
            <Fact
              label="عقد التوريد"
              value={s.contractOnFile ? "موجود" : null}
              missing={s.issuesInvoices ? "غير مطلوب" : "ناقص"}
            />
            <Fact label="الاسم في الدرايف" value={s.driveFolderName} ltr />
            <Fact label="المعرّف" value={s.slug} ltr />
            <Fact label="أسماء بديلة" value={String(n("alias_count"))} />
            <Fact label="يصدر فواتير ضريبية" value={s.issuesInvoices ? "نعم" : "لا"} />
          </dl>
        </Card>
      </Section>

      <Section
        title="آخر فواتيره"
        action={<LinkButton href={`/purchases/invoices?supplier=${s.slug}`} size="sm">كلّها</LinkButton>}
      >
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
            {
              key: "date",
              header: "التاريخ",
              cell: (r) => <span className="nums">{r.date.toISOString().slice(0, 10)}</span>,
            },
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
      </Section>

      <Section
        title="كشوفه"
        hint="الكشف هو ما يكشف الفاتورة التي لم تصلك — والمورّد بلا كشوف حسابه غير مُتحقَّق منه."
        action={<LinkButton href="/statements" size="sm">طابقها</LinkButton>}
      >
        {statementRows.length === 0 ? (
          <EmptyState
            title="لا كشف حساب واحد منه."
            hint={`تعاملتَ معه ${countNoun(n("active_months"), MONTH)} بلا كشف. اطلب كشفاً وطابقه — فهو ما يكشف ما لم يصلك.`}
            action={<LinkButton href="/statements" variant="primary">ارفع كشفاً</LinkButton>}
          />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {statementRows.map((st) => (
              <li key={st.id} className="nums rounded-xl border border-line bg-raised px-3 py-1.5 text-xs shadow-raised">
                {st.periodStart.toISOString().slice(0, 10)} ← {st.periodEnd.toISOString().slice(0, 10)}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageShell>
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
