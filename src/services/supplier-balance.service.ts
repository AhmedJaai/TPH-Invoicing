/**
 * أرصدة المورّدين من القاعدة — مصدرٌ واحد لكلّ شاشةٍ تقول «عليك».
 *
 * الحساب في `src/lib/supplier-balances.ts` دالّةً خالصة؛ وهذا يجمع
 * أرقامها باستعلامٍ واحد لكلّ المورّدين (أو لمورّدٍ بعينه).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  SETTLED_TOLERANCE_MINOR,
  supplierBalance,
  totalBalances,
  type BalanceTotals,
  type SupplierBalance,
} from "@/lib/supplier-balances";
import type { Tx } from "./types";

type Executor = typeof db | Tx;

interface Row {
  supplier_id: string;
  billed: string | number;
  open_minor: string | number;
  open_count: string | number;
  paid_net: string | number;
  credit: string | number;
  [key: string]: unknown;
}

export async function loadSupplierBalances(
  executor: Executor = db,
  supplierId?: string,
): Promise<SupplierBalance[]> {
  const rows = (
    await executor.execute<Row>(sql`
      with alloc_by_invoice as (
        select invoice_id, sum(amount_minor)::bigint as s from payment_allocations group by invoice_id
      ),
      alloc_by_payment as (
        select payment_id, sum(amount_minor)::bigint as s from payment_allocations group by payment_id
      ),
      inv as (
        select i.supplier_id,
               sum(i.total_minor)::bigint as billed,
               sum(case when i.total_minor - coalesce(a.s, 0) > ${SETTLED_TOLERANCE_MINOR}
                        then i.total_minor - coalesce(a.s, 0) else 0 end)::bigint as open_minor,
               count(*) filter (where i.total_minor - coalesce(a.s, 0) > ${SETTLED_TOLERANCE_MINOR})::int as open_count
          from invoices i
          left join alloc_by_invoice a on a.invoice_id = i.id
         where i.supplier_id is not null
         group by i.supplier_id
      ),
      pay as (
        select p.supplier_id,
               sum(p.amount_minor - p.fee_minor)::bigint as paid_net,
               sum(greatest(0, p.amount_minor - p.fee_minor - coalesce(b.s, 0)))::bigint as credit
          from payments p
          left join alloc_by_payment b on b.payment_id = p.id
         where p.supplier_id is not null and p.status not in ('REVERSED', 'VOID')
         group by p.supplier_id
      )
      select s.id as supplier_id,
             coalesce(inv.billed, 0)     as billed,
             coalesce(inv.open_minor, 0) as open_minor,
             coalesce(inv.open_count, 0) as open_count,
             coalesce(pay.paid_net, 0)   as paid_net,
             coalesce(pay.credit, 0)     as credit
        from suppliers s
        left join inv on inv.supplier_id = s.id
        left join pay on pay.supplier_id = s.id
       where (inv.supplier_id is not null or pay.supplier_id is not null)
         ${supplierId ? sql`and s.id = ${supplierId}` : sql``}
    `)
  ).rows;

  return rows.map((r) =>
    supplierBalance({
      supplierId: r.supplier_id,
      billedMinor: Number(r.billed),
      openMinor: Number(r.open_minor),
      openCount: Number(r.open_count),
      paidNetMinor: Number(r.paid_net),
      creditMinor: Number(r.credit),
    }),
  );
}

export async function loadBalanceTotals(executor: Executor = db): Promise<{
  rows: SupplierBalance[];
  totals: BalanceTotals;
}> {
  const rows = await loadSupplierBalances(executor);
  return { rows, totals: totalBalances(rows) };
}
