/**
 * الفاقدُ عبر الجرود المقفلة — من أسطرها المجمَّدة (`inventory_count_lines`) لا إعادةَ حساب.
 * الحكمُ والتجميعُ في `lib/inventory/waste-trend.ts`؛ وهنا القراءةُ وحدها.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildProductTrends, type ProductTrend, type TrendLine } from "@/lib/inventory/waste-trend";
import { isStoredUnit } from "@/lib/unit-conversion";
import type { Conn } from "./types";

/** أسطرُ الجرود المقفلة منذ `since` (يوم نهاية الأسبوع) — فيها الصنفُ في نطاق الجرد وحده. */
export async function loadTrendLines(since: string, productId: string | null = null, conn: Conn = db): Promise<TrendLine[]> {
  const rows = await conn.execute<{
    product_id: string; name_ar: string; category: string; base_unit: string; count_id: string; period_end: string;
    variance_milli: string | null; variance_consumption_bp: number | null; variance_cost_minor: string | null; recorded_waste_milli: string | null; readiness: string | null;
  }>(sql`
    select l.product_id, p.name_ar, p.category::text as category, l.base_unit, c.id as count_id, c.period_end,
           l.variance_milli, l.variance_consumption_bp, l.variance_cost_minor, l.recorded_waste_milli, c.readiness::text as readiness
      from inventory_count_lines l
      join inventory_counts c on c.id = l.count_id and c.status = 'FINALISED'
      join products p on p.id = l.product_id
     where l.in_scope is not false and c.period_end >= ${since}
       ${productId ? sql`and l.product_id = ${productId}` : sql``}
     order by p.name_ar, c.period_end
  `);
  return rows.rows.map((r) => ({
    productId: r.product_id, productName: r.name_ar, category: r.category, baseUnit: isStoredUnit(r.base_unit) ? r.base_unit : "PIECE",
    countId: r.count_id, periodEnd: r.period_end,
    varianceMilli: r.variance_milli === null ? null : Number(r.variance_milli),
    varianceConsumptionBp: r.variance_consumption_bp === null ? null : Number(r.variance_consumption_bp),
    varianceCostMinor: r.variance_cost_minor === null ? null : Number(r.variance_cost_minor),
    recordedWasteMilli: Number(r.recorded_waste_milli ?? 0),
    partial: r.readiness !== null && r.readiness !== "READY",
  }));
}

export async function loadProductTrends(since: string, conn: Conn = db): Promise<ProductTrend[]> {
  return buildProductTrends(await loadTrendLines(since, null, conn));
}
