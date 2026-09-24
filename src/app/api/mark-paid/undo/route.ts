/**
 * التراجعُ عن إقرار السداد — زرُّ «تراجع» في الإشعار بعد «سجّل أنّها سُدّدت».
 *
 * الطلبُ معرّفاتٌ وحدها (zod)، والخادمُ يقرأ الدفعات ويحكم عليها
 * (`mark-paid-undo.service.ts`) في معاملةٍ بقفل: فضغطتان متزامنتان لا
 * تُلغيان مرّتين، والثانيةُ تُردّ بـ409 تقول لماذا.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { UndoError, undoMarkedPaid } from "@/services/mark-paid-undo.service";
import { formatRiyalsDisplay } from "@/lib/money";

export const runtime = "nodejs";

const Body = z.object({
  paymentIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(1).max(50),
});

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("mark-paid", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let parsed;
  try {
    parsed = Body.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "حدّد الدفعات التي يُتراجَع عنها." }, { status: 400 });
  }
  const ids = [...new Set(parsed.data.paymentIds)];

  try {
    const out = await db.transaction((t) => undoMarkedPaid(t, ids, user.id));
    return NextResponse.json({
      ok: true,
      voided: out.voided,
      message: `أُلغي الإقرار — عادت فواتيرُ بـ${formatRiyalsDisplay(out.freedMinor)} ريال مفتوحة.`,
    });
  } catch (e) {
    if (e instanceof UndoError) return NextResponse.json({ error: e.message }, { status: e.status });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
