/**
 * صنفُ المخزون — إخراجُه من القائمة.
 *
 * ولا حذفَ هنا: الصنفُ مذكورٌ في فواتيرَ وحركاتٍ وأسطرِ جردٍ مقفَل،
 * فيُعطَّل ويبقى تاريخُه. والقاعدةُ نفسُها في المورّدين.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { ItemInUseError, retireStockItem } from "@/services/recipe.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-item", "recipe:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: { action?: "retire"; productId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }

  if (!body.productId) return NextResponse.json({ error: "لم يُحدَّد الصنف" }, { status: 400 });

  try {
    const gone = await retireStockItem(body.productId, user.id);
    return NextResponse.json({
      ok: true,
      message: `أُخرج «${gone.name}» من الجرد — وبقي ما مضى كما حُسب.`,
    });
  } catch (e) {
    /* «مستعمَلٌ في وصفة» خبرٌ عن الحال لا عطبٌ في الطلب */
    if (e instanceof ItemInUseError) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
