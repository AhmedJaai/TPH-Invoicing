/**
 * أصنافُ الجرد للتبليغ عن تالف من «TPH Team» — الاسمُ والوحدة وحدهما، بلا كلفةٍ ولا كمّيّة.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { UNIT_LABEL } from "@/lib/team-units";

export async function loadStockOptions(): Promise<{ id: string; name: string; unit: string; unitLabel: string }[]> {
  const rows = await db.select({ id: products.id, name: products.nameAr, unit: products.baseUnit }).from(products)
    .where(and(eq(products.isActive, true), eq(products.isStockItem, true))).orderBy(asc(products.nameAr));
  return rows.map((r) => ({ ...r, unitLabel: UNIT_LABEL[r.unit] ?? r.unit }));
}
