/**
 * «سدّد بهذه الدفعة فواتيره المفتوحة» — قرارُ صاحب المقهى في دفعةٍ زادت واستُردّت (`unbacked-credit.service.ts`).
 * المتصفّحُ يرسل المعرّفَ وجملةَ الشرح؛ والخادمُ يقرأ المبالغَ ويوزّعها ويكتب أثرَها.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { formatRiyalsDisplay } from "@/lib/money";
import { countNoun, INVOICE } from "@/lib/arabic";
import { guard, respondTo } from "@/services/guard";
import { applyUnbackedPaymentToOpenInvoices } from "@/services/unbacked-credit.service";

export const runtime = "nodejs";

const Body = z.object({
  paymentId: z.string().trim().min(1).max(64),
  note: z.string().trim().min(3, "اكتب ما حدث بإيجاز").max(300),
}).strict();

export async function POST(request: Request) {
  try {
    /* تُسدَّد بها فواتير — بصلاحية السداد لا بصلاحية النظر */
    const user = await guard("unbacked-credit", "payment:approve");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await applyUnbackedPaymentToOpenInvoices({ paymentId: read.body.paymentId, note: read.body.note, actorId: user.id });
    return NextResponse.json({
      ok: true,
      message: `سُدّد ${formatRiyalsDisplay(out.appliedMinor)} ريال من ${countNoun(out.invoiceCount, INVOICE)} مفتوحة بهذه الدفعة${out.leftMinor > 0 ? `، ويبقى منها ${formatRiyalsDisplay(out.leftMinor)} رصيداً لك` : ""}.`,
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
