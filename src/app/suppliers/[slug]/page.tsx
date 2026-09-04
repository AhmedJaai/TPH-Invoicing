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
import { countNoun, INVOICE, MONTH, PRODUCT } from "@/lib/arabic";

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
  if (!user) redirect("/login");

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
        (select count(distinct period_month)::int from invoices
          where supplier_id = ${s.id})                                             as active_months,
        (select count(*)::int from supplier_aliases where supplier_id = ${s.id})    as alias_count,
        (select count(*)::int from supplier_products where supplier_id = ${s.id})   as product_count
    `)
  ).rows;

  const n = (k: string) => Number(stats?.[k] ?? 0);
  const billed = n("billed");
  const balance = billed - n("paid");

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
    statementCount: n("statement_count"),
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
          <LinkButton href="/statements" size="sm">راجع كشوفه</LinkButton>
          <LinkButton href="/settings" size="sm">عدّل بياناته</LinkButton>
        </>
      }
    >
      {showAmounts && (
        <StatGrid>
          <Stat label="المفوتر" minor={billed} sub={`منذ ${countNoun(n("active_months"), MONTH)}`} />
          <Stat
            label="الرصيد المستحقّ"
            minor={balance}
            tone={balance > 0 ? "warn" : "ok"}
            sub={balance > 0 ? "عليك له" : "لا رصيد"}
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
        action={<LinkButton href="/purchases" size="sm">كلّها</LinkButton>}
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
                  align: "end" as const,
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
