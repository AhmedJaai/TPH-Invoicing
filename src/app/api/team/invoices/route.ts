/**
 * «أدخلتها في فودكس» من «TPH Team» — لمستلم الفواتير وحده، بلا جلسة، ورمزُه إذنُه.
 *
 *   POST { token, id, entered } → { ok }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { failWith } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { resolveCheckinToken } from "@/services/payroll.service";
import { markEnteredInFoodics } from "@/services/team-invoices.service";

export const runtime = "nodejs";

const Body = z.object({ token: z.string().trim().min(24).max(64), id: z.string().min(1).max(64), entered: z.boolean() }).strict();

export async function POST(request: Request) {
  try {
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const employee = await resolveCheckinToken(read.body.token);
    if (!employee) return NextResponse.json({ error: "هذا الرابط لم يعد يعمل. اطلب رابطاً جديداً من الإدارة." }, { status: 404 });
    if (!employee.receivesInvoices) return NextResponse.json({ error: "استلام الفواتير ليس من صلاحيتك." }, { status: 403 });
    await consume("team-invoice", employee.id);
    const done = await markEnteredInFoodics(read.body.id, employee.id, read.body.entered);
    return NextResponse.json({ ok: true, changed: done });
  } catch (e) {
    return failWith(e, "team-invoice");
  }
}
