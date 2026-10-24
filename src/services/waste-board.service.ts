/**
 * لوحةُ الهدر من القاعدة — سجلّاتُ الأسابيع الثمانية غيرُ المُبطَلة، وسعرُ الوحدة
 * لكلّ صنفٍ من آخر جردٍ حمله (`inventory_count_lines.unit_cost_milli_minor`).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildWasteBoard, WASTE_REASON_LABEL, type ReturnedIngredient, type WasteBoard, type WasteReason, type WasteRate } from "@/lib/inventory/waste-board";
import { computeConsumption } from "@/lib/inventory/consumption";
import { indexRecipeVersions } from "@/lib/inventory/recipe";
import { loadSoldTotals } from "@/services/inventory.service";
import { loadRecipeVersions } from "@/services/recipe.service";
import { isStoredUnit } from "@/lib/unit-conversion";
import { todayInRiyadh, isoDay } from "@/lib/riyadh-time";

export const WASTE_BOARD_WEEKS = 8;

function isReason(v: string): v is WasteReason {
  return Object.hasOwn(WASTE_REASON_LABEL, v);
}

export async function loadWasteBoard(): Promise<WasteBoard & { since: string }> {
  const today = todayInRiyadh();
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - WASTE_BOARD_WEEKS * 7);
  const since = isoDay(d);

  const [records, rateRows, sold, versions] = await Promise.all([
    db.execute<{ product_id: string; name: string; reason: string; quantity_milli: string; unit: string }>(sql`
      select w.product_id, p.name_ar as name, w.reason::text as reason, w.quantity_milli, w.unit::text as unit
        from waste_records w join products p on p.id = w.product_id
       where w.voided_at is null and w.occurred_on >= ${since}
    `),
    db.execute<{ product_id: string; rate: string | null; base_unit: string }>(sql`
      select distinct on (l.product_id) l.product_id, l.unit_cost_milli_minor as rate, l.base_unit::text as base_unit
        from inventory_count_lines l join inventory_counts c on c.id = l.count_id
       where l.unit_cost_milli_minor is not null
       order by l.product_id, c.period_end desc
    `),
    loadSoldTotals(since, today),
    loadRecipeVersions(),
  ]);

  const rates = new Map<string, WasteRate>();
  for (const r of rateRows.rows) {
    if (isStoredUnit(r.base_unit)) rates.set(r.product_id, { rateMilliMinor: r.rate === null ? null : Number(r.rate), baseUnit: r.base_unit });
  }
  const entries = records.rows.flatMap((r) => (isReason(r.reason) && isStoredUnit(r.unit)
    ? [{ productId: r.product_id, productName: r.name, reason: r.reason, quantityMilli: Number(r.quantity_milli), unit: r.unit }]
    : []));
  /*
    المرتجعُ بعد التحضير يُحسَب من أسطر البيع المرتجَعة نفسِها (أحمد، ٢٤ أكتوبر ٢٠٢٦) —
    لا سطرَ يُكتب، فلا يتكرّر بإعادة المزامنة. واسمُ المكوّن من القاعدة.
  */
  const used = computeConsumption(sold.filter((l) => l.isRefund), indexRecipeVersions(versions));
  const ids = [...used.byIngredient.values()].filter((i) => i.fromReturnedWasteMilli > 0 && i.unitConflict === null).map((i) => i.productId);
  const names = ids.length === 0 ? new Map<string, string>() : new Map((await db.execute<{ id: string; name: string }>(sql`
    select id, name_ar as name from products where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
  `)).rows.map((r) => [r.id, r.name]));
  const returned: ReturnedIngredient[] = [];
  for (const i of used.byIngredient.values()) {
    if (i.fromReturnedWasteMilli <= 0 || i.unitConflict !== null) continue;
    /* الكمّيّةُ بالوحدة الصغرى لعائلتها: غرامٌ أو مليلتر أو حبّة */
    const unit = i.unit === "KG" ? "G" : i.unit === "L" ? "ML" : i.unit;
    returned.push({ productId: i.productId, productName: names.get(i.productId) ?? "صنف", quantityMilli: i.fromReturnedWasteMilli, unit });
  }
  return { ...buildWasteBoard(entries, rates, { ...used.returnedAfterPrep, ingredients: returned }), since };
}
