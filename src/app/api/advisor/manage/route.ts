/**
 * خطّةُ المستشار ومحادثاتُه بيد صاحب المقهى: بندٌ أُنجز أو تُرك أو أُعيد، ومحادثةٌ تُحذف.
 * نصٌّ لا مال — والحذفُ لمحادثةٍ لا لقيد.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { deleteThread, setPlanStatus } from "@/services/advisor.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), id: z.string().min(1).max(64), status: z.enum(["OPEN", "DONE", "DROPPED"]) }).strict(),
  z.object({ kind: z.literal("delete-thread"), id: z.string().min(1).max(64) }).strict(),
]);

export async function POST(request: Request) {
  try {
    await guard("advisor-plan", "month:close");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    if (b.kind === "plan") {
      const ok = await setPlanStatus(b.id, b.status);
      if (!ok) return NextResponse.json({ error: "البند لم يعد موجوداً. حدّث الصفحة" }, { status: 404 });
      return NextResponse.json({ ok: true, message: b.status === "DONE" ? "أُنجز البند" : b.status === "DROPPED" ? "تُرك البند" : "أُعيد البند مفتوحاً" });
    }
    const ok = await deleteThread(b.id);
    if (!ok) return NextResponse.json({ error: "المحادثة لم تعد موجودة. حدّث الصفحة" }, { status: 404 });
    return NextResponse.json({ ok: true, message: "حُذفت المحادثة" });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
