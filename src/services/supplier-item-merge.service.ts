/**
 * «هذا البند هو ذاك الصنف» — دمجُ صيغةٍ من اسم صنف المورّد بأصلها.
 *
 * النموذجُ يكتب البند الواحد بصيغ: المحمصة الغربية «كولومبي عنب» و«كولومي عنب» و«عنب»
 * في الإنتاج — فيصير كلٌّ صنفاً، يتفرّق تاريخُ سعره ويُسأل عن ربطه بالجرد مرّةً لكلّ صيغة.
 * والاسمُ ليس هويّة: لا يُدمج شيءٌ بالتشابه وحده، بل يُقرّه إنسانٌ مرّة، ثمّ:
 *
 * - تُحفظ الصيغة (`supplier_item_aliases`) فيُكتب بها كلُّ بندٍ بعدها (`replaceLines`).
 * - تُنقل بنودُها القائمة إلى الأصل (الوصفُ المطبوع كما هو، والمفتاحُ وحده يتغيّر).
 * - يرث الأصلُ ربطَ الجرد إن لم يكن له، ويُردّ الدمجُ إن كانا مربوطين بصنفين مختلفين.
 * - يُحذف صنفُ الصيغة (فهرسٌ لا مال)، ويُكتب الدمجُ في السجلّ بالمعاملة نفسها.
 */
import { and, eq, sql } from "drizzle-orm";
import { invoiceLines, products, supplierItemAliases, supplierProducts } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { Tx } from "./types";

export class ItemMergeRefused extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "ItemMergeRefused";
  }
}

export async function mergeSupplierItems(
  tx: Tx,
  input: { supplierId: string; from: string; into: string },
  actorId: string,
): Promise<{ linesMoved: number }> {
  /* الأصلُ قد يكون هو نفسُه صيغةً لغيره — فيُدمج في أصله */
  const [chain] = await tx.select({ canonical: supplierItemAliases.canonicalNormalized })
    .from(supplierItemAliases)
    .where(and(eq(supplierItemAliases.supplierId, input.supplierId), eq(supplierItemAliases.aliasNormalized, input.into)))
    .limit(1);
  const into = chain?.canonical ?? input.into;
  const from = input.from;
  if (from === into) throw new ItemMergeRefused("الصنفان واحدٌ أصلاً.", 400);

  const sp = await tx
    .select({
      id: supplierProducts.id, normalized: supplierProducts.normalizedDescription, displayName: supplierProducts.displayName,
      productId: supplierProducts.productId, productName: products.nameAr,
      packSize: supplierProducts.packSize, contentUnit: supplierProducts.contentUnit, contentQuantity: supplierProducts.contentQuantity,
      confirmedById: supplierProducts.confirmedById, confirmedAt: supplierProducts.confirmedAt,
    })
    .from(supplierProducts)
    .leftJoin(products, eq(products.id, supplierProducts.productId))
    .where(and(eq(supplierProducts.supplierId, input.supplierId), sql`${supplierProducts.normalizedDescription} in (${from}, ${into})`))
    .for("update", { of: supplierProducts });
  const fromSp = sp.find((r) => r.normalized === from);
  const intoSp = sp.find((r) => r.normalized === into);
  if (!fromSp || !intoSp) throw new ItemMergeRefused("لم يُعثر على أحد الصنفين عند هذا المورّد — حدّث الصفحة.", 404);

  if (fromSp.productId && intoSp.productId && fromSp.productId !== intoSp.productId) {
    throw new ItemMergeRefused(
      `«${fromSp.displayName}» مربوطٌ في الجرد بـ«${fromSp.productName}» و«${intoSp.displayName}» بـ«${intoSp.productName}». `
      + "إن كانا صنفاً واحداً فوحّد ربطهما أوّلاً من لوح الجرد.",
    );
  }
  /* الأصلُ يرث ربطَ الجرد والعبوةَ إن لم يكن له — فلا يُسأل عنه ثانية */
  if (!intoSp.productId && fromSp.productId) {
    await tx.update(supplierProducts).set({
      productId: fromSp.productId, packSize: fromSp.packSize, contentUnit: fromSp.contentUnit,
      contentQuantity: fromSp.contentQuantity, confirmedById: fromSp.confirmedById, confirmedAt: fromSp.confirmedAt,
    }).where(eq(supplierProducts.id, intoSp.id));
  }

  await tx.insert(supplierItemAliases)
    .values({ supplierId: input.supplierId, aliasNormalized: from, canonicalNormalized: into, createdById: actorId })
    .onConflictDoUpdate({
      target: [supplierItemAliases.supplierId, supplierItemAliases.aliasNormalized],
      set: { canonicalNormalized: into, createdById: actorId },
    });
  /* ما كان صيغةً للمدموج صار صيغةً للأصل — لا سلاسل */
  await tx.update(supplierItemAliases).set({ canonicalNormalized: into })
    .where(and(eq(supplierItemAliases.supplierId, input.supplierId), eq(supplierItemAliases.canonicalNormalized, from)));

  const moved = await tx.update(invoiceLines)
    .set({ normalizedDescription: into, supplierProductId: intoSp.id })
    .where(and(eq(invoiceLines.supplierId, input.supplierId), eq(invoiceLines.normalizedDescription, from)))
    .returning({ id: invoiceLines.id });
  await tx.delete(supplierProducts).where(eq(supplierProducts.id, fromSp.id));

  await recordAudit({
    actorId,
    action: "SUPPLIER_ITEM_MERGED",
    entityType: "supplier",
    entityId: input.supplierId,
    before: { الصيغة: fromSp.displayName, ربطُها: fromSp.productName ?? null },
    after: { الأصل: intoSp.displayName, ربطُه: intoSp.productName ?? fromSp.productName ?? null, البنود_المنقولة: moved.length },
  }, tx);

  return { linesMoved: moved.length };
}
