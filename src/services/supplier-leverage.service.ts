/**
 * رقما التفاوض من القاعدة (`lib/supplier-leverage.ts`) — لآخر اثني عشر شهراً:
 * الفواتيرُ المسدَّدة بتخصيصٍ من دفعةٍ معروفة التاريخ (القاعدةُ نفسُها في ملفّ المورّد)،
 * ومشترياتُ كلّ مورّدٍ من فواتيره.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { concentration, weightedDaysToPay, type Concentration, type DaysToPay } from "@/lib/supplier-leverage";

export const LEVERAGE_MONTHS = 12;

export async function loadSupplierLeverage(): Promise<{ pay: DaysToPay; spend: Concentration | null }> {
  const [paid, spend] = await Promise.all([
    db.execute<{ days: number; amount: string }>(sql`
      with alloc as (
        select pa.invoice_id, sum(pa.amount_minor)::bigint as s, max(p.paid_at) as last_paid
          from payment_allocations pa
          join payments p on p.id = pa.payment_id
         where p.status not in ('REVERSED','VOID')
         group by pa.invoice_id
      )
      select ((a.last_paid at time zone 'Asia/Riyadh')::date - (i.invoice_date at time zone 'Asia/Riyadh')::date)::int as days,
             i.total_minor::bigint as amount
        from invoices i
        join alloc a on a.invoice_id = i.id
       where i.total_minor - a.s <= ${SETTLED_TOLERANCE_MINOR}
         and i.invoice_date >= now() - (${LEVERAGE_MONTHS} || ' months')::interval
    `),
    db.execute<{ id: string; name: string; slug: string; total: string }>(sql`
      select s.id, s.name_ar as name, s.slug, sum(i.total_minor)::bigint as total
        from invoices i join suppliers s on s.id = i.supplier_id
       where i.invoice_date >= now() - (${LEVERAGE_MONTHS} || ' months')::interval
       group by s.id, s.name_ar, s.slug
    `),
  ]);
  return {
    pay: weightedDaysToPay(paid.rows.map((r) => ({ days: Number(r.days), amountMinor: Number(r.amount) }))),
    spend: concentration(spend.rows.map((r) => ({ supplierId: r.id, name: r.name, slug: r.slug, minor: Number(r.total) }))),
  };
}
