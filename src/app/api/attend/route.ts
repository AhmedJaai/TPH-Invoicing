/**
 * تسجيلُ الحضور والانصراف من رابط الموظّف — بلا جلسة، والرمزُ إذنُه.
 *
 *   POST { token, kind: IN|OUT, lat?, lng?, accuracy? } → { verdict, at, lateMinutes, earlyMinutes }
 *
 * لا يملك الرابطُ إلّا أن يضيف تسجيلاً لصاحبه: لا يرى راتباً ولا غيره. والموقعُ اختياريّ — يُحفظ
 * التسجيلُ بلا موقعٍ ويُعرض على صاحب المقهى ليحكم فيه.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { clientIp, toMicro } from "@/lib/payroll/attendance";
import { failWith } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { PayrollRefused, recordCheckin, resolveCheckinToken } from "@/services/payroll.service";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().trim().min(24).max(64),
  kind: z.enum(["IN", "OUT"]),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(100_000).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    const employee = await resolveCheckinToken(b.token);
    if (!employee) return NextResponse.json({ error: "هذا الرابط لم يعد يعمل. اطلب رابطاً جديداً من المدير." }, { status: 404 });
    await consume("attend", employee.id);
    const position = b.lat !== undefined && b.lng !== undefined
      ? { latMicro: toMicro(b.lat), lngMicro: toMicro(b.lng), accuracyM: b.accuracy !== undefined ? Math.round(b.accuracy) : null }
      : null;
    const r = await recordCheckin({ employee, kind: b.kind, position, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") });
    return NextResponse.json({ ok: true, verdict: r.verdict, at: r.at.toISOString(), lateMinutes: r.lateMinutes, earlyMinutes: r.earlyMinutes, duplicate: r.duplicate });
  } catch (e) {
    if (e instanceof PayrollRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    return failWith(e, "attend");
  }
}
