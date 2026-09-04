/**
 * ربط أصناف المورّدين بصنف معياري.
 *
 * الربط قرار إنسان لا استنتاج آلة: «عنب» عند محمصة كيلو بنّ وعند لافا
 * زجاجة كمبوتشا. فالنظام يقترح ويبيّن ما يُضعف اقتراحه، والتأكيد يُسجَّل
 * بفاعله ووقته.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { linkToProduct, unlink } from "@/services/product.service";
import type { ProductCategory } from "@/lib/products";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface Body {
  action?: "link" | "unlink";
  supplierProductIds?: string[];
  productId?: string;
  newProductName?: string;
  category?: ProductCategory;
  baseUnit?: "KG" | "G" | "L" | "ML" | "PIECE" | "PACK";
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("supplier", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const ids = body.supplierProductIds ?? [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "لم تُحدَّد أصناف" }, { status: 400 });
  }

  if (body.action === "unlink") {
    for (const id of ids) await unlink(id);
    await recordAudit({
      actorId: user.id,
      action: "PRODUCT_UNLINKED",
      entityType: "supplier_product",
      entityId: ids[0],
      after: { عدد: ids.length },
    });
    return NextResponse.json({ ok: true, message: `فُكّ ربط ${ids.length} صنف` });
  }

  try {
    const result = await linkToProduct({
      supplierProductIds: ids,
      productId: body.productId,
      newProductName: body.newProductName,
      category: body.category,
      baseUnit: body.baseUnit,
      actorId: user.id,
    });

    await recordAudit({
      actorId: user.id,
      action: "PRODUCT_LINKED",
      entityType: "product",
      entityId: result.productId,
      after: {
        الصنف_المعياري: result.productName,
        أصناف_مورّدين: result.linked,
        أُنشئ_الصنف: result.createdProduct,
      },
    });

    return NextResponse.json({
      ok: true,
      ...result,
      message: `رُبط ${result.linked} صنفاً بـ«${result.productName}»${
        result.createdProduct ? " (أُنشئ الآن)" : ""
      }`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
