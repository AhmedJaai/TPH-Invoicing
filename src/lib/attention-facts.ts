/**
 * جمع حقائق «ما يحتاج انتباهك» من القاعدة.
 * الحساب في attention.ts دالة خالصة؛ وهذه تجلب أرقامها.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { formatRiyalsDisplay } from "./money";
import type { AttentionEvidence, AttentionFacts } from "./attention";
import { previousMonth } from "./filing";
import { currentMonthRiyadh } from "./riyadh-time";
import { analyzeCoverage } from "./bank/coverage";
import { checkBalance } from "./bank/balance-equation";
import { findDuplicateExpenses, type Expense } from "./expenses";
import { findDoublePaid, partitionDoublePaid, recoverableMinor, type DoublePaidGroup, type DoublePaidTx } from "./bank/double-paid";
import { detectAnomalies } from "./bank/lifecycle";
import { loadOverdueBalances } from "@/services/supplier-balance.service";
import { DAY, TIME, countNoun } from "./arabic";
import { loadMissingStatementSuppliers, loadUnbackedPayments } from "@/services/supplier-followups.service";

interface Row {
  [key: string]: unknown;
}

export async function gatherAttentionFacts(): Promise<AttentionFacts> {
  const lastMonth = previousMonth(currentMonthRiyadh());

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
           where not exists (select 1 from invoice_lines l where l.invoice_id=i.id))       as no_lines
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

  /*
    المتأخّر بالمورّد لا بالفاتورة — والمصدر الذي يقول «عليك» في كلّ شاشة.
    كان يُجمع ما بقي على الفواتير القديمة بلا خصم رصيدنا عند المورّد ولا
    عتبة الهللة، فيقول «مستحقّ عليك» عن مالٍ دفعناه.
  */
  const overdue = await loadOverdueBalances(db, 60);
  const overdueMinor = overdue.reduce((s, r) => s + r.owedMinor, 0);
  const overdueSuppliers = overdue.slice(0, 10).map<AttentionEvidence>((r) => ({
    label: r.nameAr,
    sub: r.creditMinor > 0 && r.owedMinor < r.overdueOpenMinor
      ? `أقدم دين منذ ${r.oldestDays} يوماً · بعد خصم ما لك عنده ${formatRiyalsDisplay(r.creditMinor)}`
      : `أقدم دين منذ ${r.oldestDays} يوماً`,
    amountMinor: r.owedMinor,
  }));

  // مورّدون لهم فواتير ولم يصل كشفهم عن الشهر المنقضي — المصدر نفسه الذي تقرؤه /statements?missing=1
  const missingStatementRows = await loadMissingStatementSuppliers(lastMonth);
  const missingStatements = missingStatementRows.slice(0, 8).map((r) => r.nameAr);

  const noContractRows = (
    await db.execute<Row>(sql`
      select s.name_ar,
             (select coalesce(sum(greatest(0, p.amount_minor - p.fee_minor
                - coalesce((select sum(a.amount_minor)::int from payment_allocations a
                             where a.payment_id = p.id), 0))), 0)::bigint
                from payments p
               where p.supplier_id = s.id and p.status not in ('REVERSED','VOID')) as unbacked
      from suppliers s
      where s.is_active and not s.issues_invoices and not s.contract_on_file
      order by unbacked desc
    `)
  ).rows;
  const noContract = noContractRows.map((r) => String(r.name_ar));

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
    sub: `${r.name_ar ?? "—"} · ${formatRiyalsDisplay(Number(r.then_price))} ← ${formatRiyalsDisplay(Number(r.now_price))}`,
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
    sub: `${countNoun(g.days, DAY)} بلا كشف`,
  }));

  /*
    معادلة الكشف على المدى المغطّى كلِّه.
    والمجهول يبقى `null` — لا صفراً؛ فالصفر هنا يقول «الحساب مضبوط»
    وهو لا يُعلم.
  */
  const [totals] = (
    await db.execute<{ credits: number | null; debits: number | null }>(sql`
      select coalesce(sum(amount_minor) filter (where direction = 'CREDIT'), 0)::bigint as credits,
             coalesce(sum(amount_minor) filter (where direction = 'DEBIT'), 0)::bigint  as debits
      from bank_transactions
    `)
  ).rows;

  const [balances] = (
    await db.execute<{ opening: number | null; closing: number | null }>(sql`
      select sum(opening_balance_minor)::bigint as opening,
             sum(closing_balance_minor)::bigint as closing
      from reconciliation_periods
    `)
  ).rows;

  const balance = checkBalance({
    openingMinor: balances?.opening == null ? null : Number(balances.opening),
    closingMinor: balances?.closing == null ? null : Number(balances.closing),
    creditsMinor: Number(totals?.credits ?? 0),
    debitsMinor: Number(totals?.debits ?? 0),
  });

  /*
    السدادُ المزدوج — مالٌ خرج مرّتين في اليوم نفسه لجهةٍ واحدة.

    ويُقرأ من الحركات كلِّها لا من كشفٍ يُستورَد الآن: كان يُحسَب لحظةَ
    الاستيراد ويُعرَض في نتيجته، فيضيع بإغلاقها. ومن يفتح النظام بعد
    شهر لا يجد له أثراً — وقد خرج المال.
  */
  const outgoing = (
    await db.execute<{
      id: string; value_date: Date; amount_minor: number; direction: string;
      description: string | null; beneficiary_raw: string | null;
      category: string; operation_ref: string | null;
    }>(sql`
      select id, value_date, amount_minor, direction::text as direction,
             description, beneficiary_raw, category::text as category, operation_ref
      from bank_transactions
      where direction = 'DEBIT'
    `)
  ).rows;

  /*
    دفعاتٌ لا فاتورةَ تفسّرها — السؤال الأسبوعيّ الذي كان يُراجَع بيد.
    والاستعلام في `supplier-followups.service` يقرؤه التنبيه والصفحة التي
    يفتحها (/suppliers?unbacked=1)، فلا يفترق العدّان (BTN-110).
  */
  const unbacked = await loadUnbackedPayments();

  const doublePaidAll = findDoublePaid(outgoing.map((r): DoublePaidTx => ({
    id: r.id,
    valueDate: new Date(r.value_date),
    amountMinor: Number(r.amount_minor),
    direction: "DEBIT",
    description: r.description,
    beneficiaryRaw: r.beneficiary_raw,
    category: r.category,
    operationRef: r.operation_ref,
  })));

  /*
    قرارُ الإنسان يُقرأ قبل العدّ (SCN-104). كان البند حرجاً دائماً لا
    يُغلَق: «استُردّ» و«ليس ازدواجاً» يُخرجانه، و«طالبتُ» يُبقيه بندٌ
    أهدأ — فالمال لم يعد بعد، ونسيانُه بعد المطالبة ضياعٌ ثانٍ.
  */
  const resolutions = (
    await db.execute<{ key: string; decision: string }>(sql`
      select key, decision from alert_resolutions where key like 'double:%'
    `)
  ).rows;
  const doublePaidSplit = partitionDoublePaid(
    doublePaidAll,
    new Map(resolutions.map((r) => [r.key, r.decision])),
  );
  const doublePaid = doublePaidSplit.open;

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

  /* ── حركاتٌ يتناقض قرارُها ومالُها — `detectAnomalies` موصولةً أخيراً ── */
  const anomalyRows = (
    await db.execute<{
      id: string; amount_minor: number; lifecycle: string; match_status: string;
      matched_payment_id: string | null; description: string | null; value_date: string;
    }>(sql`
      select id, amount_minor, lifecycle::text as lifecycle, match_status::text as match_status,
             matched_payment_id, description, to_char(value_date, 'YYYY-MM-DD') as value_date
        from bank_transactions
       where (matched_payment_id is not null
               and (match_status = 'IGNORED' or lifecycle not in ('CONFIRMED','POSTED')))
          or (lifecycle in ('CONFIRMED','POSTED') and matched_payment_id is null
               and match_status <> 'IGNORED' and category = 'SUPPLIER' and direction = 'DEBIT')
       order by amount_minor desc
       limit 50
    `)
  ).rows;
  const anomalies = anomalyRows.flatMap((r) =>
    detectAnomalies({
      classified: true,
      hasCandidate: true,
      decided: r.lifecycle === "CONFIRMED" || r.lifecycle === "POSTED",
      posted: r.matched_payment_id !== null,
      ignored: r.match_status === "IGNORED",
    }).map((a) => ({ r, a })),
  );

  return {
    lifecycleAnomalies: anomalies.map(({ r, a }) => ({
      label: (r.description ?? "حركة").slice(0, 45),
      sub: `${r.value_date} · ${a.detail}`,
      amountMinor: Number(r.amount_minor),
    })),
    lifecycleAnomalyMinor: anomalies.reduce((s, { r }) => s + Number(r.amount_minor), 0),
    firstAnomalyTransactionId: anomalies[0]?.r.id ?? null,
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
    /*
      كان هنا صفرٌ مكتوبٌ بيد، وتعليقٌ يحيل إلى صفحة البنك — وصفحةُ
      البنك لا تحسبه أيضاً. فالبندُ لم يظهر مرّةً واحدة، والشاشةُ تقول
      ضمناً «لا سداد مزدوج» وهي دعوى لم تُفحَص. **والصفرُ المكتوب أسوأ
      من الفراغ**، لأنّه يُقرأ جواباً.
    */
    duplicatePayments: doublePaid.length,
    duplicatePaymentAmountMinor: recoverableMinor(doublePaid),
    duplicatePaymentEvidence: doublePaid.slice(0, 6).map(doublePaidEvidence),
    duplicatePaymentsClaimed: doublePaidSplit.claimed.length,
    duplicatePaymentClaimedMinor: recoverableMinor(doublePaidSplit.claimed),
    duplicatePaymentClaimedEvidence: doublePaidSplit.claimed.slice(0, 6).map(doublePaidEvidence),
    notTaxValidCount: Number(counts?.not_valid ?? 0),
    vatAtRiskMinor: Number(counts?.vat_at_risk ?? 0),
    vatAtRiskEvidence: vatEvidence,
    unknownTaxCount: Number(counts?.unknown_tax ?? 0),
    unknownTaxEvidence: unknownEvidence,
    overdueMinor,
    overdueSuppliers,
    unclassifiedBankTx: Number(counts?.unclassified ?? 0),
    unclassifiedBankAmountMinor: Number(counts?.unclassified_amount ?? 0),
    suppliersMissingStatement: missingStatements,
    suppliersMissingStatementCount: missingStatementRows.length,
    suppliersWithoutContract: noContract,
    suppliersWithoutContractEvidence: noContractRows.map((r) => ({
      label: String(r.name_ar),
      sub: Number(r.unbacked) > 0 ? "دفعتَ له بلا فاتورة — والعقد هو مستندُه" : "لا دفعات بلا مستند",
      amountMinor: Number(r.unbacked) > 0 ? Number(r.unbacked) : undefined,
    })),
    invoicesWithoutLines: Number(counts?.no_lines ?? 0),
    unbackedPaymentCount: unbacked.length,
    unbackedPaymentMinor: unbacked.reduce((n, r) => n + r.unbackedMinor, 0),
    unbackedPaymentEvidence: unbacked.slice(0, 6).map((r) => ({
      label: r.supplierName ?? "بلا مورّد",
      sub: `${r.paidOn} · من أصل ${formatRiyalsDisplay(r.amountMinor)}`,
      amountMinor: r.unbackedMinor,
    })),
    priceRises,
    // الأثر السنوي يحتاج دورة الطلب؛ يُقدَّر هنا بفارق السعر × عشرين طلباً
    priceRiseAnnualMinor: priceRises.reduce((s, r) => s + (r.amountMinor ?? 0) * 20, 0),
  };
}

function doublePaidEvidence(g: DoublePaidGroup): AttentionEvidence {
  return {
    label: g.payee,
    sub: `${g.day} · ${countNoun(g.transactions.length, TIME)}`
      + (g.distinctOperations ? " · بمراجعِ سدادٍ مختلفة" : " · بلا مرجعٍ يفصلهما"),
    amountMinor: g.excessMinor,
  };
}
