/**
 * ربطُ أصناف فودكس — **مرّةً واحدة، وتُتذكَّر**.
 *
 * والربطُ على معرّف الصنف عند فودكس لا على اسمه: الاسمُ يتغيّر بتغيّر
 * القائمة، والربطُ عليه يسقط في تلك اللحظة فيُسأل صاحبُ المقهى عن
 * الشيء نفسه كلَّ أسبوع.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { mapPosProducts, unmapPosProducts } from "@/services/pos-mapping.service";
import type { ProductCategory } from "@/lib/products";
import { PRODUCT, countNoun } from "@/lib/arabic";

export const runtime = "nodejs";

interface Body {
  action?: "map" | "unmap";
  posProductIds?: string[];
  productId?: string;
  newProductName?: string;
  category?: ProductCategory;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-mapping", "recipe:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }

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
