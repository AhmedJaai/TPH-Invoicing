/** وقائع «ما الذي تغيّر» — الاستعلام وحده. الحساب في `changes.ts`. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ChangeFacts } from "./changes";
import { SETTLED_TOLERANCE_MINOR } from "./supplier-balances";
import { loadBalanceTotals } from "@/services/supplier-balance.service";

interface Row extends Record<string, unknown> {
  this_month: string | null;
  prev_month: string | null;
  purchases_this: number;
  purchases_prev: number;
  docs_7: number;
  docs_prev_7: number;
  outstanding_then: number;
  new_unclassified: number;
  days_elapsed: number | null;
}

export async function gatherChangeFacts(
  risingItems: number,
  risingAnnualMinor: number,
): Promise<ChangeFacts> {
  const [{ totals }, rows, spend] = await Promise.all([
    loadBalanceTotals(),
    db.execute<Row>(sql`
      with months as (
        select period_month as m
        from invoices
        group by period_month
        order by period_month desc
        limit 2
      ),
      cur as (select max(m) as m from months),
      prv as (select min(m) as m from months where m <> (select max(m) from months))
      select
        (select m from cur)                                                       as this_month,
        (select m from prv)                                                       as prev_month,
        (select coalesce(sum(total_minor),0)::bigint from invoices
          where period_month = (select m from cur))                               as purchases_this,
        /*
          الشهر السابق يُقصّ عند اليوم نفسه إن كان الجاري لم يتمّ.

          كان يُجمَع كاملاً ويُقارَن بستّة أيّامٍ من الجاري، فيُقال في
          السادس من كل شهر «أنفقتَ أقلّ بـ٩٨٪» — والنقص يومٌ لا سلوك.
          والقصّ يجعل المقارنة مثلاً بمثل، ويُعلَن في نصّ الأساس.
        */
        (select coalesce(sum(total_minor),0)::bigint from invoices
          where period_month = (select m from prv)
            and (
              (select m from cur) <> to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM')
              or extract(day from invoice_date) <= extract(day from now() at time zone 'Asia/Riyadh')
            ))                                                                    as purchases_prev,
        /* يومُ الشهر بتوقيت الرياض — كما في بطاقة المشتريات، فلا يقول أحدهما ١٣ والآخر ١٤ */
        (select case when (select m from cur) = to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM')
                     then extract(day from now() at time zone 'Asia/Riyadh')::int end)                       as days_elapsed,
        /*
          «وصل» يعني مستنداً جديداً — لا ملفّاً قديماً رُفع من الأرشيف.
          كان أسبوعُ رفعِ أرشيف مايو–أغسطس (١٥٨ ملفّاً) أساساً للمقارنة، فقالت
          الصفحة «▼ ٨٩٪» عن أسبوعٍ عاديّ. فيُعدّ ما شهرُه في آخر خمسةٍ وأربعين يوماً.
        */
        (select count(*)::int from documents
          where created_at >= now() - interval '7 days'
            and (period_month is null or period_month >= to_char((now() at time zone 'Asia/Riyadh') - interval '45 days', 'YYYY-MM'))) as docs_7,
        (select count(*)::int from documents
          where created_at >= now() - interval '14 days'
            and created_at <  now() - interval '7 days'
            and (period_month is null or period_month >= to_char((now() at time zone 'Asia/Riyadh') - interval '52 days', 'YYYY-MM'))) as docs_prev_7,
        /*
          ما كان «عليك» قبل ثلاثين يوماً — بالمعادلة نفسها التي تحسب «عليك» الآن
          (supplier-balance.service.ts): مورّداً مورّداً، فواتيره المفتوحة يومها
          ناقصاً رصيدَنا عنده يومها. ولا يُطرح من رصيد ذلك اليوم إلّا ما دُفع قبله:
          كان يُطرح كلُّ ما خُصّص حتى اليوم، فقالت الصفحة «▲ 281٪ تراكم أكثر ممّا
          سدَّدتَ» والدَّين نزل ٥٤٪. وهو تقديرٌ من التواريخ لا سجلٌّ تاريخيّ للرصيد.
        */
        (with t as (select now() - interval '30 days' as at),
          inv as (
            select i.supplier_id,
                   sum(case when i.total_minor - coalesce(a.s, 0) > ${SETTLED_TOLERANCE_MINOR}
                            then i.total_minor - coalesce(a.s, 0) else 0 end) as open_minor
              from invoices i
              left join lateral (
                select sum(pa.amount_minor) as s
                  from payment_allocations pa join payments p on p.id = pa.payment_id
                 where pa.invoice_id = i.id and p.paid_at < (select at from t)
                   and p.status not in ('REVERSED', 'VOID')) a on true
             where i.supplier_id is not null and i.invoice_date < (select at from t)
             group by i.supplier_id),
          pay as (
            select p.supplier_id,
                   sum(greatest(0, p.amount_minor - p.fee_minor - coalesce(b.s, 0))) as credit
              from payments p
              left join lateral (
                select sum(pa.amount_minor) as s
                  from payment_allocations pa join invoices i on i.id = pa.invoice_id
                 where pa.payment_id = p.id and i.invoice_date < (select at from t)) b on true
             where p.supplier_id is not null and p.paid_at < (select at from t)
               and p.status not in ('REVERSED', 'VOID')
             group by p.supplier_id)
          select coalesce(sum(greatest(0, coalesce(inv.open_minor, 0) - coalesce(pay.credit, 0))), 0)::bigint
            from (select supplier_id from inv union select supplier_id from pay) su
            left join inv using (supplier_id)
            left join pay using (supplier_id))                                     as outstanding_then,
        (select count(*)::int from bank_transactions where category = 'UNKNOWN')  as new_unclassified
    `),
    /*
      مشترياتُ كلّ مورّدٍ بتاريخ فاتورته: آخرُ ثلاثين يوماً، والتسعون قبلها،
      وفي كم شهرٍ منها اشترينا منه. نوافذُ متدحرجة لا أشهرٌ تقويميّة — فلا
      يُقارَن أوّلُ الشهر بشهرٍ تامّ.
    */
    db.execute<{ slug: string; name: string; last30: number; prev90: number; months: number }>(sql`
      select s.slug, s.name_ar as name,
             coalesce(sum(i.total_minor) filter (where i.invoice_date >= now() - interval '30 days'), 0)::bigint as last30,
             coalesce(sum(i.total_minor) filter (where i.invoice_date < now() - interval '30 days'), 0)::bigint as prev90,
             count(distinct to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM'))
               filter (where i.invoice_date < now() - interval '30 days')::int as months
        from invoices i
        join suppliers s on s.id = i.supplier_id
       where i.invoice_date >= now() - interval '120 days'
       group by s.slug, s.name_ar
    `),
  ]);
  const [r] = rows.rows;

  return {
    purchasesThisMonth: Number(r?.purchases_this ?? 0),
    purchasesPrevMonth: Number(r?.purchases_prev ?? 0),
    thisMonthLabel: r?.this_month ?? "هذا الشهر",
    prevMonthLabel: r?.prev_month ?? "الشهر السابق",
    daysElapsedInMonth: r?.days_elapsed == null ? null : Number(r.days_elapsed),
    documentsLast7: Number(r?.docs_7 ?? 0),
    documentsPrev7: Number(r?.docs_prev_7 ?? 0),
    /* «عليك» الآن من المصدر الواحد — الرقم نفسه الذي في بطاقة الصفحة الأولى */
    outstandingNow: totals.owedMinor,
    outstandingThen: Number(r?.outstanding_then ?? 0),
    risingItems,
    risingAnnualMinor,
    newUnclassified: Number(r?.new_unclassified ?? 0),
    spend: spend.rows.map((x) => ({
      slug: x.slug,
      name: x.name,
      last30Minor: Number(x.last30),
      prev90Minor: Number(x.prev90),
      activeMonths: Number(x.months),
    })),
  };
}
