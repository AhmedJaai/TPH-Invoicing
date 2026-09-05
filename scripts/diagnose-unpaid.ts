import { sql } from "drizzle-orm";
import { db } from "../src/db";

async function main() {
  const summary = (await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from invoices i
        where i.total_minor > coalesce((select sum(pa.amount_minor)::int
          from payment_allocations pa where pa.invoice_id = i.id), 0) + 1)   as unpaid,
      (select coalesce(sum(i.total_minor - coalesce((select sum(pa.amount_minor)::int
          from payment_allocations pa where pa.invoice_id = i.id), 0)), 0)::bigint
        from invoices i
        where i.total_minor > coalesce((select sum(pa.amount_minor)::int
          from payment_allocations pa where pa.invoice_id = i.id), 0) + 1)   as unpaid_amount
  `)).rows[0];
  console.log("فواتير غير مسدَّدة:", summary.unpaid, "·", (Number(summary.unpaid_amount)/100).toFixed(2), "ريال\n");

  // هل توجد حركة بنكية بنفس المبلغ، أيّاً كان مستفيدها؟
  const withCandidate = (await db.execute<Record<string, number|string>>(sql`
    with open_inv as (
      select i.id, i.invoice_number, i.invoice_date, s.name_ar as supplier,
             i.total_minor - coalesce((select sum(pa.amount_minor)::int
               from payment_allocations pa where pa.invoice_id = i.id), 0) as outstanding
      from invoices i left join suppliers s on s.id = i.supplier_id
      where i.total_minor > coalesce((select sum(pa.amount_minor)::int
        from payment_allocations pa where pa.invoice_id = i.id), 0) + 1
    )
    select count(distinct o.id)::int as n,
           coalesce(sum(distinct o.outstanding),0)::bigint as amount
    from open_inv o
    join bank_transactions t
      on t.direction = 'DEBIT'
     and t.matched_payment_id is null
     and abs(t.amount_minor - o.outstanding) <= 100
     and abs(extract(epoch from (t.value_date - o.invoice_date)) / 86400) <= 45
  `)).rows[0];
  console.log("منها لها حركة بنكية بنفس المبلغ في نافذة ٤٥ يوماً:",
    withCandidate.n, "·", (Number(withCandidate.amount)/100).toFixed(2), "ريال");

  // ولماذا لم تُطابَق؟
  const why = (await db.execute<Record<string, string|number>>(sql`
    with open_inv as (
      select i.id, i.invoice_number, i.supplier_id, s.name_ar as supplier, i.invoice_date,
             i.total_minor - coalesce((select sum(pa.amount_minor)::int
               from payment_allocations pa where pa.invoice_id = i.id), 0) as outstanding
      from invoices i left join suppliers s on s.id = i.supplier_id
      where i.total_minor > coalesce((select sum(pa.amount_minor)::int
        from payment_allocations pa where pa.invoice_id = i.id), 0) + 1
    )
    select o.supplier, o.invoice_number, (o.outstanding/100.0)::text as amt,
           to_char(o.invoice_date,'YYYY-MM-DD') as inv_date,
           to_char(t.value_date,'YYYY-MM-DD') as tx_date,
           coalesce(t.supplier_id,'—') as tx_supplier,
           t.category::text as cat,
           left(coalesce(t.beneficiary_raw, t.description,''), 44) as who
    from open_inv o
    join bank_transactions t
      on t.direction = 'DEBIT' and t.matched_payment_id is null
     and abs(t.amount_minor - o.outstanding) <= 100
     and abs(extract(epoch from (t.value_date - o.invoice_date)) / 86400) <= 45
    order by o.outstanding desc limit 12
  `)).rows;
  console.log("\n=== أمثلة: فاتورة مفتوحة وحركة تطابق مبلغها ===");
  for (const r of why) {
    console.log(`${String(r.amt).padStart(10)} · ${String(r.supplier).slice(0,18).padEnd(18)} فاتورة ${r.invoice_number} (${r.inv_date})`);
    console.log(`           الحركة ${r.tx_date} · تصنيفها ${r.cat} · مورّدها ${r.tx_supplier === '—' ? 'غير معروف' : 'معروف'} · ${r.who}`);
  }
  process.exit(0);
}
main();
