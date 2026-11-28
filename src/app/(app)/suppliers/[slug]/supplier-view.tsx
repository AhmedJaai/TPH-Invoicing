import { Suspense } from "react";
import { RecordHistory } from "@/components/record-history";
import { isUntaxedInvoice, UNTAXED_HINT, UNTAXED_LABEL } from "@/lib/invoice-tax-display";
import { SupplierQrLine } from "@/components/supplier-qr";
import { SectionBoundary } from "@/components/ui-client";
import Link from "next/link";
import { PriceStateCell } from "@/components/price-state";
import { isRealMove } from "@/lib/price-watch";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  Banknote, CalendarClock, FileText, History, Printer, Scale, ScrollText, Sparkles, Store, Tags, Timer,
} from "lucide-react";
import { db } from "@/db";
import { invoiceLines, invoices, supplierItemAliases, suppliers } from "@/db/schema";
import { normalizeItem } from "@/lib/items";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { DetailFrame, type DetailMode } from "@/components/detail-frame";
import { Money } from "@/components/money";
import { LiveMoney } from "@/components/live-money";
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
import { countNoun, countNounGen, DAY, INVOICE, LINE, MONTH, PAYMENT, PRODUCT, TIME } from "@/lib/arabic";
import { loadOpenInvoiceAges, loadSupplierBalances } from "@/services/supplier-balance.service";
import { SupplierItemMerge, SupplierItemUnmerge } from "@/components/supplier-item-merge";
import { similarItems } from "@/lib/items";
import { loadSupplierIntel, loadSupplierMonthly, type TimelineEvent } from "@/services/supplier-intel.service";
import { latestPriceChange, spendMonths, type PriceChangeLine, supplierExceptions, TIMELINE_FILTERS, timelineCounts, type SpendMonth, type TimelineKind } from "@/lib/supplier-overview";
import { TimelineFilter } from "@/components/timeline-filter";
import { PriceHistoryChart } from "@/components/price-history-chart";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { listOpenFindings } from "@/services/supplier-analysis.service";
import { FindingsList, RunAnalysis, type FindingView } from "@/components/ai-analysis";
import { splitSupplierCredit } from "@/lib/supplier-requests";
import { SupplierOwnerActions } from "@/components/supplier-owner-actions";
import { SupplierPolicy } from "@/components/supplier-policy";
import { SupplierEdit } from "@/components/supplier-edit";
import { SUPPLIER_CATEGORY_LABEL, pastDueOf, whatsappHref } from "@/lib/supplier-edit";
import { formatRiyals } from "@/lib/money";
import { AccountReview } from "@/components/account-review";
import { SupplierSettleCredit } from "@/components/supplier-settle-credit";
import { CreditNoteForm } from "@/components/credit-note-form";
import { StatementCreditAction } from "@/components/statement-credit-action";
import { SupplierHandDuplicates } from "@/components/hand-duplicate";
import { loadDuplicateHandPayments } from "@/services/hand-duplicate.service";
import { currentMonthRiyadh, formatDay, formatMonth, formatRange, todayInRiyadh } from "@/lib/riyadh-time";
import { buttonClass } from "@/components/ui-tokens";
import { METHOD_LABEL, paymentStatusLabel } from "@/lib/payment-state";
import { invoiceHref } from "@/lib/invoice-profile";
import { ACTION_LABEL } from "@/lib/audit-labels";
import { MIN_SETTLED_SAMPLE, ageOwed, ageTone, type ProductPriceHistory } from "@/lib/supplier-intel";
import { txHref } from "@/lib/inspector";
import { latestStatementDiscrepancies } from "@/services/statement-reconcile.service";
import { loadSettlementComparisons } from "@/services/statement-payments.service";
import { PAYMENT_METHOD_LABEL } from "@/lib/statement-payments";
import { T } from "@/components/i18n/t";


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

