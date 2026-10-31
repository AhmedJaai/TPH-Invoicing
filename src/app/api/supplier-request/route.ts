/**
 * «طلبتُ الفواتير» — أثرُ ضغطة واتساب على مورّدٍ له دفعاتٌ بلا مستند.
 *
 * لا مالَ يُكتب: صفٌّ يقول متى طولب، فيقول البندُ «طولب قبل ٩ أيّام — ذكِّره» بدل أن
 * يُطلَب مرّتين أو يُنسى. والخادمُ يشتقّ المفتاح من دفعات المورّد القائمة الآن؛ فإن
 * لم يبقَ له ما يُطلَب رُدّ الطلب.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { markInvoicesRequested } from "@/services/supplier-followups.service";

export const runtime = "nodejs";

const Body = z.object({ supplierId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "المعرّف غير صالح") });

export async function POST(request: Request) {
  /* الطلبُ كلُّه لا الحارسُ وحده: خطأُ عملٍ معروف (شهرٌ مقفل، قيدٌ في القاعدة) يُقال بنصّه لا ٥٠٠ */
  try {
    return await handle(request);
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}

async function handle(request: Request) {
  const user = await guard("supplier-request", "supplier:edit");

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;

  const marked = await markInvoicesRequested(read.body.supplierId, user.id);
  if (!marked) {
    return NextResponse.json({ error: "لا توجد الآن دفعة بلا مستند لهذا المورّد، فربما وصلت فواتيره. حدّث الصفحة." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, message: "سُجّل أنك طالبت المورّد اليوم" });
}
