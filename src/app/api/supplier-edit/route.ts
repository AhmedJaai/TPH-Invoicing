/**
 * تعديلُ بيانات المورّد الأساسيّة من ملفّه — انظر `supplier-edit.service.ts`.
 *
 * الطلبُ يُفحَص بـzod (`lib/supplier-edit.ts`): الغائبُ لا يُمسّ والفارغُ يمحو.
 * وما يستحقّ سؤالاً يُردّ 409 بـ`warnings` ولم يُكتب شيء؛ ويمضي بـ`confirm`.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { readJson } from "@/lib/request-body";
import { supplierProfileRequest } from "@/lib/supplier-edit";
import { guard, respondTo } from "@/services/guard";
import { SupplierProfileError, updateSupplierProfile } from "@/services/supplier-edit.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await guard("supplier", "supplier:edit");
    const read = await readJson(request, supplierProfileRequest);
    if (!read.ok) return read.response;

    const out = await db.transaction((t) => updateSupplierProfile(t, read.body, user.id));
    if (out.kind === "confirm") {
      return NextResponse.json({ error: out.warnings.join(" "), warnings: out.warnings }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      message: out.kind === "unchanged" ? "لم يتغيّر شيء" : `حُفظ: ${out.changed.join("، ")}`,
    });
  } catch (e) {
    if (e instanceof SupplierProfileError) return NextResponse.json({ error: e.message }, { status: e.status });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
