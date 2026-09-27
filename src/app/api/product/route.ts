/**
 * ربط أصناف المورّدين بصنف معياري.
 *
 * الربط قرار إنسان لا استنتاج آلة: «عنب» عند محمصة كيلو بنّ وعند لافا
 * زجاجة كمبوتشا. فالنظام يقترح ويبيّن ما يُضعف اقتراحه، والتأكيد يُسجَّل
 * بفاعله ووقته.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { productCategoryEnum } from "@/db/schema";
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { linkToProduct, unlink } from "@/services/product.service";
import { recordAudit } from "@/lib/audit";
import { PRODUCT, countNoun } from "@/lib/arabic";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["link", "unlink"]).optional(),
  supplierProductIds: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
  productId: z.string().trim().min(1).max(64).optional(),
  newProductName: z.string().max(200).optional(),
  category: z.enum(productCategoryEnum.enumValues).optional(),
  baseUnit: z.enum(["KG", "G", "L", "ML", "PIECE", "PACK"]).optional(),
});
type Body = z.infer<typeof Body>;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("product", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body: Body = read.body;

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
    return NextResponse.json({ ok: true, message: `فُكّ ربط ${countNoun(ids.length, PRODUCT)}` });
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
      message: `رُبط ${countNoun(result.linked, PRODUCT)} بـ«${result.productName}»${
        result.createdProduct ? " (أُنشئ الآن)" : ""
      }`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
