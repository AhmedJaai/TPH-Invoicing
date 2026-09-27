/**
 * ما تغيّر تحت جردٍ مقفَل بعد إقفاله.
 *
 * التقريرُ المقفَل يُقرأ من أسطره ولا يُعاد حسابُه — وذلك صحيح: هو ما كان يومَ
 * أُقفل. لكنّ ما يصل بعده يغيّر ما كان يجب أن يكون: ملفُّ مبيعاتٍ لأيّامه،
 * فاتورةُ شراءٍ متأخّرة، صنفُ مورّدٍ رُبط، نسخةُ وصفةٍ تسري فيه. وكان يبقى على
 * أرقامه صامتاً. فيُقال ما تغيّر، والعلاجُ إعادةُ الفتح (يُعاد الحسابُ ويُحفظ
 * الأثر). والهدرُ والحركاتُ والاستلامُ لا تُكتب فيه أصلاً (041 · 050).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CountHeader } from "./inventory.service";
import type { Conn } from "./types";

export interface StaleReason {
  label: string;
  count: number;
}

export async function changesSinceFinalise(header: CountHeader, conn: Conn = db): Promise<StaleReason[]> {
  if (header.status !== "FINALISED" || !header.finalisedAt) return [];
  const f = header.finalisedAt;
  const [r] = (await conn.execute<{ sales: number; invoices: number; linked: number; recipes: number }>(sql`
    select
      (select count(*)::int from sales_imports si
        where si.created_at > ${f} and si.status <> 'FAILED'
          and si.period_start <= ${header.periodEnd} and si.period_end >= ${header.periodStart}) as sales,
      (select count(distinct i.id)::int from invoices i
        join invoice_lines il on il.invoice_id = i.id
        join supplier_products sp on sp.id = il.supplier_product_id and sp.product_id is not null
        where i.created_at > ${f}
          and coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD'))
              between ${header.periodStart} and ${header.periodEnd}) as invoices,
      (select count(distinct sp.id)::int from supplier_products sp
        join invoice_lines il on il.supplier_product_id = sp.id
        join invoices i on i.id = il.invoice_id
        where sp.confirmed_at > ${f} and sp.product_id is not null
          and coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD'))
              between ${header.periodStart} and ${header.periodEnd}) as linked,
      (select count(*)::int from recipe_versions rv
        where coalesce(rv.activated_at, rv.created_at) > ${f} and rv.status = 'ACTIVE'
          and rv.effective_from <= ${header.periodEnd}) as recipes
  `)).rows;
  const out: StaleReason[] = [];
  if (r.sales > 0) out.push({ label: "ملفُّ مبيعاتٍ لأيّامه استُورد بعد الإقفال", count: r.sales });
  if (r.invoices > 0) out.push({ label: "فاتورةُ شراءٍ لأسبوعه قُيّدت بعد الإقفال", count: r.invoices });
  if (r.linked > 0) out.push({ label: "صنفُ مورّدٍ من فواتيره رُبط بصنف جردٍ بعد الإقفال", count: r.linked });
  if (r.recipes > 0) out.push({ label: "نسخةُ وصفةٍ تسري فيه فُعّلت بعد الإقفال", count: r.recipes });
  return out;
}