export async function SupplierView({
  params,
  searchParams,
  mode,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; merge?: string }>;
  mode: DetailMode;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/suppliers");

  const { slug } = await params;
  const sp = await searchParams;
  /* «ادمج» من تلميح التكرار يفتح إجراءات المالك في لسان بياناته ومعاينتها جاهزة */
  const mergeTarget = sp.merge && /^[A-Za-z0-9_-]{1,64}$/.test(sp.merge) ? sp.merge : null;
  const wantedTab = mergeTarget ? "profile" : sp.tab;
  const tab: Tab = TABS.find((t) => t.id === wantedTab)?.id ?? "invoices";
  const showAmounts = can(user.role, "amounts:view");

  const [s] = await db.select().from(suppliers).where(eq(suppliers.slug, slug));
  /* رابطٌ بالمعرّف لا بالاسم المختصر (كانت «الوضع الآن» تبنيه) يُحوَّل ولا يقع في «لم نجد هذه الصفحة» */
  if (!s && /^[0-9a-f-]{36}$/i.test(slug)) {
    const [byId] = await db.select({ slug: suppliers.slug }).from(suppliers).where(eq(suppliers.id, slug));
    if (byId) redirect(`/suppliers/${encodeURIComponent(byId.slug)}${sp.tab ? `?tab=${encodeURIComponent(sp.tab)}` : ""}`);
  }
  if (!s) {
    /* في اللوح يُقال الخبرُ في اللوح نفسه — صفحةُ ٤٠٤ العامّة كانت تأخذ مكانَه بلا إطاره ولا زرّ إغلاقه */
    if (mode !== "drawer") notFound();
    return (
      <DetailFrame mode={mode} fullHref="/suppliers" user={user} width="page" title="مورّد غير موجود">
        <EmptyState
          icon={Store}
          title="لا يوجد مورّد بهذا الرابط."
          hint="ربما دُمج مع مورّد آخر فتغيّر رابطه. ابحث عنه باسمه في قائمة المورّدين."
          action={<LinkButton href="/suppliers" variant="primary">المورّدون</LinkButton>}
        />
      </DetailFrame>
    );
  }

  /*
    كلُّ ما في الملفّ يحتاج معرّفَ المورّد وحده — فيُطلَب معاً ويُنتظَر أطولُه. كان
    نحوَ اثني عشر استعلاماً ينتظر كلٌّ ما قبله، واللوحُ يفتح بمجموع أزمنتها.
  */

  /* آخرُ كشفٍ قُرئ رصيدُه — تاريخُه يُحسب في الاستعلام نفسه، فلا ينتظر استعلامُ «عند الكشف» استعلامَ الإحصاء */
  const reportedDay = sql`(select to_char(period_end, 'YYYY-MM-DD')::date from statements
          where supplier_id = ${s.id} and closing_balance_minor is not null
          order by period_end desc nulls last limit 1)`;

  const balP = loadSupplierBalances(db, s.id);

  const [
    statsRes, balRows, ages, findingsRaw, intel, atStatementRes, invoicesAtStatementRes, why,
    recent, statementRes, paymentRes, settlementRows, monthlyRows,
  ] = await Promise.all([
    db.execute<Record<string, number | string | null>>(sql`
      select
        inv.invoice_count, inv.billed, inv.tax_valid, inv.tax_invalid, inv.tax_unknown, inv.active_months,
        (select coalesce(sum(pa.amount_minor), 0)::bigint from payment_allocations pa
          join invoices i on i.id = pa.invoice_id where i.supplier_id = ${s.id})    as paid,
        (select count(*)::int from statements where supplier_id = ${s.id})          as statement_count,
        -- آخر رصيد ختاميّ قرأناه من كشوفه. وقد يغيب: كشف وصل ولم
        -- يقرأ رصيده ليس كشفاً يقول «صفر».
        (select closing_balance_minor from statements
          where supplier_id = ${s.id} and closing_balance_minor is not null
          order by period_end desc nulls last limit 1)                              as reported_balance,
        (select to_char(period_end, 'YYYY-MM-DD') from statements
          where supplier_id = ${s.id} and closing_balance_minor is not null
          order by period_end desc nulls last limit 1)                              as reported_at,
        -- الأشهر التي تغطّيها كشوفه لا عدد ملفّاتها: كشف تراكميّ لأربعة أشهر أربعة
        (select count(distinct to_char(m, 'YYYY-MM'))::int
           from statements st,
                generate_series(date_trunc('month', coalesce(st.period_start, st.period_end)),
                                date_trunc('month', st.period_end), interval '1 month') m
          where st.supplier_id = ${s.id} and st.period_end is not null)            as statement_months,
        (select count(*)::int from supplier_aliases where supplier_id = ${s.id})    as alias_count,
        (select count(*)::int from supplier_products where supplier_id = ${s.id})   as product_count,
        -- المقدّمة المعلنة — وحدها «لك عنده» (SCN-105)
        (select coalesce(sum(amount_minor - fee_minor), 0)::bigint from payments
          where supplier_id = ${s.id} and status = 'ADVANCE')                       as advance
      /* فواتيره تمسح مرّةً واحدة — كانت ستّة استعلامات فرعيّة على الجدول نفسه */
      from (
        select count(*)::int                                          as invoice_count,
               coalesce(sum(total_minor), 0)::bigint                  as billed,
               count(*) filter (where tax_status = 'VALID')::int      as tax_valid,
               count(*) filter (where tax_status = 'INVALID')::int    as tax_invalid,
               count(*) filter (where tax_status = 'UNKNOWN')::int    as tax_unknown,
               count(distinct period_month)::int                      as active_months
          from invoices where supplier_id = ${s.id}
      ) inv
    `),
    balP,
    loadOpenInvoiceAges(s.id),
    showAmounts ? listOpenFindings(s.id) : Promise.resolve([]),
    /* «المسدَّد» ما عدا المفتوحَ الذي يعدّه مصدرُ الأرصدة — لا عتبةٌ ثانية */
    loadSupplierIntel(s.id, balP.then((rows) => rows[0]?.openCount ?? 0), 15),
    db.execute<{ billed: string; paid: string; allocated_after: string }>(sql`
      select
        (select coalesce(sum(total_minor), 0)::bigint from invoices
          where supplier_id = ${s.id} and invoice_date::date <= ${reportedDay}) as billed,
        (select coalesce(sum(amount_minor - fee_minor), 0)::bigint from payments
          where supplier_id = ${s.id} and status not in ('REVERSED','VOID')
            and paid_at::date <= ${reportedDay})                                as paid,
        /* ما سدّد بعد الكشف من فواتير سبقته — يبدو مفتوحاً عنده ومسدّداً اليوم */
        (select coalesce(sum(pa.amount_minor), 0)::bigint
           from payment_allocations pa
           join payments p on p.id = pa.payment_id
           join invoices i on i.id = pa.invoice_id
          where p.supplier_id = ${s.id} and p.status not in ('REVERSED','VOID')
            and p.paid_at::date > ${reportedDay}
            and i.invoice_date::date <= ${reportedDay})                         as allocated_after
    `),
    db.execute<{ invoice_number: string; total_minor: string }>(sql`
      select invoice_number, total_minor from invoices
       where supplier_id = ${s.id} and invoice_date::date <= ${reportedDay}
    `),
    /* ما يفسّر الفرق — سطراً سطراً من آخر كشف، لا رقماً واحداً */
    showAmounts ? latestStatementDiscrepancies(s.id) : Promise.resolve(null),
    /* ── بيانات اللسان المفتوح وحده ── */
    tab === "invoices"
      ? db
          .select({
            id: invoices.id,
            number: invoices.invoiceNumber,
            date: invoices.invoiceDate,
            total: invoices.totalMinor,
            taxStatus: invoices.taxStatus,
            vatMinor: invoices.vatMinor,
            sellerVat: invoices.sellerVat,
            /* `${invoices}.id` لا `${invoices.id}` — الثاني يصمت في الاستعلام الفرعيّ */
            allocated: sql<number>`coalesce((
              select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = ${invoices}.id
            ), 0)`,
          })
          .from(invoices)
          .where(eq(invoices.supplierId, s.id))
          .orderBy(desc(invoices.invoiceDate))
          .limit(60)
      : Promise.resolve([]),
    /* كشوفُه ودفعاتُه تُجلَب مهما كان اللسان: عددُها يظهر على اللسانين */
    db.execute<{ id: string; ps: string; pe: string; closing: number | null; lines: number; invoice_lines: number; matched: number }>(sql`
      select st.id, st.period_start::text as ps, st.period_end::text as pe, st.closing_balance_minor as closing,
             (select count(*)::int from statement_lines sl where sl.statement_id = st.id) as lines,
             /* مقامُ «طُوبق» فواتيرُ الكشف لا أسطرُ السداد فيه */
             (select count(*)::int from statement_lines sl where sl.statement_id = st.id and sl.debit_minor > 0) as invoice_lines,
             (select count(*)::int from statement_lines sl where sl.statement_id = st.id and sl.match_status = 'MATCHED' and sl.debit_minor > 0) as matched
        from statements st
       where st.supplier_id = ${s.id}
       order by st.period_end desc
       limit 24
    `),
    /*
      دفعاته — والسؤال الذي تُفتح له الصفحة قبل التفاوض «لِمَ عليّ هذا؟»
      لا يُجاب إلّا بالطرفين: ما فُوتر وما دُفع.
    */
    showAmounts
      ? db.execute<{
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
        `)
      : Promise.resolve(null),
    /* دائنُ آخر كشفه مقابلَ ما دفعناه — سطراً بسطر */
    showAmounts ? loadSettlementComparisons([s.id]) : Promise.resolve([]),
    /* فواتيرُه ودفعاتُه بالشهر — مالٌ كلُّه، فلمن يرى المبالغ وحده */
    showAmounts ? loadSupplierMonthly(s.id, currentMonthRiyadh()) : Promise.resolve([]),
  ]);
  /* دائنُ كشفه مقابلَ ما دفعناه (`lib/statement-payments.ts`) — لآخر كشفٍ وحده، كأسباب الفرق */
  const settlement = settlementRows[0]?.comparison ?? null;
  const paidNotCredited = settlement?.oursOnly ?? [];
  const creditedUnknown = settlement?.theirsOnly ?? [];
  const creditSuggested = settlement?.creditSuggested ?? [];
  const statementRows = statementRes.rows;
  const paymentRows = paymentRes?.rows ?? [];

  const stats = statsRes.rows[0];
  const n = (k: string) => Number(stats?.[k] ?? 0);
  const billed = n("billed");

  /*
    ما عليك له = فواتيره المفتوحة ناقصَ ما دفعتَه له ولم يُخصم من فاتورة —
    من `loadSupplierBalances` وحدها، كما في القائمة والرئيسية.
  */
  const bal = balRows[0];
  const balance = bal?.owedMinor ?? 0;
  const creditLeft = bal?.creditLeftMinor ?? 0;
  /* مالٌ دُفع ولم يُنسب، وفاتورةٌ مفتوحة معاً — المجموعُ صفرٌ والحقيقةُ غيرُ معروفة */
  const unapplied = bal?.creditMinor ?? 0;
  const offsetting = balance === 0 && creditLeft === 0 && (bal?.openMinor ?? 0) > 0;
  const paidNet = bal?.paidNetMinor ?? n("paid");
  const creditSplit = splitSupplierCredit(creditLeft, n("advance"));
  /* رصيدٌ «لك» هو دفعةٌ قُيّدت مرّتين بيد — يُقال بجانب الرقم وبابُه معه (`hand-duplicate.service.ts`) */
  const handDups = showAmounts && (creditLeft > 0 || unapplied > 0) ? await loadDuplicateHandPayments(db, s.id) : [];
  const ageing = ageOwed(ages.get(s.id) ?? [], balance);
  const ageOf = new Map((ages.get(s.id) ?? []).map((a) => [a.id, a.ageDays]));

  /*
    المتأخّرُ بأجل المورّد نفسه (`payment_terms_days`) — و`null` حين يُجهل الأجل:
    لا يُقال «متأخّر» عن مورّدٍ أمهلنا، ولا «في أجله» عن غير علم.
  */
  const pastDue = pastDueOf(ages.get(s.id) ?? [], s.paymentTermsDays, todayInRiyadh());

  const canAnalyze = can(user.role, "supplier:edit");
  /* الدمجُ والحذف للمالك وحده — والمورّدون الباقون هدفاً، بلا المدموجين */
  const canMerge = can(user.role, "supplier:merge");
  const [mergeTargets, mergedInto] = await Promise.all([
    canMerge && tab === "profile" && !s.mergedIntoId
      ? db.select({ id: suppliers.id, name: suppliers.nameAr }).from(suppliers)
        .where(sql`${suppliers.id} <> ${s.id} and ${suppliers.mergedIntoId} is null and ${suppliers.isActive}`)
        .orderBy(suppliers.nameAr)
      : Promise.resolve([]),
    s.mergedIntoId
      ? db.select({ name: suppliers.nameAr, slug: suppliers.slug }).from(suppliers).where(eq(suppliers.id, s.mergedIntoId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  /* صيغٌ دُمجت في أصنافه — تُعرض تحت أصلها بزرّ فصلٍ، فالدمجُ الخاطئ لا يبقى بلا رجعة */
  const mergedAliases = new Map<string, { alias: string; name: string }[]>();
  if (tab === "prices" && canAnalyze) {
    const aliasRows = await db.select({ alias: supplierItemAliases.aliasNormalized, canonical: supplierItemAliases.canonicalNormalized })
      .from(supplierItemAliases).where(eq(supplierItemAliases.supplierId, s.id));
    if (aliasRows.length > 0) {
      const descs = await db.selectDistinct({ canonical: invoiceLines.normalizedDescription, description: invoiceLines.description })
        .from(invoiceLines)
        .where(and(eq(invoiceLines.supplierId, s.id), inArray(invoiceLines.normalizedDescription, [...new Set(aliasRows.map((a) => a.canonical))])));
      for (const a of aliasRows) {
        const name = descs.find((d) => d.canonical === a.canonical && normalizeItem(d.description) === a.alias)?.description.trim() ?? a.alias;
        mergedAliases.set(a.canonical, [...(mergedAliases.get(a.canonical) ?? []), { alias: a.alias, name }]);
      }
    }
  }
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

  /* بلا كشفٍ قُرئ رصيدُه لا «عند الكشف»: الاستعلامان يعودان فارغَين، ولا يُبنى عليهما */
  const atStatement = reportedAt ? atStatementRes.rows[0] : undefined;
  const invoicesAtStatement = reportedAt
    ? invoicesAtStatementRes.rows.map((r) => ({ invoiceNumber: r.invoice_number, totalMinor: Number(r.total_minor) }))
    : [];
  const paidAfterStatement = atStatement ? paidNet - Number(atStatement.paid) : 0;

  const account = buildSupplierAccount({
    billedMinor: atStatement ? Number(atStatement.billed) : billed,
    paidMinor: atStatement ? Number(atStatement.paid) : paidNet,
    reportedBalanceMinor: reportedRaw === null || reportedRaw === undefined ? null : Number(reportedRaw),
    allocatedAfterStatementMinor: atStatement ? Number(atStatement.allocated_after) : null,
    invoicesAtStatement,
  });

  /* تغيّرُ أسعاره في مجملها من بابٍ واحد (`supplierPriceDriftBp`): كان متوسّطَ كلّ السطور شهراً بشهر، فيخلط الكيسَ بالكرتون */
  const priceChangePct = intel.priceDriftBp === null ? null : intel.priceDriftBp / 100;

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

  const paymentCount = showAmounts ? paymentRows.length : 0;

  const rel = intel.reliability;
  /* «هو نفسه…»: أصنافُ المورّد الأخرى، والأقربُ اسماً أوّلاً ومعلَّماً */
  const mergeOptions = (key: string) => {
    const others = intel.prices.filter((p) => p.normalized !== key);
    const near = new Set(similarItems(key, others.map((p) => p.normalized)));
    return [...others]
      /* المقترَحُ أوّلاً، وبينها الأكثرُ شراءً ثمّ الأحدث — الدليلُ لا الإملاء */
      .sort((a, b) => Number(near.has(b.normalized)) - Number(near.has(a.normalized))
        || b.purchases - a.purchases
        || String(b.lastDate).localeCompare(String(a.lastDate))
        || a.displayName.localeCompare(b.displayName, "ar"))
      .map((p) => ({ key: p.normalized, name: p.displayName, suggested: near.has(p.normalized) }));
  };
  const rising = intel.prices.filter((p) => isRealMove(p.state) && p.state.deltaBp > 0).length;

  const tabCount: Partial<Record<Tab, number>> = {
    invoices: n("invoice_count"),
    payments: showAmounts ? paymentCount : undefined,
    prices: intel.prices.length,
    statements: statementRows.length,
  };

  const timeline = toTimeline(intel.events, showAmounts);
  const counts = timelineCounts(timeline.map((t) => t.kind as TimelineKind));

  /* ما يحتاج فعلاً عنده — الأرقامُ من مصادرها، والجمعُ في `supplier-overview.ts` */
  const exceptions = showAmounts
    ? supplierExceptions({
        supplierId: s.id,
        slug: s.slug,
        owedMinor: balance,
        pastDue,
        oldestOwedDays: ageing.oldestOwedDays,
        statementStatus: account.status,
        statementDifferenceMinor: account.differenceMinor,
        risingItems: rising,
        alertMinor: s.balanceAlertMinor,
        issuesStatements: s.issuesStatements,
        statementCount: statementRows.length,
        invoiceCount: n("invoice_count"),
        canPay: canApprove,
      })
    : [];
  const months = spendMonths(monthlyRows, currentMonthRiyadh());
  /* من لا يصدر فواتير ولا فاتورةَ منه تُقاس مشترياتُه بدفعاته — ومن سُجّلت له فواتير تُقاس بها */
  const spendByPaid = !s.issuesInvoices && months.every((m) => m.invoiceCount === 0);

  return (
    <DetailFrame
      mode={mode}
      fullHref={`/suppliers/${s.slug}`}
      user={user}
      width="wide"
      title={s.nameAr}
      eyebrow={
        <span className="flex flex-wrap items-center gap-2">
          <Monogram name={s.nameAr} className="h-6 w-6 text-[11px]" />
          <span>صفحة المورّد</span>
          {/* الشارةُ تفتح سياستَه — هناك تُغيَّر إن تغيّر حالُه */}
          {!s.issuesInvoices && (
            <Link href={`/suppliers/${s.slug}?tab=profile`} scroll={false} className="rounded-full hover:opacity-80">
              <Badge tone="warn">لا يصدر فواتير</Badge>
            </Link>
          )}
          {s.paperInvoices && <Badge>فواتيره ورقية</Badge>}
          {mergedInto ? <Badge tone="danger"><T s="مدموج في «{0}»" a={[mergedInto.name]} /></Badge> : !s.isActive && <Badge tone="danger">معطّل</Badge>}
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
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @3xl:items-stretch">
          {/* ── الرقم الواحد: كم عليك له، ومنذ متى، وممّ تكوّن ── */}
          <Card className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-bold text-muted">
                <span className={`grid h-7 w-7 place-items-center rounded-lg ${balance > 0 ? "bg-warn-bg text-warn" : "bg-sunken text-ink-soft"}`}>
                  <Scale className="h-4 w-4" strokeWidth={2} aria-hidden />
                </span>
                {balance > 0 ? "عليك له" : creditLeft > 0 ? "رصيد لك عنده" : offsetting ? "متوازن على الورق" : "الحساب متوازن"}
              </p>
            </div>
            <p className={`mt-4 text-[2.25rem] font-bold leading-none tracking-tight sm:text-[2.6rem] ${balance > 0 ? "text-warn" : ""}`}>
              <LiveMoney minor={balance > 0 ? balance : creditLeft} currency />
            </p>
            <p className="mt-2.5 text-xs leading-relaxed text-muted">
              {balance > 0
                ? `عن ${countNounGen(bal?.openCount ?? 0, INVOICE)} مفتوحة، بعد خصم ما دفعته له.`
                : creditLeft > 0
                  ? "مبلغ دفعته له ولم تصلك فاتورته، وسيُخصم من فواتيره القادمة."
                  : !s.issuesInvoices && paidNet > 0
                    ? "لا يصدر فواتير، فما تدفعه له يُحسب مشتريات مسدّدة يوم الدفع، ولا رصيد ينتظر فاتورة."
                  : offsetting
                    ? "توجد فاتورة مفتوحة ومبلغ دفعته لم يُربط بأي فاتورة. إما أنه سداد لم يُربط بفاتورته، وإما أن الدفعة سُجّلت مرتين."
                    : n("invoice_count") === 0 && paidNet === 0
                      ? "لا فاتورة منه ولا دفعة له حتى الآن، فلا حساب يُعرض."
                      : "لا توجد فاتورة مفتوحة ولا رصيد لك عنده."}
            </p>
            {/* ── الجواب في سطر: المتأخّر، وآخر دفعة، وآخر فاتورة ── */}
            <dl className="mt-4 grid grid-cols-3 gap-1.5 @md:gap-2">
              <Fact3
                label="متأخّر عن أجله"
                value={
                  balance <= 0 ? <span className="text-sm font-medium text-muted">لا شيء</span>
                  : pastDue === null ? <span className="text-sm font-medium text-muted">غير معروف</span>
                  : pastDue.count === 0 ? <span className="text-sm font-medium text-ok">لا شيء</span>
                  : <Money minor={pastDue.totalMinor} tone="warn" />
                }
                sub={
                  balance <= 0 ? "لا شيء مستحق له"
                  : pastDue === null
                    ? (canAnalyze
                        ? <Link href={`/suppliers/${s.slug}?tab=profile#detail`} scroll={false} className="font-bold text-accent hover:underline">لا أجل مسجّل له، سجّله</Link>
                        : "لا أجل مسجّل له")
                  : pastDue.count === 0 ? "كل فواتيره في أجلها"
                  : `${countNoun(pastDue.count, INVOICE)}، أقدمها بـ${countNoun(pastDue.oldestDays, DAY)}`
                }
                foot={ageing.oldestOwedDays !== null ? `أقدم مستحق منذ ${countNoun(ageing.oldestOwedDays, DAY)}` : undefined}
              />
              <Fact3
                label="آخر دفعة له"
                value={intel.lastPayment ? <Money minor={intel.lastPayment.amountMinor} /> : <span className="text-sm font-medium text-muted">لا دفعة بعد</span>}
                sub={intel.lastPayment ? formatDay(intel.lastPayment.date) : undefined}
                href={intel.lastPayment?.href ?? (intel.lastPayment ? `/suppliers/${s.slug}?tab=payments#detail` : undefined)}
              />
              <Fact3
                label="آخر فاتورة منه"
                value={intel.lastInvoice ? <Money minor={intel.lastInvoice.totalMinor} /> : <span className="text-sm font-medium text-muted">لا فاتورة بعد</span>}
                sub={intel.lastInvoice ? <>{formatDay(intel.lastInvoice.date)}<bdi className="block truncate font-mono" title={intel.lastInvoice.number}>{intel.lastInvoice.number}</bdi></> : undefined}
                href={intel.lastInvoice ? invoiceHref(intel.lastInvoice.id) : undefined}
              />
            </dl>

            {/* ── ما يحتاج فعلاً عنده، وبجانب كلٍّ بابُه ── */}
            {exceptions.length > 0 && (
              <ul className="mt-3 space-y-1.5" aria-label="ما يحتاج انتباهك عنده">
                {exceptions.map((e) => (
                  <li key={e.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2 text-xs ${e.tone === "info" ? "bg-info-bg" : e.tone === "danger" ? "bg-danger-bg" : "bg-warn-bg"}`}>
                    <span className={`min-w-0 flex-1 basis-48 font-bold ${TONE_TEXT[e.tone]}`}>
                      {e.title}
                      {e.amountMinor !== null && <> · <Money minor={e.amountMinor} /></>}
                    </span>
                    {e.action && <LinkButton href={e.action.href} size="sm">{e.action.label}</LinkButton>}
                  </li>
                ))}
              </ul>
            )}
            <SupplierHandDuplicates list={handDups} canAct={can(user.role, "invoice:remove")} />
            {/* ما يتقابل لا يُقال «متّزناً» وتُترك — بابُه بجانبه */}
            {unapplied > 0 && (bal?.openMinor ?? 0) > 0 && can(user.role, "payment:approve") && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warn-bg px-3 py-2 text-[11px] text-warn">
                <span className="flex-1">
                  <T s="{0} دفعتها دون ربطها بفاتورة، وتوجد فاتورة مفتوحة بالمبلغ نفسه." a={[<Money key="0" minor={Math.min(unapplied, bal?.openMinor ?? 0)} />]} /></span>
                <AccountReview size="sm" />
              </div>
            )}
            {/* دفعةٌ زادت واستُردّت بخصمها من لاحقة: التسويةُ هنا حيث يُرى «متوازن على الورق»، لا في بندٍ يمكن إخفاؤه */}
            {unapplied > 0 && (bal?.openMinor ?? 0) > 0 && can(user.role, "payment:approve") && (
              <Suspense fallback={null}>
                <SupplierSettleCredit supplierId={s.id} />
              </Suspense>
            )}
            {/* إشعارٌ على الحساب لا على فاتورة — مرتجعٌ من أكثر من فاتورة أو خصمٌ على الشهر */}
            {canApprove && <CreditNoteForm supplierId={s.id} today={todayInRiyadh()} />}

            {balance > 0 && (
              <div className="mt-5">
                <AgeingBar buckets={ageing.buckets} />
                {ageing.unagedMinor > 0 && (
                  <p className="mt-2 text-[11px] text-warn">
                    <T s="{0} منه لا نعرف فاتورته. حدّث الصفحة." a={[<Money key="0" minor={ageing.unagedMinor} />]} /></p>
                )}
              </div>
            )}

            {/* ── ممّ تكوّن: كلُّ طرفٍ يفتح سجلّاته ── */}
            <dl className="mt-5 divide-y divide-line-soft rounded-lg border border-line-soft bg-sunken/50 px-3 text-xs">
              <Trace label="فواتير صدرت عليك" minor={billed} href={`/purchases/invoices?supplier=${s.slug}`} />
              <Trace label="دفعت له" minor={paidNet} href={`/suppliers/${s.slug}?tab=payments#detail`} />
              {(bal?.creditNotesMinor ?? 0) > 0 && (
                <Trace label="إشعارات دائنة (مرتجع أو خصم)" minor={bal?.creditNotesMinor ?? 0} href={`/suppliers/${s.slug}?tab=payments#detail`} />
              )}
              <Trace label="المتبقي على فواتيره" minor={bal?.openMinor ?? 0} href={`/purchases/invoices?supplier=${s.slug}&paid=OPEN`} />
              {creditSplit.unbackedMinor > 0 && (
                <Trace label="دفعات بلا فاتورة" minor={creditSplit.unbackedMinor} href={`/suppliers?unbacked=1#unbacked-${s.slug}`} />
              )}
              {creditSplit.advanceMinor > 0 && <Trace label="دفعة مقدّمة" minor={creditSplit.advanceMinor} />}
            </dl>
          </Card>

          <div className="grid gap-3">
            {/* ── ما نعرفه مقابل ما يقوله كشفه ── */}
            <Card>
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <T s="{0}سجلاتنا مقارنةً بكشف المورّد" a={[<ScrollText key="0" className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />]} /></h2>
              <dl className="mt-3 grid grid-cols-3 gap-3">
                <Compare
                  label="ما نعرفه"
                  value={account.knownBalanceMinor === null ? null : account.knownBalanceMinor}
                  missing="غير معروف"
                  sub={reportedAt ? `حتى ${formatDay(reportedAt)}` : "من فواتيرنا"}
                />
                <Compare
                  label="بحسب كشف المورّد"
                  value={account.reportedBalanceMinor}
                  missing="لم يصل كشف"
                  sub={reportedAt ? "آخر رصيد ختامي" : "أو وصل الكشف ولم يُقرأ بعد"}
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
                {paidAfterStatement > 0 && <> <T s=" · ودفعت له بعد تاريخ كشفه {0}" a={[<Money key="0" minor={paidAfterStatement} />]} /></>}
                {account.allocatedAfterStatementMinor ? <> <T s=" · وخُصّص بعده على فواتير أقدم من الكشف {0}" a={[<Money key="0" minor={account.allocatedAfterStatementMinor} />]} /></> : null}
              </p>
              {why && (why.missing.length + why.ambiguous.length + why.priceDiffs.length + why.notInStatement.length + paidNotCredited.length + creditedUnknown.length + creditSuggested.length > 0) && (
                <div className="mt-3 space-y-2.5 border-t border-line-soft pt-3 text-xs">
                  <p className="font-bold"><T s="أسباب الفرق، من كشفه حتى {0}" a={[formatDay(why.periodEnd)]} /></p>
                  {why.missing.length > 0 && (
                    <div>
                      <p className="text-warn">فواتير في كشفه ليست عندنا، اطلبها منه:</p>
                      <ul className="mt-1 space-y-0.5">
                        {why.missing.map((m, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span><bdi className="nums">{m.ref ?? "بلا رقم"}</bdi> · {formatDay(m.day)}{m.unclear && <span className="text-warn"> · مرجع مقروء ملتبس، قارنه بورقة الكشف</span>}</span>
                            <Money minor={m.amountMinor} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {why.ambiguous.length > 0 && (
                    <div>
                      <p className="text-warn">سطور مرجعها لا يطابق فاتورة، ولنا أكثر من فاتورة باليوم والمبلغ نفسيهما. ربما قُرئ المرجع خطأً، فلا تسجّلها فاتورة جديدة:</p>
                      <ul className="mt-1 space-y-0.5">
                        {why.ambiguous.map((m, i) => (
                          <li key={i} className="flex flex-wrap justify-between gap-x-3">
                            <span>
                              <bdi className="nums">{m.ref ?? "بلا رقم"}</bdi> · {formatDay(m.day)} · <T s="المرشّحة: {0}" a={[m.candidates.map((c, j) => (
                                <span key={c.invoiceId}>{j > 0 && "، "}<Link href={invoiceHref(c.invoiceId)} className="font-bold text-accent hover:underline"><bdi className="nums">{c.invoiceNumber}</bdi></Link></span>
                              ))]} />
                            </span>
                            <Money minor={m.amountMinor} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {why.priceDiffs.length > 0 && (
                    <div>
                      <p className="text-warn">فواتير مبلغها في كشفه غير مبلغها عندنا:</p>
                      <ul className="mt-1 space-y-0.5">
                        {why.priceDiffs.map((d) => (
                          <li key={d.invoiceId} className="flex flex-wrap justify-between gap-x-3">
                            <Link href={invoiceHref(d.invoiceId)} className="font-bold text-accent hover:underline"><bdi className="nums">{d.invoiceNumber}</bdi></Link>
                            <span><T s="كشفه {0} · فاتورتنا {1} · {2}{3}" a={[<Money key="0" minor={d.theirsMinor} />, <Money key="1" minor={d.oursMinor} />, d.oursMinor > d.theirsMinor ? "سجلاتنا أعلى بـ" : "سجلاتنا أقل بـ", <Money key="3" minor={Math.abs(d.oursMinor - d.theirsMinor)} />]} /></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {why.notInStatement.length > 0 && (
                    <div>
                      <p className="text-ink-soft">فواتير عندنا في فترة الكشف ولم ترد فيه:</p>
                      <ul className="mt-1 space-y-0.5">
                        {why.notInStatement.map((n) => (
                          <li key={n.invoiceId} className="flex justify-between gap-3">
                            <span><Link href={invoiceHref(n.invoiceId)} className="font-bold text-accent hover:underline"><bdi className="nums">{n.invoiceNumber}</bdi></Link> · {formatDay(n.day)}</span>
                            <Money minor={n.amountMinor} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {paidNotCredited.length > 0 && (
                    <div>
                      <p className="text-warn">دفعتها له في مدة كشفه ولم يقيّدها فيه. اطلب منه أن يقيّدها قبل أن تسدّد رصيده:</p>
                      <ul className="mt-1 space-y-0.5">
                        {paidNotCredited.map((p) => (
                          <li key={p.paymentId} className="flex justify-between gap-3">
                            <span>{formatDay(p.day)} · {PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
                            <Money minor={p.amountMinor} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {creditedUnknown.length > 0 && (
                    <div>
                      <p className="text-ink-soft">في كشفه سداد أو إشعار دائن لم نسجّله. إن كان دفعة منك فسجّلها، وإن كان إشعاراً فسجّله من سطره:</p>
                      <ul className="mt-1 space-y-1.5">
                        {creditedUnknown.map((t, i) => (
                          <li key={t.line.id ?? i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <span>{t.kind === "CREDIT_NOTE" ? "إشعار دائن" : "سداد"} · {formatDay(t.line.day)}{t.line.ref ? <> · <bdi dir="auto">{t.line.ref}</bdi></> : null}</span>
                            <Money minor={t.line.amountMinor} />
                            {t.kind === "CREDIT_NOTE" && t.line.id && canApprove && <span className="w-full"><StatementCreditAction statementLineId={t.line.id} /></span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {creditSuggested.length > 0 && (
                    <div>
                      <p className="text-warn">إشعار في كشفه يشبه إشعاراً سجّلناه ولم يُحسم. قارنه بورقته، ولا تسجّله مرة ثانية إن كان هو نفسه:</p>
                      <ul className="mt-1 space-y-0.5">
                        {creditSuggested.map((t, i) => (
                          <li key={t.line.id ?? i} className="flex flex-wrap justify-between gap-x-3">
                            <span>{formatDay(t.line.day)}{t.line.ref ? <> · <bdi dir="auto">{t.line.ref}</bdi></> : null} · {t.why}</span>
                            <Money minor={t.line.amountMinor} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Link href={`/statements?supplier=${encodeURIComponent(s.slug)}`} className="inline-block font-bold text-accent hover:underline">افتح الكشف ←</Link>
                </div>
              )}
            </Card>

            {/* ── كيف تسدّد له — من التخصيصات وحدها ── */}
            <Card>
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <T s="{0}طريقة السداد" a={[<Timer key="0" className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />]} /></h2>
              {rel.invoiceCount === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-muted">غير معروف: لا فاتورة منه بعد، فلا يمكن قياس السداد.</p>
              ) : (
                <>
                  <div className="mt-3 flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-muted">المسدّد من فواتيره</span>
                    <span className="font-bold"><T s="{0} من {1}" a={[<span key="0" className="nums">{rel.settledCount}</span>, <span key="1" className="nums">{rel.invoiceCount}</span>]} /></span>
                  </div>
                  <div className="mt-1.5">
                    <Meter value={rel.settledCount} max={rel.invoiceCount} tone={rel.settledCount === rel.invoiceCount ? "ok" : "accent"} label="الفواتير المسدّدة" />
                  </div>
                  <dl className="mt-4 text-xs">
                    <div className="min-w-0">
                      <dt className="text-[11px] text-muted">من الفاتورة إلى سدادها</dt>
                      <dd className="mt-1 text-sm font-bold">
                        {rel.averageDays === null ? (
                          <span className="font-medium text-muted">غير معروف</span>
                        ) : (
                          <><T s="عادةً {0}" a={[countNoun(rel.medianDays ?? rel.averageDays, DAY)]} /></>
                        )}
                      </dd>
                      <dd className="mt-0.5 text-[11px] leading-relaxed text-muted">
                        {rel.averageDays === null
                          ? `يلزم ${countNoun(MIN_SETTLED_SAMPLE, INVOICE)} مسدّدة بدفعة معروفة، والمتوفر ${rel.sampleCount}`
                          : `الوسيط من ${countNounGen(rel.sampleCount, INVOICE)} · المتوسط ${countNoun(rel.averageDays, DAY)}${rel.prepaidCount > 0 ? ` · ${rel.prepaidCount} سبقها رصيد لك عنده` : ""}`}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </Card>
          </div>
        </div>
      )}

      {showAmounts && (
        <Section
          title={spendByPaid ? "ما دفعته له بالشهر" : "فواتيره ودفعاته بالشهر"}
          icon={CalendarClock}
          hint={!spendByPaid
            ? "الفواتير بشهرها المحاسبي وإجماليها شامل الضريبة، والدفعات بشهر يومها بعد رسم التحويل. الشهر الجاري حتى اليوم."
            : "لا يصدر فواتير، فما تدفعه له هو مشترياتك منه، بشهر يوم الدفع بعد رسم التحويل. الشهر الجاري حتى اليوم."}
        >
          <SpendByMonth months={months} byPaid={spendByPaid} />
        </Section>
      )}

      {showAmounts && (findings.length > 0 || canAnalyze) && (
        <Section
          title="اقتراحات التحليل"
          icon={Sparkles}
          count={findings.length > 0 ? findings.length : undefined}
          hint="يقرأ فواتيره ودفعاته وكشوفه وحوالات البنك، ويقترح ما يصحّح حسابه. لا يُسجَّل أي اقتراح حتى تعتمده."
          action={canAnalyze ? <RunAnalysis suppliers={[{ id: s.id, name: s.nameAr }]} label="حلّل حسابه" /> : undefined}
        >
          {findings.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-3 text-xs text-muted">
              لا توجد اقتراحات مفتوحة. اضغط «حلّل حسابه» ليعرض النظام اقتراحاته، ولن يُسجَّل شيء حتى تعتمده.
            </p>
          ) : (
            <FindingsList findings={findings} canApprove={canApprove} showSupplier={false} collapseAfter={2} />
          )}
        </Section>
      )}

      {/* ── التفصيل خلف ألسنة، وبجانبه آخرُ ما جرى ── */}
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 @5xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section id="detail" className="min-w-0 scroll-mt-24" aria-label="تفاصيل الحساب">
          <div className="mb-4">
            <LinkTabs
              label="تفاصيل الحساب"
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
                empty={<EmptyState compact icon={FileText} title="لا فواتير منه بعد." hint="ارفع فاتورة منه لتظهر هنا ويبدأ حسابه." action={<LinkButton href="/upload" size="sm" variant="primary">ارفع مستنداً</LinkButton>} />}
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
                    cell: (r) => isUntaxedInvoice({ vatMinor: r.vatMinor, sellerVat: r.sellerVat, supplierVat: s.vatNumber })
                      ? <span title={UNTAXED_HINT}><Badge tone="muted">{UNTAXED_LABEL}</Badge></span>
                      : (
                        <Badge tone={r.taxStatus === "VALID" ? "ok" : r.taxStatus === "INVALID" ? "danger" : undefined} dot>
                          {r.taxStatus === "VALID" ? "مستوفية" : r.taxStatus === "INVALID" ? "ناقصة" : r.taxStatus === "UNKNOWN" ? "لم تُقرأ" : "لا تقيّد"}
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
                          header: "المتبقي",
                          numeric: true as const,
                          cell: (r: (typeof recent)[number]) => {
                            const rem = r.total - Number(r.allocated);
                            if (rem <= SETTLED_TOLERANCE_MINOR) return <span className="text-[11px] font-bold text-ok">✓ مسدّدة</span>;
                            const age = ageOf.get(r.id);
                            return (
                              <span className="inline-flex flex-col items-end">
                                <span className="font-bold"><Money minor={rem} tone="warn" /></span>
                                {age !== undefined && (
                                  <span className={`text-[10px] ${TONE_TEXT[ageTone(age)]}`}><T s="منذ {0}" a={[countNoun(age, DAY)]} /></span>
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
                  <T s="يُعرض آخر {0} من {1}، {2}." a={[recent.length, countNoun(n("invoice_count"), INVOICE), <Link key="2" href={`/purchases/invoices?supplier=${s.slug}`} className="font-bold text-accent hover:underline">اعرض الكل في الفواتير</Link>]} /></p>
              )}
            </>
          )}

          {tab === "payments" && showAmounts && (
            <DataTable
              rows={paymentRows}
              keyOf={(r) => r.id}
              hrefOf={(r) => (r.tx ? txHref(r.tx) : undefined)}
              empty={<EmptyState compact icon={Banknote} title="لا توجد دفعة مسجّلة له." hint="تُسجَّل الدفعة من حركة بنكية، أو من إيصال سداد مؤرشف." action={<LinkButton href="/bank" size="sm">افتح حركة البنك</LinkButton>} />}
              columns={[
                { key: "date", header: "التاريخ", primary: true, cell: (r) => <span className="whitespace-nowrap">{formatDay(r.d)}</span> },
                { key: "amount", header: "المبلغ", numeric: true, cell: (r) => <span className="font-bold"><Money minor={Number(r.amount)} /></span> },
                { key: "allocated", header: "المخصّص لفواتيره", numeric: true, cell: (r) => <Money minor={Number(r.allocated)} /> },
                {
                  key: "left",
                  header: "بلا فاتورة",
                  numeric: true,
                  cell: (r) => {
                    const left = Number(r.amount) - Number(r.fee) - Number(r.allocated);
                    return left > 100 && r.status !== "REVERSED" && r.status !== "VOID"
                      ? <span className="font-bold"><Money minor={left} tone="warn" /></span>
                      : <span className="text-muted">لا شيء</span>;
                  },
                },
                { key: "method", header: "طريقة الدفع", secondary: true, cell: (r) => <span className="text-xs text-ink-soft">{METHOD_LABEL[r.method] ?? r.method}</span> },
                {
                  key: "state",
                  header: "الحالة",
                  cell: (r) => (
                    <Badge tone={r.status === "REVERSED" || r.status === "VOID" ? "danger" : r.status === "APPLIED" ? "ok" : undefined} dot>
                      {paymentStatusLabel(r.status)}
                    </Badge>
                  ),
                },
                {
                  key: "tx",
                  header: "الحركة البنكية",
                  secondary: true,
                  cell: (r) => r.tx ? <span className="text-xs font-bold text-accent">مرتبطة بحركة بنكية</span> : <span className="text-xs text-muted">بلا حركة بنكية</span>,
                },
              ]}
            />
          )}

          {tab === "prices" && (
            <>
              <p className="mb-3 max-w-3xl text-xs leading-relaxed text-muted">
                سعر الوحدة الفعلي في كل شراء منه بعد الخصم، ولهذا المورّد وحده. «آخر تغيّر» هو الفرق بين سعره المعتاد الآن وسعره المعتاد قبله، ولا يُعدّ تغيّراً حتى يتكرّر في فاتورتين. صيغ الاسم الواحد للصنف تُجمع، والفرق الذي سببه الضريبة أو وحدة مختلفة يُعرض «راجع البند».
              </p>
              <DataTable
                rows={intel.prices}
                keyOf={(p) => p.normalized}
                searchOf={(p) => p.displayName}
                searchLabel="ابحث عن صنف"
                empty={
                  <EmptyState
                    compact
                    icon={Tags}
                    title="لم تُقرأ بنود من فواتيره بعد."
                    hint="الأسعار تُبنى من بنود الفواتير. حين يقرأ النظام فاتورة منه يظهر هنا سعر كل صنف فيها."
                  />
                }
                columns={[
                  {
                    key: "item",
                    header: "الصنف",
                    primary: true,
                    wrap: true,
                    cell: (p) => {
                      const change = latestPriceChange(p.state);
                      return (
                      <span className="block min-w-0">
                        {/* الاسمُ يلتفّ ولا يُقصّ — «حليب نادك قليل الدسم 1 لتر» كان يُقرأ «حليب نادك قل…» */}
                        <span className="block font-bold [overflow-wrap:anywhere]" dir="auto">{p.displayName}</span>
                        <span className="block text-[11px] font-normal text-muted">
                          <T s="اشتريته {0} · آخر مرة {1}" a={[countNoun(p.purchases, TIME), formatDay(p.lastDate)]} /></span>
                        {showAmounts && change && <span className="mt-1 block"><PriceChangeChip change={change} /></span>}
                        {showAmounts && p.history.length > 1 && (
                          <a href={`#price-${encodeURIComponent(p.normalized)}`} className="relative mt-0.5 block text-[11px] font-bold text-accent hover:underline">
                            <T s="تاريخ سعره ({0})" a={[countNoun(p.history.length, INVOICE)]} />
                          </a>
                        )}
                        {canAnalyze && (mergedAliases.get(p.normalized) ?? []).map((a) => (
                          <SupplierItemUnmerge key={a.alias} supplierId={s.id} alias={a.alias} name={a.name} into={p.displayName} />
                        ))}
                        {canAnalyze && (
                          <SupplierItemMerge
                            supplierId={s.id}
                            item={p.normalized}
                            name={p.displayName}
                            options={mergeOptions(p.normalized)}
                          />
                        )}
                      </span>
                      );
                    },
                  },
                  ...(showAmounts
                    ? [
                        { key: "now", header: "السعر الآن", numeric: true as const, cell: (p: (typeof intel.prices)[number]) => p.lastMinor === null ? <span className="text-[11px] text-muted">غير معروف</span> : <span className="font-bold"><Money minor={p.lastMinor} /></span> },
                        {
                          key: "move",
                          header: "آخر تغيّر",
                          cell: (p: (typeof intel.prices)[number]) => <PriceStateCell state={p.state} purchases={p.purchases} />,
                        },
                        {
                          key: "since",
                          header: "منذ أول شراء",
                          secondary: true,
                          cell: (p: (typeof intel.prices)[number]) =>
                            p.changePct === null ? <span className="text-[11px] text-muted">—</span> : <Delta pct={p.changePct} favourable={p.changePct <= 0} />,
                        },
                        {
                          key: "trend",
                          header: "اتجاه السعر",
                          secondary: true,
                          cell: (p: (typeof intel.prices)[number]) =>
                            p.points.length >= 2 && p.state.kind !== "STABLE" && p.state.kind !== "NEW" ? (
                              <Sparkline values={p.points} label={`اتجاه سعر ${p.displayName}`} tone={isRealMove(p.state) && p.state.deltaBp > 0 ? "warn" : "accent"} />
                            ) : (
                              <span className="text-[11px] text-muted">ثابت</span>
                            ),
                        },
                      ]
                    : []),
                ]}
              />
              {showAmounts && <PriceHistories prices={intel.prices} />}
            </>
          )}

          {tab === "statements" && (
            statementRows.length === 0 ? (
              <EmptyState
                compact
                icon={ScrollText}
                title={s.issuesStatements ? "لم يصل منه أي كشف حساب." : "لا يصدر كشوف حساب، كما هو مسجّل في صفحته."}
                hint={
                  s.issuesStatements
                    ? `تعاملت معه ${countNoun(n("active_months"), MONTH)} دون كشف حساب. الكشف يُظهر الفاتورة التي سجّلها عليك ولم تصلك، ولن تجدها في أرشيفك لأنها ليست فيه.`
                    : "حسابه عندنا مبني على فواتيره ودفعاته فقط. ويمكنك طباعة كشف حسابه من سجلاتنا بزر «كشف الحساب»."
                }
                action={
                  <>
                    {s.issuesStatements && <LinkButton href={`/statements?supplier=${encodeURIComponent(s.slug)}`} variant="primary" size="sm">ارفع كشفه وطابقه</LinkButton>}
                    {showAmounts && <LinkButton href={`/suppliers/${s.slug}/statement`} size="sm" icon={Printer}>كشف حسابه من سجلاتنا</LinkButton>}
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
                            ? Number(st.invoice_lines) > 0
                              ? `${countNoun(Number(st.invoice_lines), INVOICE)} · طُوبق منها ${Number(st.matched)}`
                              : `${countNoun(Number(st.lines), LINE)} · لا فواتير فيه`
                            : "لم تُقرأ أسطره بعد، طابقه ليقرأها النظام."}
                        </span>
                      </span>
                      {showAmounts && (
                        <span className="shrink-0 text-end">
                          <span className="block text-[11px] text-muted">رصيده الختامي</span>
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
                  {showAmounts && <LinkButton href={`/suppliers/${s.slug}/statement`} size="sm" icon={Printer}>كشف حسابه من سجلاتنا</LinkButton>}
                </div>
              </>
            )
          )}

          {tab === "profile" && (
            <div className="space-y-4">
              {canMerge && (
                <SupplierOwnerActions
                  supplierId={s.id}
                  supplierName={s.nameAr}
                  targets={mergeTargets}
                  initialTargetId={mergeTarget && mergeTargets.some((t) => t.id === mergeTarget) ? mergeTarget : null}
                  mergedInto={mergedInto}
                />
              )}
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
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">بياناته</h3>
                  <div className="flex flex-wrap gap-2">
                    {s.phoneE164 && (
                      <a href={whatsappHref(s.phoneE164, "")} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
                        <T s="واتساب {0}" a={[s.contactName ?? ""]} /></a>
                    )}
                    {canAnalyze && (
                      <SupplierEdit
                        supplierId={s.id}
                        initial={{
                          nameAr: s.nameAr,
                          nameEn: s.nameEn ?? "",
                          vatNumber: s.vatNumber ?? "",
                          crNumber: s.crNumber ?? "",
                          category: s.category,
                          paymentTermsDays: s.paymentTermsDays === null ? "" : String(s.paymentTermsDays),
                          balanceAlert: s.balanceAlertMinor === null ? "" : formatRiyals(s.balanceAlertMinor),
                          phone: s.phoneE164 ?? "",
                          email: s.email ?? "",
                          contactName: s.contactName ?? "",
                          iban: s.iban ?? "",
                        }}
                        termsHint={rel.medianDays !== null ? { medianDays: rel.medianDays, sampleCount: rel.sampleCount } : undefined}
                      />
                    )}
                  </div>
                </div>
                <KeyValue
                  columns={4}
                  items={[
                    { label: "الرقم الضريبي", value: <Fact value={s.vatNumber} missing="ناقص" ltr /> },
                    { label: "السجل التجاري", value: <Fact value={s.crNumber} missing="ناقص" ltr /> },
                    {
                      label: "أجل السداد",
                      value: <Fact
                        value={s.paymentTermsDays === null ? s.paymentTerms : s.paymentTermsDays === 0 ? "نقداً" : countNoun(s.paymentTermsDays, DAY)}
                        missing="غير معروف (يُحسب عمر الفاتورة من تاريخها)" soft
                      />,
                    },
                    { label: "التصنيف", value: <Fact value={SUPPLIER_CATEGORY_LABEL[s.category]} /> },
                    { label: "المندوب", value: <Fact value={s.contactName} missing="غير معروف" soft /> },
                    { label: "الجوّال", value: <Fact value={s.phoneE164} missing="غير معروف" soft ltr /> },
                    { label: "البريد", value: <Fact value={s.email} missing="غير معروف" soft ltr /> },
                    { label: "الآيبان", value: <Fact value={s.iban} missing="غير مسجّل (يُعرف من الكشوف إن حوّلت له)" soft ltr /> },
                    ...(showAmounts ? [{
                      label: "حد التنبيه",
                      value: s.balanceAlertMinor === null ? <Fact value={null} missing="بلا حد" soft /> : <Money minor={s.balanceAlertMinor} />,
                    }] : []),
                    {
                      label: "عقد التوريد",
                      value: <Fact value={s.contractOnFile ? "موجود" : null} missing={s.contractRequired && !s.issuesInvoices ? "ناقص" : "غير مطلوب"} soft={!(s.contractRequired && !s.issuesInvoices)} />,
                    },
                    { label: "الاسم في الدرايف", value: <Fact value={s.driveFolderName} ltr /> },
                    { label: "المعرّف", value: <Fact value={s.slug} ltr /> },
                    { label: "أسماء بديلة", value: <Fact value={String(n("alias_count"))} /> },
                    {
                      label: "فواتيره",
                      value: <Fact value={!s.issuesInvoices ? "لا يصدر فواتير" : s.paperInvoices ? "ضريبية ورقية" : "ضريبية"} />,
                    },
                  ]}
                />
                {/* عدٌّ من أدلّة القراءة — يُقرأ بعد الرسم، وعطبُه لا يُسقط الملفّ */}
                <SectionBoundary what="رمز الفاتورة الإلكترونية">
                  <Suspense fallback={null}>
                    <SupplierQrLine supplierId={s.id} slug={s.slug} />
                  </Suspense>
                </SectionBoundary>
              </Card>

              {/* «تعاملك معه» تقييمٌ لا فعلَ له — خلف لسانٍ يُفتَح عند التفاوض. */}
              <div>
                <h3 className="mb-2 text-xs font-bold text-muted">
                  تقييم تعاملك معه (ما لا تكفيه البيانات يبقى «غير مقيّم» ولا يُحسب صفراً)
                </h3>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
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
            <T s="{0}ما جرى معه" a={[<History key="0" className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden />]} /></h2>
          {timeline.length === 0 ? (
            <EmptyState compact icon={CalendarClock} title="لا توجد أحداث بعد." hint="هنا تظهر الفواتير المرفوعة والدفعات المسجّلة بترتيب حدوثها." />
          ) : (
            <TimelineFilter filters={TIMELINE_FILTERS.map((f) => ({ ...f, count: counts[f.id] }))}>
              <div className="rounded-xl border border-line bg-raised p-4 shadow-raised sm:p-5">
                <Timeline items={timeline} />
              </div>
              <p className="mt-2 text-[11px] text-muted">يُعرض آخر 15 من كل نوع، والكل في ألسنة «فواتيره» و«دفعاته» و«كشوفه».</p>
            </TimelineFilter>
          )}
        </aside>
      </div>
      {/* سجلُّ القرار على المورّد نفسه: إنشاؤه، ودمجُه، وتعديلُ اسمه وحسابه وشروطه — بفاعلها ووقتها وسببها */}
      {can(user.role, "audit:view") && <RecordHistory viewerId={user.id} entities={[{ type: "supplier", id: s.id }]} />}
    </DetailFrame>
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
        kind: "AUDIT",
        title: ACTION_LABEL[e.title as keyof typeof ACTION_LABEL] ?? e.title,
        meta: formatDay(day),
        body: e.meta ? `بواسطة ${e.meta}` : undefined,
        icon: History,
      });
      continue;
    }
    if (e.kind === "INVOICE") {
      out.push({
        id: e.id,
        kind: "INVOICE",
        title: <><T s="فاتورة {0}" a={[<bdi key="0" className="font-mono">{e.title}</bdi>]} /></>,
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
        kind: "PAYMENT",
        title: <><T s="دفعة · {0}" a={[METHOD_LABEL[e.title] ?? e.title]} /></>,
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
      kind: "STATEMENT",
      title: "وصل كشف حساب",
      meta: formatDay(day),
      body: (
        <>
          {formatRange(from, to)}
          {showAmounts && (
            <> <T s=" · رصيده الختامي {0}" a={[e.amountMinor === null ? <span key="0" className="text-muted">غير معروف</span> : <Money key="0" minor={e.amountMinor} />]} /></>
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

/**
 * سعرُ الوحدة عبر الزمن لكلّ صنفٍ اشتُري في فاتورتين فأكثر — رسمٌ وجدولُه تحته.
 * ما تغيّر سعرُه تغيّراً مؤكَّداً يُفتح وحده، والباقي مطويّ بآخر سعره.
 */
function PriceHistories({ prices }: { prices: readonly ProductPriceHistory[] }) {
  const items = prices.filter((p) => p.history.length > 1);
  if (items.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-1 text-sm font-bold">سعر الوحدة في كل فاتورة</h3>
      <p className="mb-3 text-xs text-muted">لكل صنف اشتريته منه أكثر من مرة. اضغط نقطة في الرسم لترى سعرها وفاتورتها، والقائمة تحت الرسم فيها الأسعار كلها.</p>
      <ul className="space-y-2">
        {items.map((p) => {
          const change = latestPriceChange(p.state);
          return (
            <li key={p.normalized} id={`price-${encodeURIComponent(p.normalized)}`} className="scroll-mt-24">
              <details open={change !== null} className="rounded-xl border border-line bg-raised shadow-raised">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1 basis-48 text-[13px] font-bold [overflow-wrap:anywhere]" dir="auto">{p.displayName}</span>
                  {change && <PriceChangeChip change={change} />}
                  {p.lastMinor !== null && <span className="shrink-0 text-[13px] font-bold"><Money minor={p.lastMinor} /></span>}
                </summary>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line-soft px-4 py-3 @3xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <PriceHistoryChart
                    points={p.history}
                    since={change && p.state.kind === "MOVED" ? p.state.sinceDay : null}
                    label={`سعر وحدة ${p.displayName} في كل فاتورة`}
                  />
                  <ol className="max-h-64 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line-soft text-[12px]">
                    {[...p.history].reverse().map((h, i) => (
                      <li key={`${h.invoiceId}-${i}`}>
                        <Link href={invoiceHref(h.invoiceId, "lines")} className="flex min-h-11 items-center justify-between gap-3 px-2.5 hover:bg-hover sm:min-h-9">
                          <span className="min-w-0 text-ink-soft">{formatDay(h.day)}{h.invoiceNumber && <> · <bdi className="font-mono text-[11px]">{h.invoiceNumber}</bdi></>}</span>
                          <span className="shrink-0 font-bold"><Money minor={h.unitMinor} /></span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** «ارتفع 8٪ منذ أغسطس» — لونُ الحال معه سهمٌ وكلمة، لا لونٌ وحده. */
function PriceChangeChip({ change }: { change: PriceChangeLine }) {
  return (
    <span className={`inline-block shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${change.direction === "UP" ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok"}`}>
      {change.direction === "UP" ? "▲" : "▼"} {change.text}
    </span>
  );
}

/** حقيقةٌ من الجواب في رأس الملفّ — وبابُ سجلّها إن كان لها سجلّ. */
function Fact3({ label, value, sub, foot, href }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; foot?: string; href?: string;
}) {
  const body = (
    <>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-1 text-[13px] font-bold leading-tight @md:text-[15px]">{value}</dd>
      {sub && <dd className="mt-0.5 text-[11px] leading-snug text-muted">{sub}</dd>}
      {foot && <dd className="mt-0.5 text-[11px] leading-snug text-muted">{foot}</dd>}
    </>
  );
  const cls = "relative min-w-0 rounded-lg border border-line-soft bg-sunken/50 px-2 py-2 @md:px-3 @md:py-2.5";
  /* الخانةُ كلُّها تُضغط ويبقى `<dt>`/`<dd>` زوجاً: الرابطُ غطاءٌ فوقها لا غلافٌ لها */
  return (
    <div className={`${cls} ${href ? "transition-colors hover:border-accent-line hover:bg-hover" : ""}`}>
      {href && <Link href={href} className="absolute inset-0 rounded-lg" aria-label={label} />}
      {body}
    </div>
  );
}

/**
 * فواتيرُه ودفعاتُه شهراً بشهر — شريطٌ واحدٌ بلونٍ واحد لما يقيس الشهر (فواتيره،
 * أو دفعاته لمن لا يصدر فواتير)، والرقمُ مكتوبٌ بجانبه، والدفعاتُ نصّاً تحته.
 * وشهرٌ بلا قيدٍ يُقال بالكلمة «لا فاتورة مسجّلة» — لا «0.00» يُقرأ «لم أشترِ شيئاً».
 */
function SpendByMonth({ months, byPaid }: { months: readonly SpendMonth[]; byPaid: boolean }) {
  if (months.length === 0) {
    return (
      <EmptyState
        compact
        icon={CalendarClock}
        title="لا فاتورة منه ولا دفعة له في آخر 12 شهراً."
        hint="حين تُسجَّل فاتورة منه أو دفعة له يظهر هنا ما اشتريته منه كل شهر."
      />
    );
  }
  const measure = (m: SpendMonth) => (byPaid ? m.paidMinor : m.billedMinor);
  const max = Math.max(1, ...months.map(measure));
  const total = months.reduce((t, m) => t + measure(m), 0);
  const totalCount = months.reduce((t, m) => t + (byPaid ? m.paymentCount : m.invoiceCount), 0);
  return (
    <div className="rounded-xl border border-line bg-raised p-3 shadow-raised sm:p-4">
      <p className="mb-3 text-xs text-ink-soft">
        <T
          s="في آخر {0}: {1} في {2}."
          a={[countNoun(months.length, MONTH), <span key="1" className="font-bold text-ink"><Money minor={total} currency /></span>, byPaid ? countNoun(totalCount, PAYMENT) : countNoun(totalCount, INVOICE)]}
        />
      </p>
      <ol className="space-y-0.5">
        {months.map((m) => {
          const v = measure(m);
          const count = byPaid ? m.paymentCount : m.invoiceCount;
          return (
            <li key={m.month} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-1.5 py-1.5 @xl:grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,12rem)]">
              <span className="text-[12px] font-bold">
                {formatMonth(m.month)}
                {m.partial && <span className="block text-[10px] font-normal text-muted">حتى اليوم</span>}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  {count > 0 ? (
                    <>
                      <span
                        aria-hidden
                        className="block h-2 rounded-full bg-accent"
                        style={{ width: `${Math.max(2, (v / max) * 100) * 0.7}%` }}
                      />
                      <span className="shrink-0 text-[12px] font-bold"><Money minor={v} /></span>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted">{byPaid ? "لا دفعة مسجّلة" : "لا فاتورة مسجّلة"}</span>
                  )}
                </span>
                {/* على الجوّال: العددُ والدفعاتُ تحت الشريط */}
                <span className="mt-0.5 block text-[10px] text-muted @xl:hidden">
                  {count > 0 && (byPaid ? countNoun(count, PAYMENT) : countNoun(count, INVOICE))}
                  {!byPaid && m.paymentCount > 0 && <>{count > 0 && " · "}<T s="دفعت {0}" a={[<Money key="0" minor={m.paidMinor} />]} /></>}
                </span>
              </span>
              <span className="hidden text-[11px] text-muted @xl:block">
                {count > 0 && (byPaid ? countNoun(count, PAYMENT) : countNoun(count, INVOICE))}
                {!byPaid && m.paymentCount > 0 && <>{count > 0 && " · "}<T s="دفعت {0}" a={[<Money key="0" minor={m.paidMinor} />]} /></>}
              </span>
            </li>
          );
        })}
      </ol>
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
