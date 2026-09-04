/**
 * خدمة الأصناف المعيارية.
 *
 * صنف المورّد يُبنى آلياً من بنود فواتيره — هذا آمن، فهو وصفه هو.
 * أمّا ربط أصناف مورّدين مختلفين بصنف معياري واحد فلا يقع آلياً أبداً:
 * درس «العنب» أنّ الاسم الواحد قد يخفي شيئين. يُقترح، ويؤكّده إنسان.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, products, supplierProducts } from "@/db/schema";
import { suggestCategory, type ProductCategory } from "@/lib/products";


export interface BuildResult {
  created: number;
  linkedLines: number;
  existing: number;
}

/**
 * يبني أصناف المورّدين من بنود الفواتير ويربط البنود بها.
 * قابل لإعادة التشغيل: يضيف الجديد ولا يكرّر ولا يفكّ ربطاً قائماً.
 */
export async function buildSupplierProducts(): Promise<BuildResult> {
  const groups = await db
    .select({
      supplierId: invoiceLines.supplierId,
      normalized: invoiceLines.normalizedDescription,
      // أوفى الأسماء وصفاً بين صيغ المورّد نفسه
      displayName: sql<string>`(array_agg(${invoiceLines.description} order by length(${invoiceLines.description}) desc))[1]`,
    })
    .from(invoiceLines)
    .where(sql`${invoiceLines.supplierId} is not null and ${invoiceLines.normalizedDescription} <> ''`)
    .groupBy(invoiceLines.supplierId, invoiceLines.normalizedDescription);

  let created = 0;
  let existing = 0;

  for (const g of groups) {
    if (!g.supplierId) continue;
    const inserted = await db
      .insert(supplierProducts)
      .values({
        supplierId: g.supplierId,
        normalizedDescription: g.normalized,
        displayName: g.displayName ?? g.normalized,
      })
      .onConflictDoNothing()
      .returning({ id: supplierProducts.id });

    if (inserted.length > 0) created++;
    else existing++;
  }

  // ربط البنود بأصنافها — بالمورّد والوصف المطبَّع معاً
  const linked = await db.execute(sql`
    update invoice_lines l
       set supplier_product_id = sp.id
      from supplier_products sp
     where sp.supplier_id = l.supplier_id
       and sp.normalized_description = l.normalized_description
       and l.supplier_product_id is distinct from sp.id
  `);

  return { created, existing, linkedLines: linked.rowCount ?? 0 };
}

export interface SupplierProductRow {
  id: string;
  supplierId: string;
  supplierName: string;
  normalized: string;
  displayName: string;
  productId: string | null;
  productName: string | null;
  confirmed: boolean;
  orderCount: number;
  lastUnitPriceMinor: number;
  totalSpentMinor: number;
}

/** أصناف المورّدين مع أرقامها — للعرض والمراجعة. */
export async function listSupplierProducts(): Promise<SupplierProductRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select sp.id, sp.supplier_id, s.name_ar as supplier_name,
           sp.normalized_description, sp.display_name,
           sp.product_id, p.name_ar as product_name,
           sp.confirmed_at is not null as confirmed,
           coalesce(count(l.id), 0)::int as order_count,
           coalesce((array_agg(l.unit_price_minor order by l.invoice_date desc nulls last))[1], 0)::int as last_price,
           coalesce(sum(l.line_total_minor), 0)::int as total_spent
      from supplier_products sp
      join suppliers s on s.id = sp.supplier_id
      left join products p on p.id = sp.product_id
      left join invoice_lines l on l.supplier_product_id = sp.id
     group by sp.id, s.name_ar, p.name_ar
     order by total_spent desc
  `);

  return rows.rows.map((r) => ({
    id: String(r.id),
    supplierId: String(r.supplier_id),
    supplierName: String(r.supplier_name),
    normalized: String(r.normalized_description),
    displayName: String(r.display_name),
    productId: r.product_id ? String(r.product_id) : null,
    productName: r.product_name ? String(r.product_name) : null,
    confirmed: Boolean(r.confirmed),
    orderCount: Number(r.order_count),
    lastUnitPriceMinor: Number(r.last_price),
    totalSpentMinor: Number(r.total_spent),
  }));
}

export interface LinkInput {
  supplierProductIds: string[];
  /** صنف معياري قائم، أو اسم جديد يُنشأ */
  productId?: string;
  newProductName?: string;
  category?: ProductCategory;
  baseUnit?: "KG" | "G" | "L" | "ML" | "PIECE" | "PACK";
  actorId: string;
}

export interface LinkResult {
  productId: string;
  productName: string;
  linked: number;
  createdProduct: boolean;
}

/**
 * يربط أصناف مورّدين بصنف معياري — بعد تأكيد إنسان.
 * التأكيد يُسجَّل بالفاعل ووقته، فيُعرف المؤكَّد من المقترَح.
 */
export async function linkToProduct(input: LinkInput): Promise<LinkResult> {
  if (input.supplierProductIds.length === 0) {
    throw new Error("لم تُحدَّد أصناف للربط");
  }

  let productId = input.productId ?? "";
  let productName = "";
  let createdProduct = false;

  if (!productId) {
    const name = input.newProductName?.trim();
    if (!name) throw new Error("اكتب اسم الصنف المعياري أو اختر واحداً قائماً");

    const [existing] = await db
      .select({ id: products.id, nameAr: products.nameAr })
      .from(products)
      .where(and(eq(products.nameAr, name), eq(products.isActive, true)))
      .limit(1);

    if (existing) {
      productId = existing.id;
      productName = existing.nameAr;
    } else {
      const [row] = await db
        .insert(products)
        .values({
          nameAr: name,
          category: input.category ?? suggestCategory(name),
          baseUnit: input.baseUnit ?? "PIECE",
        })
        .returning({ id: products.id, nameAr: products.nameAr });
      productId = row.id;
      productName = row.nameAr;
      createdProduct = true;
    }
  } else {
    const [row] = await db
      .select({ nameAr: products.nameAr })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!row) throw new Error("الصنف المعياري غير موجود");
    productName = row.nameAr;
  }

  const now = new Date();
  let linked = 0;
  for (const id of input.supplierProductIds) {
    const res = await db
      .update(supplierProducts)
      .set({ productId, confirmedById: input.actorId, confirmedAt: now })
      .where(eq(supplierProducts.id, id))
      .returning({ id: supplierProducts.id });
    linked += res.length;
  }

  return { productId, productName, linked, createdProduct };
}

/** يفكّ الربط ويعيد الصنف اقتراحاً غير مؤكَّد. */
export async function unlink(supplierProductId: string): Promise<void> {
  await db
    .update(supplierProducts)
    .set({ productId: null, confirmedById: null, confirmedAt: null })
    .where(eq(supplierProducts.id, supplierProductId));
}

/** أصناف معيارية قائمة — للاختيار منها. */
export async function listProducts() {
  return db
    .select({ id: products.id, nameAr: products.nameAr, category: products.category })
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(products.nameAr);
}

/** عدّاد سريع لصحّة البيانات. */
export async function mappingCoverage(): Promise<{ total: number; mapped: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      mapped: sql<number>`count(*) filter (where ${supplierProducts.productId} is not null)::int`,
    })
    .from(supplierProducts);
  return { total: Number(row?.total ?? 0), mapped: Number(row?.mapped ?? 0) };
}
