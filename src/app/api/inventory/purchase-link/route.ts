/**
 * ربطُ صنف المورّد بصنف الجرد وما في وحدته — من داخل الجرد.
 *
 * الطلبُ معرّفان ومواصفةُ عبوةٍ نصّاً (zod)، والخادمُ يتحقّق من الصنف وعائلة
 * الوحدة ويكتب الاثنين معاً (`inventory-purchase-link.service.ts`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { PurchaseLinkRefused, savePurchaseLink } from "@/services/inventory-purchase-link.service";
import { storedUnit } from "@/lib/inventory/count-request";

export const runtime = "nodejs";

const Id = z.string().trim().min(1).max(64);
const Decimal = z.string().trim().regex(/^\d{1,7}(\.\d{1,3})?$/, "رقمٌ بثلاث خاناتٍ عشريّة على الأكثر");
const Body = z.object({
  supplierProductId: Id,
  productId: Id,
  packSize: Decimal,
  contentQuantity: Decimal,
  contentUnit: storedUnit,
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("inventory-purchase-link", "inventory:count");
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "تعذّرت قراءة الطلب." }, { status: 400 });
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "طلبٌ غير مفهوم" }, { status: 400 });
    const r = await savePurchaseLink(parsed.data, user.id);
    return NextResponse.json({ ok: true, message: `رُبط بـ«${r.productName}» — يُعاد حسابُ المشتريات` });
  } catch (e) {
    if (e instanceof PurchaseLinkRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
