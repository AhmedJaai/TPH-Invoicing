/**
 * «دفعةٌ قُيّدت مرّتين بيدك» — للمالك وحده (`invoice:remove`، `hand-duplicate.service.ts`).
 *
 *   POST { action: "preview", paymentId }   أيُّ دفعة، ولماذا تُعدّ مكرّرة، و«عليك» قبل وبعد
 *   POST { action: "void",    paymentId }   «ألغِ القيد المكرّر» — `VOID` بسببٍ مكتوب
 *   POST { action: "keep",    paymentId }   «هي دفعةٌ حقيقيّة — أبقِها رصيداً»
 *   POST { action: "reopen",  paymentId }   تراجعٌ عن «حقيقيّة»
 *
 * المتصفّحُ يرسل المعرّف وحده — والخادمُ يعيد الحكمَ بقفلٍ على الدفعة.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { formatRiyalsDisplay } from "@/lib/money";
import { decideDuplicateHandPayment, previewDuplicateVoid, voidDuplicateHandPayment } from "@/services/hand-duplicate.service";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["preview", "void", "keep", "reopen"]),
  paymentId: z.string().trim().min(1).max(64),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("hand-duplicate", "invoice:remove");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const { action, paymentId } = read.body;
    if (action === "preview") {
      return NextResponse.json({ ok: true, ...(await previewDuplicateVoid(paymentId, user.id)) });
    }
    if (action === "void") {
      const out = await db.transaction((t) => voidDuplicateHandPayment(t, { paymentId, actorId: user.id }));
      return NextResponse.json({
        ok: true,
        balance: out.balance,
        message: `أُلغي القيد المكرّر (${formatRiyalsDisplay(out.amountMinor)}) لـ${out.supplierName}، وبقي في السجل بسببه.`,
      });
    }
    await db.transaction((t) => decideDuplicateHandPayment(t, { paymentId, decision: action === "keep" ? "KEEP" : "OPEN", actorId: user.id }));
    return NextResponse.json({
      ok: true,
      message: action === "keep"
        ? "حُفظ: دفعة حقيقية، وتبقى رصيداً لك عند المورّد يُخصم من فواتيره القادمة."
        : "أُعيد السؤال عن هذه الدفعة.",
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
