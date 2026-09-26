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
import { UndoError, undoDrawn, undoMarkedPaid } from "@/services/mark-paid-undo.service";
import { formatRiyalsDisplay } from "@/lib/money";

export const runtime = "nodejs";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Body = z.object({
  paymentIds: z.array(Id).max(50).default([]),
  /* ما نُسب من حوالات الكشف — يُفكّ ولا تُلغى الحوالة */
  drawn: z.array(z.object({ paymentId: Id, invoiceId: Id })).max(50).default([]),
}).refine((b) => b.paymentIds.length + b.drawn.length > 0);

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
    const out = await db.transaction(async (t) => {
      const voided = ids.length > 0 ? await undoMarkedPaid(t, ids, user.id) : { voided: 0, freedMinor: 0 };
      const undrawn = parsed.data.drawn.length > 0 ? await undoDrawn(t, parsed.data.drawn, user.id) : 0;
      return { voided: voided.voided, freedMinor: voided.freedMinor + undrawn };
    });
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
