/**
 * تجهيزُ اختبارات الجرد — على المخطّط الحقيقيّ، في معاملةٍ تُلغى.
 *
 * ولا يُكتَب شيءٌ باليد ممّا للخدمة أن تكتبه: الوصفةُ تمرّ بخدمتها،
 * والاستيرادُ بخدمته. وما يُكتب هنا هو ما لا خدمةَ له بعد — الصنفُ
 * والفرع — ولو كُتبت الوصفةُ بالإدراج لاختُبر مخطّطٌ لا مسار.
 */
import { notInArray } from "drizzle-orm";
import { branches, products, users } from "@/db/schema";
import { createId } from "@/lib/id";
import type { StoredUnit } from "@/lib/unit-conversion";
import type { Tx } from "@/services/types";
import { toCanonical } from "@/lib/inventory/units";

export const kg = (n: number) => toCanonical(Math.round(n * 1000), "KG");

export async function makeStockProduct(
  tx: Tx,
  nameAr: string,
  baseUnit: StoredUnit,
  category: "COFFEE" | "DAIRY" | "OTHER" = "OTHER",
): Promise<string> {
  const id = createId();
  await tx.insert(products).values({
    id, nameAr: `${nameAr} ${id.slice(0, 5)}`, category, baseUnit,
    isStockItem: true, isMenuItem: false, isActive: true,
  });
  return id;
}

export async function makeMenuProduct(tx: Tx, nameAr: string): Promise<string> {
  const id = createId();
  await tx.insert(products).values({
    id, nameAr: `${nameAr} ${id.slice(0, 5)}`, category: "BEVERAGE", baseUnit: "PIECE",
    isStockItem: false, isMenuItem: true, isActive: true,
  });
  return id;
}

/**
 * فرعٌ باسمه.
 *
 * والاسمُ يُرجَع معه لأنّ الاستيراد يُسنِد البيعةَ إلى فرعها **باسمه
 * كما في الملفّ**. فاختبارٌ ينشئ فرعاً ولا يُمرّر اسمَه إلى الاستيراد
 * يعتمد على ما في القاعدة من فروعٍ أخرى — ويمرّ أو يسقط بحسب ما تركه
 * اختبارٌ آخر.
 */
export async function makeBranch(tx: Tx): Promise<{ id: string; nameAr: string }> {
  const id = createId();
  const nameAr = `فرع اختبار ${id.slice(0, 5)}`;
  await tx.insert(branches).values({ id, nameAr, code: `T-${id.slice(0, 8)}`, isActive: true });
  return { id, nameAr };
}

/**
 * الأصنافُ الأخرى تُخفى عن الجرد.
 *
 * قاعدةُ الاختبار مشتركةٌ بين الملفّات، وفيها أصنافٌ من اختباراتٍ أخرى.
 * والمحرّكُ يعدّ **كلَّ** صنفِ مخزونٍ فعّال، فيدخل الغريبُ التقرير
 * ويُفسد العدّ. فتُعطَّل ما عدا أصنافَ هذا الاختبار داخل المعاملة —
 * وتُلغى مع إلغائها.
 */
export async function isolateProducts(tx: Tx, keep: readonly string[]): Promise<void> {
  await tx
    .update(products)
    .set({ isActive: false })
    .where(keep.length === 0 ? undefined : notInArray(products.id, [...keep]));
}

/** فاعلٌ للقيود — `created_by_id` مقيَّدٌ بمفتاحٍ أجنبيّ، فلا يُخترَع معرّف. */
export async function makeActor(tx: Tx): Promise<string> {
  const id = createId();
  await tx.insert(users).values({
    id, email: `dbtest-${id}@example.test`, name: "فاعل اختبار", role: "OWNER", isActive: true,
  });
  return id;
}

/* ───────────── مبيعاتٌ وفواتيرُ للتجهيز — بالخدمات لا بالإدراج ───────────── */

import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { importSalesFile } from "@/services/sales-import.service";
import { mapPosProducts } from "@/services/pos-mapping.service";
import { makeInvoice, makeSupplier, day } from "@/test/db";

const ORDERS_HEADER = [
  "order_reference", "order_status", "type", "parent_item_sku", "status",
  "sku", "name", "unit_price", "quantity", "total_price", "business_date", "branch_name",
];

/** ملفُّ فودكس بترويسته الحقيقيّة — `count` لاتيه، طلبٌ لكلٍّ، في يومٍ واحد. */
export function latteSalesFile(count: number, date: string, orderPrefix = "ORD", branch = "Branch 1"): Buffer {
  const rows = Array.from({ length: count }, (_, i) => [
    `${orderPrefix}-${i + 1}`, "Done", "المنتج", "", "Done", "SKU-LATTE", "Spanish Latte",
    18, 1, 18, date, branch,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ORDERS_HEADER, ...rows]), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** يستورد الملفّ بخدمته، ثمّ يربط منتجَ فودكس بصنف القائمة. */
export async function importLatteSales(
  tx: Tx, buffer: Buffer, actorId: string, menuProductId: string, branchLabel?: string,
): Promise<void> {
  await importSalesFile({ buffer, fileName: `foodics-${Math.random()}.xlsx`, actorId, branchLabel }, tx);
  const unmapped = await tx.execute<{ id: string }>(sql`
    select id from pos_products where product_id is null and external_id = 'SKU-LATTE'
  `);
  if (unmapped.rows[0]) {
    await mapPosProducts({ posProductIds: [String(unmapped.rows[0].id)], productId: menuProductId, actorId }, tx);
  }
}

/**
 * بندُ فاتورةٍ لصنف — بمواصفة عبوة أو بلا مواصفة (`pack: null` = كمّيّةٌ
 * لا تُعرَف). ويُرجع معرّفَ البند.
 */
export async function makeInvoicePurchase(
  tx: Tx,
  productId: string,
  isoDate: string,
  totalMinor: number,
  pack: { packSize: string; contentUnit: string; contentQuantity: string; qty: string } | null,
): Promise<string> {
  const supplierId = await makeSupplier(tx);
  const invoiceId = await makeInvoice(tx, supplierId, totalMinor, isoDate);
  const spId = `sp-${Math.random().toString(36).slice(2, 12)}`;
  await tx.execute(sql`
    insert into supplier_products (id, supplier_id, normalized_description, display_name, product_id, pack_size, content_unit, content_quantity)
    values (${spId}, ${supplierId}, ${`item-${spId}`}, 'صنف اختبار', ${productId},
            ${pack?.packSize ?? null}, ${pack?.contentUnit ?? null}::base_unit, ${pack?.contentQuantity ?? null})
  `);
  const lineId = `il-${spId}`;
  await tx.execute(sql`
    insert into invoice_lines (id, invoice_id, description, normalized_description, qty,
                               unit_price_minor, line_total_minor, invoice_date, supplier_id, supplier_product_id)
    values (${lineId}, ${invoiceId}, 'صنف اختبار', ${`item-${spId}`}, ${pack?.qty ?? "1"},
            ${totalMinor}, ${totalMinor}, ${day(isoDate)}, ${supplierId}, ${spId})
  `);
  return lineId;
}
