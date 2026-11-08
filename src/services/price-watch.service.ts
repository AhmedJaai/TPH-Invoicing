/**
 * بنودُ الفواتير كما يقرؤها `lib/price-watch.ts` — استعلامٌ واحد لكلّ شاشةٍ تسأل عن السعر:
 * «يحتاج قرارك»، و«الأصناف والأسعار»، وصفحةُ المورّد، وبطاقةُ المراجعة.
 * قراءةٌ وحدها، ويومُ الفاتورة بتوقيت الرياض.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { decimalToMilli } from "@/lib/inventory/units";
import type { PriceLine } from "@/lib/price-watch";
import type { Conn } from "./types";

export async function loadPriceLines(opts: { supplierId?: string; sinceDays?: number } = {}, conn: Conn = db): Promise<PriceLine[]> {
  const rows = await conn.execute<{
    supplier_id: string; normalized: string; description: string; invoice_id: string; invoice_number: string;
    day: string; unit: number; qty: string | null; total: number; basis: string | null;
  }>(sql`
    select l.supplier_id, l.normalized_description as normalized, l.description, l.invoice_id,
           i.invoice_number, ((l.invoice_date at time zone 'Asia/Riyadh')::date)::text as day,
           l.unit_price_minor as unit, l.qty::text as qty, l.line_total_minor as total, l.pricing_basis as basis
      from invoice_lines l
      join invoices i on i.id = l.invoice_id
     where l.supplier_id is not null and l.invoice_date is not null and l.normalized_description <> ''
       ${opts.supplierId ? sql`and l.supplier_id = ${opts.supplierId}` : sql``}
       ${opts.sinceDays ? sql`and l.invoice_date >= now() - make_interval(days => ${opts.sinceDays})` : sql``}
  `);
  return rows.rows.map((r) => ({
    supplierId: r.supplier_id,
    normalized: r.normalized,
    description: r.description,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    day: r.day,
    unitMinor: Number(r.unit),
    qtyMilli: decimalToMilli(r.qty),
    totalMinor: Number(r.total),
    basis: r.basis,
  }));
}
