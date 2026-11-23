/**
 * سدادٌ من مال المالك: من تحويلات المقهى إليه أم من ماله الخاصّ؟
 *
 *   POST { paymentId, fromTransfers } → { ok }
 *
 * الأوّلُ يُخصم من التحويلات في قائمة الدخل (لا يُحسب المبلغ مرّتين)، والثاني لا. يقرّره
 * المالكُ لكلّ سدادٍ بعينه (083)، ويُسجَّل باسمه، ويُردّ في الشهر المقفل.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { MonthClosedError } from "@/services/validation.service";
import { convertToOwnerPayment, setOwnerPaymentSource } from "@/services/owner-account.service";

const Body = z.object({
  paymentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  fromTransfers: z.boolean(),
  /** تحويلٌ بنكيّ لا حركةَ تشهد له يصير «من مال المالك» (`convertToOwnerPayment`) */
  convert: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await guard("owner-payment-source", "payment:approve");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const done = read.body.convert
      ? await convertToOwnerPayment(read.body.paymentId, user.id)
      : await setOwnerPaymentSource(read.body.paymentId, read.body.fromTransfers, user.id);
    if (!done) return NextResponse.json({ error: "لم يعد هذا السداد قائماً. حدّث الصفحة." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof MonthClosedError) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
