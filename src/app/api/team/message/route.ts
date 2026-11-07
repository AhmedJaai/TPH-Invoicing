/**
 * رسالةُ الموظّف للإدارة من «TPH Team» — بلا جلسة، ورمزُه إذنُه.
 *
 *   POST { token, kind: SUGGESTION|COMPLAINT|OTHER, body, anonymous } → { id }
 *
 * لا يملك الرابطُ إلّا أن يضيف رسالةً. والمرسَلةُ بلا اسم لا يُحفظ معها صاحبُها (`team.service.ts`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { failWith } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { resolveCheckinToken } from "@/services/payroll.service";
import { sendTeamMessage, TEAM_MESSAGE_MAX, TeamMessageRefused } from "@/services/team.service";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().trim().min(24).max(64),
  kind: z.enum(["SUGGESTION", "COMPLAINT", "OTHER"]),
  body: z.string().max(TEAM_MESSAGE_MAX + 200),
  anonymous: z.boolean().default(false),
}).strict();

export async function POST(request: Request) {
  try {
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    const employee = await resolveCheckinToken(b.token);
    if (!employee) return NextResponse.json({ error: "هذا الرابط لم يعد يعمل. اطلب رابطاً جديداً من المدير." }, { status: 404 });
    await consume("team-message", employee.id);
    const id = await sendTeamMessage({ employeeId: employee.id, kind: b.kind, body: b.body, anonymous: b.anonymous });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof TeamMessageRefused) return NextResponse.json({ error: e.message }, { status: 400 });
    return failWith(e, "team-message");
  }
}
