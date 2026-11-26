/**
 * قائمةُ الطلب — تقديرُ الكفاية من `loadStockBalance` (لا معادلةَ ثانية)، وآخرُ بند
 * فاتورةٍ لكلّ صنفٍ يقول مَن يبيعه وبعبوةٍ كم وبكم. قراءةٌ فقط: لا يُكتب شيء.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildOrderList, lastPurchaseFromLine, type LastPurchase, type OrderOptions, type SupplierOrder } from "@/lib/inventory/order-list";
import type { StoredUnit } from "@/lib/unit-conversion";
import { loadStockBalance } from "./stock-balance.service";
import type { Conn } from "./types";

export interface OrderListView {
  /** يومُ آخر جرد — `null` لم يُعدّ الرفّ بعد، فلا يُعرف ما عليه. */
  countDay: string | null;
  groups: SupplierOrder[];
  /** أصنافٌ عُدّت ولها صرف — ما يُقاس عليه «ينفد». */
  measured: number;
}

/** آخرُ بند فاتورةٍ مربوطٍ بكلّ صنف — بتاريخ الدخول، والأحدثُ إدخالاً عند التساوي. */
export async function loadLastPurchases(baseUnitOf: ReadonlyMap<string, StoredUnit>, conn: Conn = db): Promise<Map<string, LastPurchase>> {
  const ids = [...baseUnitOf.keys()];
  if (ids.length === 0) return new Map();
  const rows = await conn.execute<{
    product_id: string; supplier_id: string; supplier_name: string; supplier_slug: string; phone: string | null;
    description: string; day: string; qty: string | null; line_total_minor: string;
    pack_size: string | null; content_unit: StoredUnit | null; content_quantity: string | null;
  }>(sql`
    select distinct on (sp.product_id)
           sp.product_id, su.id as supplier_id, su.name_ar as supplier_name, su.slug as supplier_slug,
           su.phone_e164 as phone, il.description,
           coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')) as day,
           il.qty::text as qty, il.line_total_minor::text as line_total_minor,
           sp.pack_size::text as pack_size, sp.content_unit::text as content_unit, sp.content_quantity::text as content_quantity
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
      join suppliers su on su.id = i.supplier_id
      join supplier_products sp on sp.id = il.supplier_product_id
     where sp.product_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
       /* المرتجعُ والبندُ بلا مبلغ ليسا «آخر شراء» */
       and il.line_total_minor > 0
       and (il.qty is null or il.qty > 0)
     order by sp.product_id,
              coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')) desc,
              i.created_at desc, il.id
  `);
  const out = new Map<string, LastPurchase>();
  for (const r of rows.rows) {
    const unit = baseUnitOf.get(r.product_id);
    if (!unit) continue;
    out.set(r.product_id, lastPurchaseFromLine({
      productId: r.product_id, supplierId: r.supplier_id, supplierName: r.supplier_name, supplierSlug: r.supplier_slug,
      phoneE164: r.phone, description: r.description, day: r.day, qty: r.qty, lineTotalMinor: Number(r.line_total_minor),
      packSize: r.pack_size, contentUnit: r.content_unit, contentQuantity: r.content_quantity,
    }, unit));
  }
  return out;
}

export async function loadOrderList(opts: OrderOptions = {}, conn: Conn = db): Promise<OrderListView> {
  const balance = await loadStockBalance(null, {}, conn);
  const last = await loadLastPurchases(new Map(balance.items.map((x) => [x.productId, x.baseUnit] as const)), conn);
  return {
    countDay: balance.countDay,
    groups: buildOrderList(balance.items, last, opts),
    measured: balance.items.filter((x) => x.cover !== null && x.cover.daysLeft !== null).length,
  };
}
