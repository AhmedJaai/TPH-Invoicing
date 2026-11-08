/**
 * اشتراكُ جوال الموظّف في تنبيه «TPH Team» — بلا جلسة، ورمزُه إذنُه.
 *
 *   GET → { publicKey }   ·   POST { token, endpoint, p256dh, auth } → { ok }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { failWith } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { pushPublicKey } from "@/services/push.service";
import { resolveCheckinToken } from "@/services/payroll.service";
import { saveTeamSubscription } from "@/services/team-invoices.service";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().trim().min(24).max(64),
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(10).max(200),
  auth: z.string().min(8).max(100),
}).strict();

export async function POST(request: Request) {
  try {
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const employee = await resolveCheckinToken(read.body.token);
    if (!employee) return NextResponse.json({ error: "هذا الرابط لم يعد يعمل." }, { status: 404 });
    await consume("team-push", employee.id);
    try {
      await saveTeamSubscription(employee.id, read.body, request.headers.get("user-agent")?.slice(0, 300) ?? null);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "تعذّر تفعيل التنبيه." }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failWith(e, "team-push");
  }
}

export async function GET() {
  return NextResponse.json({ publicKey: pushPublicKey() }, { headers: { "cache-control": "no-store" } });
}
