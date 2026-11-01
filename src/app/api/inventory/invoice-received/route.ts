/**
 * يومُ وصول بضاعة فاتورةٍ تلت نهايةَ الجرد — قرارُ صاحب المقهى يُسقط الالتباس (`lib/inventory/received-date.ts`).
 * المتصفّحُ يرسل المعرّفَ واليومَ وحدهما؛ والخادمُ يفحص اليومَ ويكتب أثرَه.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { setInvoiceReceivedOn } from "@/services/inventory-late-invoices.service";
import { formatDay } from "@/lib/riyadh-time";

export const runtime = "nodejs";

const Body = z.object({
  invoiceId: z.string().trim().min(1).max(64),
  /** يومُ الوصول، أو `null` يعيد السؤال عن الفاتورة. */
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "اكتب اليوم بصيغة YYYY-MM-DD").nullable(),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("inventory-invoice-received", "inventory:count");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await setInvoiceReceivedOn(read.body.invoiceId, read.body.receivedOn, user.id);
    return NextResponse.json({
      ok: true,
      message: out.receivedOn === null
        ? `أُعيد السؤال عن الفاتورة ${out.invoiceNumber}.`
        : `حُفظ: وصلت بضاعة ${out.invoiceNumber} يوم ${formatDay(out.receivedOn)}.`,
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
