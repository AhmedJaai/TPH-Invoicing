/**
 * ربطُ مورّد فودكس بمورّدنا — قرارُ إنسان.
 *
 * الاسمُ ليس هويّة: «Lanius» عند فودكس «سرد كو» عندنا، و«مورد حبوب قهوة» ليس
 * مورّداً أصلاً. فالنظامُ يقترح بدليله (فواتيرُ طابقت رقماً ومبلغاً) ولا يربط.
 * والربطُ لا يمسّ مالاً: يحدّد أيَّ فواتيرنا تُقابَل بحركات هذا المورّد وحسب.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { linkFoodicsSupplier, UnknownFoodicsSupplierError } from "@/services/foodics-compare.service";

export const runtime = "nodejs";

const Body = z.object({
  foodicsSupplierId: z.string().min(1).max(80),
  /** فارغٌ يفكّ الربط */
  supplierId: z.string().min(1).max(80).nullable(),
}).strict();

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("foodics-link", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const read = await readJson(request, Body);
  if (!read.ok) return read.response;

  try {
    const done = await linkFoodicsSupplier(read.body.foodicsSupplierId, read.body.supplierId, user.id);
    return NextResponse.json({
      ok: true,
      message: done.supplierName ? `تم ربط «${done.name}» بـ«${done.supplierName}»` : `تم فك ربط «${done.name}»`,
    });
  } catch (e) {
    if (e instanceof UnknownFoodicsSupplierError) return NextResponse.json({ error: e.message }, { status: 404 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
