import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { formatRiyalsDisplay } from "../src/lib/money";

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
  console.log("فواتير غير مسدَّدة:", summary.unpaid, "·", formatRiyalsDisplay(Number(summary.unpaid_amount)), "ريال\n");

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
    /* الجمع على الفواتير المميّزة لا على المبالغ المميّزة: ثلاث فواتير بيكوف ١٥٠ = ٤٥٠ لا ١٥٠ */
    , hit as (
      select distinct o.id, o.outstanding
      from open_inv o
      join bank_transactions t
        on t.direction = 'DEBIT'
       and t.matched_payment_id is null
       and abs(t.amount_minor - o.outstanding) <= 100
       and abs(extract(epoch from (t.value_date - o.invoice_date)) / 86400) <= 45
       and (t.supplier_id = o.supplier_id or (t.supplier_id is null and t.category = 'SUPPLIER'))
    )
    select count(*)::int as n, coalesce(sum(outstanding),0)::bigint as amount
    from hit
  `)).rows[0];
  console.log("منها لها حركة بنكية بنفس المبلغ في نافذة ٤٥ يوماً:",
    withCandidate.n, "·", formatRiyalsDisplay(Number(withCandidate.amount)), "ريال");

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
    select o.supplier, o.invoice_number, o.outstanding as amt,
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
     /* المبلغ وحده لا يكفي: حوالةُ شركة فلاتر المياه كانت «مرشّحةً» لفواتير بيكوف */
     and (t.supplier_id = o.supplier_id or (t.supplier_id is null and t.category = 'SUPPLIER'))
    order by o.outstanding desc limit 12
  `)).rows;
  console.log("\n=== أمثلة: فاتورة مفتوحة وحركة تطابق مبلغها ===");
  for (const r of why) {
    console.log(`${formatRiyalsDisplay(Number(r.amt)).padStart(10)} · ${String(r.supplier).slice(0,18).padEnd(18)} فاتورة ${r.invoice_number} (${r.inv_date})`);
    console.log(`           الحركة ${r.tx_date} · تصنيفها ${r.cat} · مورّدها ${r.tx_supplier === '—' ? 'غير معروف' : 'معروف'} · ${r.who}`);
  }
  process.exit(0);
}
main();
