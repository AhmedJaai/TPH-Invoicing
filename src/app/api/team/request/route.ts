/**
 * طلبُ الموظّف من «TPH Team» — بلا جلسة، ورمزُه إذنُه.
 *
 *   POST { token, action: "create", request: {kind…} } → { id }
 *   POST { token, action: "withdraw", id }
 *
 * لا يُنفَّذ شيءٌ منه: يُحفظ «ينتظر» حتى يقرّه صاحبُ المقهى (`team-board.service.ts` · `decideRequest`).
 * والكمّيّةُ تصل نصّاً وتُقرأ مِلّيّاتٍ هنا.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { Day } from "@/lib/payroll/request";
import { parseQuantityMilli } from "@/lib/sales/values";
import { failWith } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { resolveCheckinToken } from "@/services/payroll.service";
import { createRequest, TeamRequestRefused, withdrawRequest } from "@/services/team-board.service";

export const runtime = "nodejs";

const Note = z.string().trim().max(1000).optional().transform((v) => v || null);
const Request = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BOARD_EDIT"), boardId: z.string().min(1).max(64), proposedTitle: z.string().max(120).optional(), proposedBody: z.string().max(4000), note: Note }).strict(),
  z.object({ kind: z.literal("SWAP"), fromDay: Day, toDay: Day, withEmployeeId: z.string().min(1).max(64), note: Note }).strict(),
  z.object({ kind: z.literal("WASTE"), productId: z.string().min(1).max(64), quantity: z.string().trim().min(1).max(20), unit: z.string().max(10), wasteReason: z.enum(["EXPIRED", "SPILLED", "FAILED_PREP", "DAMAGED", "OTHER"]), note: Note }).strict(),
]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), token: z.string().trim().min(24).max(64), request: Request }).strict(),
  z.object({ action: z.literal("withdraw"), token: z.string().trim().min(24).max(64), id: z.string().min(1).max(64) }).strict(),
]);

export async function POST(request: Request) {
  try {
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    const employee = await resolveCheckinToken(b.token);
    if (!employee) return NextResponse.json({ error: "هذا الرابط لم يعد يعمل. اطلب رابطاً جديداً من الإدارة." }, { status: 404 });
    await consume("team-request", employee.id);
    if (b.action === "withdraw") {
      const done = await withdrawRequest(employee.id, b.id);
      return NextResponse.json({ ok: true, message: done ? "سُحب الطلب" : "لم يعد ينتظر" });
    }
    const r = b.request;
    if (r.kind === "WASTE") {
      const quantityMilli = parseQuantityMilli(r.quantity);
      if (quantityMilli === null || quantityMilli <= 0) return NextResponse.json({ error: "اكتب الكمية رقماً، مثل 2 أو 0.5" }, { status: 400 });
      const id = await createRequest(employee.id, { kind: "WASTE", productId: r.productId, quantityMilli, unit: r.unit, wasteReason: r.wasteReason, note: r.note });
      return NextResponse.json({ ok: true, id });
    }
    const id = await createRequest(employee.id, r.kind === "BOARD_EDIT" ? { ...r, proposedTitle: r.proposedTitle ?? null } : r);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof TeamRequestRefused) return NextResponse.json({ error: e.message }, { status: 400 });
    return failWith(e, "team-request");
  }
}
