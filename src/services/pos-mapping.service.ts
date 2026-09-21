/**
 * ربطُ صنف فودكس بصنفٍ عندنا — مرّةً واحدة، ويُتذكَّر.
 *
 * ── لماذا المعرّفُ الخارجيّ لا الاسم ──
 *
 * الاسمُ يتغيّر: «Spanish Latte» تصير «سبانيش لاتيه» بعد تعريب
 * القائمة، أو تُضاف إليها «(كبير)». والربطُ على الاسم يسقط في تلك
 * اللحظة، **ويُسأل صاحبُ المقهى عن الشيء نفسه كلَّ أسبوع** — وهو
 * بالضبط ما وقع في طابور مراجعة البنك قبل أن يُصلَح.
 *
 * فالربطُ على `pos_products.external_id` وهو معرّفُ الصنف عند فودكس،
 * وفريدٌ بـ(المصدر، المعرّف) في القاعدة. واسمُ الصنف يُحدَّث مع كلّ
 * استيراد، والربطُ لا يُمَسّ.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { posProducts, products } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { suggestCategory, type ProductCategory } from "@/lib/products";
import type { Conn } from "./types";

export interface MapInput {
  posProductIds: string[];
  /** صنفٌ قائم، أو اسمٌ جديد يُنشأ صنفَ قائمة. */
  productId?: string;
  newProductName?: string;
  category?: ProductCategory;
  actorId: string;
}

export interface MapResult {
  productId: string;
  productName: string;
  mapped: number;
  createdProduct: boolean;
}

/**
 * يربط أصنافَ فودكس بصنفِ قائمة.
 *
 * والصنفُ المنشأ هنا **صنفُ قائمةٍ لا صنفُ مخزون**: يُباع ولا يُعَدّ
 * على الرفّ. ولو وُسم صنفَ مخزونٍ لظهر في جدول العدّ الأسبوعيّ صفّاً
 * لا يُعَدّ أبداً — «سبانيش لاتيه: كم كوباً على الرفّ؟».
 */
export async function mapPosProducts(input: MapInput, conn: Conn = db): Promise<MapResult> {
  if (input.posProductIds.length === 0) throw new Error("لم تُحدَّد أصناف");

  return conn.transaction(async (tx) => {
    let productId = input.productId ?? "";
    let productName = "";
    let createdProduct = false;

    if (!productId) {
      const name = input.newProductName?.trim();
      if (!name) throw new Error("اختر صنفاً قائماً أو اكتب اسم صنفٍ جديد");

      const [existing] = await tx
        .select({ id: products.id, nameAr: products.nameAr })
        .from(products)
        .where(and(eq(products.nameAr, name), eq(products.isActive, true)))
        .limit(1);

      if (existing) {
        productId = existing.id;
        productName = existing.nameAr;
      } else {
        const [row] = await tx
          .insert(products)
          .values({
            nameAr: name,
            category: input.category ?? suggestCategory(name),
            baseUnit: "PIECE",
            isMenuItem: true,
            isStockItem: false,
          })
          .returning({ id: products.id, nameAr: products.nameAr });
        productId = row.id;
        productName = row.nameAr;
        createdProduct = true;
      }
    } else {
      const [row] = await tx
        .select({ nameAr: products.nameAr })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      if (!row) throw new Error("الصنف غير موجود");
      productName = row.nameAr;
    }

    /* ما يُباع صنفُ قائمةٍ بحكم الواقع — يُوسَم ولا يُنتظَر أن يُوسَم يدوياً */
    await tx.update(products).set({ isMenuItem: true, updatedAt: new Date() }).where(eq(products.id, productId));

    const mapped = (
      await tx
        .update(posProducts)
        .set({ productId })
        .where(inArray(posProducts.id, [...input.posProductIds]))
        .returning({ id: posProducts.id })
    ).length;

    await recordAudit({
      actorId: input.actorId,
      action: "POS_PRODUCT_MAPPED",
      entityType: "pos_product",
      entityId: input.posProductIds[0],
      after: { الصنف: productName, عدد: mapped, أُنشئ_الصنف: createdProduct },
    }, tx);

    return { productId, productName, mapped, createdProduct };
  });
}

/** يفكّ الربط — ويعود الصنفُ إلى «يحتاج ربطاً». */
export async function unmapPosProducts(posProductIds: string[], actorId: string, conn: Conn = db): Promise<number> {
  if (posProductIds.length === 0) return 0;
  return conn.transaction(async (tx) => {
    const rows = await tx
      .update(posProducts)
      .set({ productId: null })
      .where(inArray(posProducts.id, [...posProductIds]))
      .returning({ id: posProducts.id });

    await recordAudit({
      actorId,
      action: "POS_PRODUCT_UNMAPPED",
      entityType: "pos_product",
      entityId: posProductIds[0],
      after: { عدد: rows.length },
    }, tx);

    return rows.length;
  });
}
