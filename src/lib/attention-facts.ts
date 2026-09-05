/**
 * جمع حقائق «ما يحتاج انتباهك» من القاعدة.
 * الحساب في attention.ts دالة خالصة؛ وهذه تجلب أرقامها.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { AttentionEvidence, AttentionFacts } from "./attention";
import { previousMonth } from "./filing";
import { analyzeCoverage } from "./bank/coverage";
import { checkBalance } from "./bank/balance-equation";
import { findDuplicateExpenses, type Expense } from "./expenses";

interface Row {
  [key: string]: unknown;
}

export async function gatherAttentionFacts(): Promise<AttentionFacts> {
  const lastMonth = previousMonth(new Date().toISOString().slice(0, 7));

  const [counts] = (
    await db.execute<Row>(sql`
      select
        (select count(*)::int from issues where status='OPEN' and severity='BLOCKER')      as open_blockers,
        (select count(*)::int from documents where status in ('PENDING','NEEDS_REVIEW'))   as pending_docs,
        (select count(*)::int from invoices where tax_status='INVALID')                    as not_valid,
        (select coalesce(sum(vat_minor),0)::bigint from invoices
           where input_vat_status='NOT_ELIGIBLE' and vat_minor > 0)                        as vat_at_risk,
        (select count(*)::int from invoices where tax_status='UNKNOWN')                    as unknown_tax,
        (select count(*)::int from bank_transactions where category='UNKNOWN')             as unclassified,
        (select coalesce(sum(amount_minor),0)::bigint from bank_transactions
           where category='UNKNOWN')                                                       as unclassified_amount,
        (select count(*)::int from invoices i
           where not exists (select 1 from invoice_lines l where l.invoice_id=i.id))       as no_lines,
        (select coalesce(sum(greatest(0, i.total_minor - coalesce((
             select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id=i.id
           ),0))),0)::bigint
         from invoices i
         where i.invoice_date < now() - interval '60 days'
           and i.total_minor > coalesce((
             select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id=i.id
           ),0) + 1)                                                                       as overdue
    `)
  ).rows;

  const vatEvidence = (
    await db.execute<Row>(sql`
      select i.invoice_number, s.name_ar, i.vat_minor, i.invoice_date::date
      from invoices i left join suppliers s on s.id = i.supplier_id
      where i.input_vat_status='NOT_ELIGIBLE' and i.vat_minor > 0
      order by i.vat_minor desc limit 10
    `)
  ).rows.map<AttentionEvidence>((r) => ({
    label: String(r.invoice_number),
    sub: `${r.name_ar ?? "—"} · ${new Date(r.invoice_date as string).toISOString().slice(0, 10)}`,
    amountMinor: Number(r.vat_minor),
  }));

  const unknownEvidence = (
    await db.execute<Row>(sql`
      select i.invoice_number, s.name_ar, i.total_minor
      from invoices i left join suppliers s on s.id = i.supplier_id
      where i.tax_status='UNKNOWN' order by i.total_minor desc limit 10
    `)
  ).rows.map<AttentionEvidence>((r) => ({
    label: String(r.invoice_number),
    sub: String(r.name_ar ?? "—"),
    amountMinor: Number(r.total_minor),
  }));

  const overdueSuppliers = (
    await db.execute<Row>(sql`
      select s.name_ar,
             sum(greatest(0, i.total_minor - coalesce((
               select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id=i.id
             ),0)))::bigint as owed,
             max(extract(day from now() - i.invoice_date))::int as oldest
      from invoices i left join suppliers s on s.id = i.supplier_id
      where i.invoice_date < now() - interval '60 days'
        and i.total_minor > coalesce((
          select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id=i.id
        ),0) + 1
      group by s.name_ar order by owed desc limit 10
    `)
  ).rows.map<AttentionEvidence>((r) => ({
    label: String(r.name_ar ?? "—"),
    sub: `أقدم دين منذ ${r.oldest} يوماً`,
    amountMinor: Number(r.owed),
  }));

  // مورّدون لهم فواتير ولم يصل كشفهم عن الشهر المنقضي
  const missingStatements = (
    await db.execute<Row>(sql`
      select distinct s.name_ar
      from invoices i join suppliers s on s.id = i.supplier_id
      where not exists (
        select 1 from statements st
        where st.supplier_id = i.supplier_id
          and to_char(st.period_end, 'YYYY-MM') = ${lastMonth}
      )
      limit 8
    `)
  ).rows.map((r) => String(r.name_ar));

  const noContract = (
    await db.execute<Row>(sql`
      select name_ar from suppliers
      where is_active and not issues_invoices and not contract_on_file
    `)
  ).rows.map((r) => String(r.name_ar));

  /*
   * ارتفاعات الأسعار: تُقارَن آخر قراءتين مختلفتين للصنف عند مورّده.
   * والمقارنة داخل المورّد الواحد عمداً — الانتقال من مورّد غالٍ إلى رخيص
   * ليس «انخفاض سعر».
   */
  const rises = (
    await db.execute<Row>(sql`
      with ranked as (
        select l.normalized_description, l.supplier_id, s.name_ar, l.description,
               l.unit_price_minor, l.invoice_date,
               row_number() over (partition by l.supplier_id, l.normalized_description
                                  order by l.invoice_date desc) as rn
        from invoice_lines l left join suppliers s on s.id = l.supplier_id
        where l.invoice_date is not null and l.supplier_id is not null
      ),
      pairs as (
        select a.name_ar, a.description,
               a.unit_price_minor as now_price,
               b.unit_price_minor as then_price
        from ranked a join ranked b
          on a.supplier_id = b.supplier_id
         and a.normalized_description = b.normalized_description
         and a.rn = 1 and b.rn = 2
        where a.unit_price_minor > b.unit_price_minor
      )
      select name_ar, description, now_price, then_price
      from pairs
      where then_price > 0 and (now_price - then_price)::float / then_price >= 0.05
      order by (now_price - then_price) desc limit 10
    `)
  ).rows;

  const priceRises = rises.map<AttentionEvidence>((r) => ({
    label: String(r.description).slice(0, 40),
    sub: `${r.name_ar ?? "—"} · ${(Number(r.then_price) / 100).toFixed(2)} ← ${(Number(r.now_price) / 100).toFixed(2)}`,
    amountMinor: Number(r.now_price) - Number(r.then_price),
  }));

  /*
    فجوات التغطية — تُحسب من فترات الاستيرادات نفسها.

    وكانت تُحسب عند الاستيراد وحده ثمّ تُنسى: تُعرَض في شاشة النتيجة
    مرّةً ولا يبقى منها أثر. فمن استورد كشفاً ناقصاً في أغسطس لا يذكّره
    شيءٌ في سبتمبر.
  */
  const periods = (
    await db.execute<{ start: string | null; end: string | null }>(sql`
      select to_char(min(value_date), 'YYYY-MM-DD') as start,
             to_char(max(value_date), 'YYYY-MM-DD') as end
      from bank_transactions
      group by bank_import_id
    `)
  ).rows
    .filter((r): r is { start: string; end: string } => r.start !== null && r.end !== null);

  const coverage = periods.length > 0 ? analyzeCoverage(periods) : null;
  const gaps = coverage?.gaps ?? [];

  const bankGapRanges = gaps.slice(0, 8).map<AttentionEvidence>((g) => ({
    label: `${g.start} ← ${g.end}`,
    sub: `${g.days} يوماً بلا كشف`,
  }));

  /*
    معادلة الكشف على المدى المغطّى كلِّه.
    والمجهول يبقى `null` — لا صفراً؛ فالصفر هنا يقول «الحساب مضبوط»
    وهو لا يُعلم.
  */
  const [totals] = (
    await db.execute<{ credits: number | null; debits: number | null }>(sql`
      select coalesce(sum(amount_minor) filter (where direction = 'CREDIT'), 0)::int as credits,
             coalesce(sum(amount_minor) filter (where direction = 'DEBIT'), 0)::int  as debits
      from bank_transactions
    `)
  ).rows;

  const [balances] = (
    await db.execute<{ opening: number | null; closing: number | null }>(sql`
      select sum(opening_balance_minor)::int as opening,
             sum(closing_balance_minor)::int as closing
      from reconciliation_periods
    `)
  ).rows;

  const balance = checkBalance({
    openingMinor: balances?.opening ?? null,
    closingMinor: balances?.closing ?? null,
    creditsMinor: Number(totals?.credits ?? 0),
    debitsMinor: Number(totals?.debits ?? 0),
  });

  /*
    ازدواج المصروف — يُكشَف ولا يُحذَف.

    والكشف في `lib/expenses.ts` دالّةً خالصة، وهي التي تستثني ما اختلف
    أثرُه: حركتان بنكيّتان مختلفتان حدثان لا حدث.
  */
  const expenseRows = (
    await db.execute<Record<string, unknown>>(sql`
      select id, period_month, occurred_on, category, label,
             amount_minor, source, bank_transaction_id
        from expenses
       where occurred_on >= to_char(now() - interval '120 days', 'YYYY-MM-DD')
    `)
  ).rows.map<Expense>((r) => ({
    id: String(r.id),
    periodMonth: String(r.period_month),
    occurredOn: String(r.occurred_on),
    category: r.category as Expense["category"],
    label: String(r.label),
    amountMinor: Number(r.amount_minor),
    source: r.source as Expense["source"],
    bankTransactionId: r.bank_transaction_id ? String(r.bank_transaction_id) : null,
  }));

  const dupExpenses = findDuplicateExpenses(expenseRows);

  return {
    duplicateExpenses: dupExpenses.length,
    duplicateExpenseAmountMinor: dupExpenses.reduce((s, d) => s + d.amountMinor, 0),
    duplicateExpenseEvidence: dupExpenses.slice(0, 6).map<AttentionEvidence>((d) => ({
      label: d.label.slice(0, 45),
      sub: `${d.occurredOn} · ${d.sources.join(" + ")}`,
      amountMinor: d.amountMinor,
    })),
    bankGapDays: gaps.reduce((sum, g) => sum + g.days, 0),
    bankGapRanges,
    bankBalanceDifferenceMinor: balance.differenceMinor,
    openBlockers: Number(counts?.open_blockers ?? 0),
    pendingDocuments: Number(counts?.pending_docs ?? 0),
    // كشف الدفعات المكرّرة يحتاج قراءة الكشف نفسه — يُعرض من صفحة البنك
    duplicatePayments: 0,
    duplicatePaymentAmountMinor: 0,
    notTaxValidCount: Number(counts?.not_valid ?? 0),
    vatAtRiskMinor: Number(counts?.vat_at_risk ?? 0),
    vatAtRiskEvidence: vatEvidence,
    unknownTaxCount: Number(counts?.unknown_tax ?? 0),
    unknownTaxEvidence: unknownEvidence,
    overdueMinor: Number(counts?.overdue ?? 0),
    overdueSuppliers,
    unclassifiedBankTx: Number(counts?.unclassified ?? 0),
    unclassifiedBankAmountMinor: Number(counts?.unclassified_amount ?? 0),
    suppliersMissingStatement: missingStatements,
    suppliersWithoutContract: noContract,
    invoicesWithoutLines: Number(counts?.no_lines ?? 0),
    priceRises,
    // الأثر السنوي يحتاج دورة الطلب؛ يُقدَّر هنا بفارق السعر × عشرين طلباً
    priceRiseAnnualMinor: priceRises.reduce((s, r) => s + (r.amountMinor ?? 0) * 20, 0),
  };
}
