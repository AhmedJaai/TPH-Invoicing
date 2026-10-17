/**
 * «ارتدّت» أو «ليست ردّاً» لزوجِ خروجٍ وعودة — `bank-bounce.service.ts`.
 * بصلاحية اعتماد السداد: «ارتدّت» تردّ دفعةً وتعيد فواتيرها مستحقّة.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { BounceRefused, resolveBounce } from "@/services/bank-bounce.service";

export const runtime = "nodejs";

const Body = z.object({
  outgoingId: z.string().trim().min(1).max(64),
  incomingId: z.string().trim().min(1).max(64),
  decision: z.enum(["BOUNCED", "NOT_BOUNCE"]),
});

export async function POST(request: Request) {
  try {
    const user = await guard("bank-bounce", "payment:approve");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await db.transaction((tx) => resolveBounce(tx, read.body, user.id));
    return NextResponse.json({
      ok: true,
      message: read.body.decision === "BOUNCED"
        ? `تم الحسم: الحوالة مرتجعة. ${out.freedInvoices > 0 ? "أُلغيت الدفعة وعادت فاتورتها مستحقة." : "ولا توجد دفعة مرتبطة بها."}`
        : "تم الحسم: الحركة ليست مرتجعة. أُزيل التنبيه.",
    });
  } catch (e) {
    if (e instanceof BounceRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
