/**
 * «حذف القيد» — للمالك وحده (`invoice:remove`، `invoice-removal.service.ts`).
 *
 *   POST { action: "preview", invoiceId, choice }   ما سيُفكّ وأين يذهب، و«عليك» قبل وبعد
 *   POST { action: "remove",  invoiceId, choice }   التنفيذ في معاملةٍ واحدة
 *
 * المتصفّحُ يرسل المعرّفات والاختيار وحدهما — لا مبلغ. والخادمُ يعيد الحساب كلَّه.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { formatRiyalsDisplay } from "@/lib/money";
import { previewInvoiceRemoval, removeInvoiceEntry } from "@/services/invoice-removal.service";

export const runtime = "nodejs";

const Id = z.string().trim().min(1).max(64);
const Choice = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("release"), reallocate: z.boolean() }).strict(),
  z.object({ mode: z.literal("move"), targetId: Id }).strict(),
]);
const Body = z.object({
  action: z.enum(["preview", "remove"]),
  invoiceId: Id,
  choice: Choice,
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("invoice-remove", "invoice:remove");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const { action, invoiceId, choice } = read.body;
    if (action === "preview") {
      return NextResponse.json({ ok: true, ...(await previewInvoiceRemoval(invoiceId, choice, user.id)) });
    }
    const out = await db.transaction((t) => removeInvoiceEntry(t, { invoiceId, choice, actorId: user.id }));
    const parts = [
      `حُذف قيد ${out.number}`,
      out.movedMinor > 0 && out.target ? `وانتقل سداده (${formatRiyalsDisplay(out.movedMinor)}) إلى ${out.target.number}` : null,
      out.reappliedMinor > 0 ? `ووُزّع ${formatRiyalsDisplay(out.reappliedMinor)} على أقدم المفتوح` : null,
      out.leftAsCreditMinor > 0 ? `وبقي ${formatRiyalsDisplay(out.leftAsCreditMinor)} رصيداً لك عند المورّد` : null,
    ].filter(Boolean);
    return NextResponse.json({ ok: true, balance: out.balance, message: `${parts.join("، ")}.` });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
