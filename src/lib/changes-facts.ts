/** وقائع «ما الذي تغيّر» — الاستعلام وحده. الحساب في `changes.ts`. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ChangeFacts } from "./changes";

interface Row extends Record<string, unknown> {
  this_month: string | null;
  prev_month: string | null;
  purchases_this: number;
  purchases_prev: number;
  docs_7: number;
  docs_prev_7: number;
  outstanding_now: number;
  outstanding_then: number;
  new_unclassified: number;
}

export async function gatherChangeFacts(
  risingItems: number,
  risingAnnualMinor: number,
): Promise<ChangeFacts> {
  const [r] = (
    await db.execute<Row>(sql`
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
        (select coalesce(sum(total_minor),0)::bigint from invoices
          where period_month = (select m from prv))                               as purchases_prev,
        (select count(*)::int from documents
          where created_at >= now() - interval '7 days')                         as docs_7,
        (select count(*)::int from documents
          where created_at >= now() - interval '14 days'
            and created_at <  now() - interval '7 days')                         as docs_prev_7,
        (select coalesce(sum(greatest(0, i.total_minor - coalesce((
            select sum(pa.amount_minor)::int from payment_allocations pa
            where pa.invoice_id = i.id), 0))), 0)::bigint from invoices i)        as outstanding_now,
        /*
          ما كان مستحقّاً قبل ثلاثين يوماً: فواتير كانت قد صدرت حينها،
          مطروحاً منها ما سُدّد لها. تقديرٌ معلَن، إذ لا سجلّ تاريخيّ
          للرصيد — والتقدير المعلَن خير من رقمٍ لا أساس له.
        */
        (select coalesce(sum(greatest(0, i.total_minor - coalesce((
            select sum(pa.amount_minor)::int from payment_allocations pa
            where pa.invoice_id = i.id), 0))), 0)::bigint from invoices i
          where i.invoice_date < now() - interval '30 days')                      as outstanding_then,
        (select count(*)::int from bank_transactions where category = 'UNKNOWN')  as new_unclassified
    `)
  ).rows;

  return {
    purchasesThisMonth: Number(r?.purchases_this ?? 0),
    purchasesPrevMonth: Number(r?.purchases_prev ?? 0),
    thisMonthLabel: r?.this_month ?? "هذا الشهر",
    prevMonthLabel: r?.prev_month ?? "الشهر السابق",
    documentsLast7: Number(r?.docs_7 ?? 0),
    documentsPrev7: Number(r?.docs_prev_7 ?? 0),
    outstandingNow: Number(r?.outstanding_now ?? 0),
    outstandingThen: Number(r?.outstanding_then ?? 0),
    risingItems,
    risingAnnualMinor,
    newUnclassified: Number(r?.new_unclassified ?? 0),
  };
}
