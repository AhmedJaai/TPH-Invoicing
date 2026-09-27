/**
 * ربطُ أصناف فودكس — **مرّةً واحدة، وتُتذكَّر**.
 *
 * والربطُ على معرّف الصنف عند فودكس لا على اسمه: الاسمُ يتغيّر بتغيّر
 * القائمة، والربطُ عليه يسقط في تلك اللحظة فيُسأل صاحبُ المقهى عن
 * الشيء نفسه كلَّ أسبوع.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { productCategoryEnum } from "@/db/schema";
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { mapPosProducts, unmapPosProducts } from "@/services/pos-mapping.service";
import { PRODUCT, countNoun } from "@/lib/arabic";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["map", "unmap"]).optional(),
  posProductIds: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
  productId: z.string().trim().min(1).max(64).optional(),
  newProductName: z.string().max(200).optional(),
  category: z.enum(productCategoryEnum.enumValues).optional(),
});
type Body = z.infer<typeof Body>;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-mapping", "recipe:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body: Body = read.body;

  const ids = body.posProductIds ?? [];
  if (ids.length === 0) return NextResponse.json({ error: "لم تُحدَّد أصناف" }, { status: 400 });

  try {
    if (body.action === "unmap") {
      const n = await unmapPosProducts(ids, user.id);
      return NextResponse.json({ ok: true, message: `فُكّ ربط ${countNoun(n, PRODUCT)}` });
    }

    const result = await mapPosProducts({
      posProductIds: ids,
      productId: body.productId,
      newProductName: body.newProductName,
      category: body.category,
      actorId: user.id,
    });

    return NextResponse.json({
      ok: true, ...result,
      message: `رُبط ${countNoun(result.mapped, PRODUCT)} بـ«${result.productName}»${result.createdProduct ? " (أُنشئ الآن)" : ""}`,
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
