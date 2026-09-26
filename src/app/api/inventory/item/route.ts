/**
 * صنفُ المخزون — إخراجُه من القائمة، وإعادتُه (تراجعُ الإخراج من الإشعار).
 *
 * ولا حذفَ هنا: الصنفُ مذكورٌ في فواتيرَ وحركاتٍ وأسطرِ جردٍ مقفَل،
 * فيُعطَّل ويبقى تاريخُه. والقاعدةُ نفسُها في المورّدين.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { ItemInUseError, restoreStockItem, retireStockItem } from "@/services/recipe.service";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["retire", "restore"]).default("retire"),
  productId: z.string().min(1, "لم يُحدَّد الصنف"),
});

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-item", "recipe:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "طلبٌ غير مفهوم" }, { status: 400 });
  }
  const { action, productId } = parsed.data;

  try {
    if (action === "restore") {
      const back = await restoreStockItem(productId, user.id);
      return NextResponse.json({ ok: true, message: `عاد «${back.name}» إلى الجرد.` });
    }
    const gone = await retireStockItem(productId, user.id);
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
