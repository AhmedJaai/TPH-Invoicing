/**
 * إعدادُ الحضور: موقعُ المقهى ونصفُ قطره، وشبكتُه (عنوانُ من يضغط وهو على الواي فاي)،
 * والحكمُ في تسجيلٍ مشكوك.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { clientIp, toMicro } from "@/lib/payroll/attendance";
import { Id } from "@/lib/payroll/request";
import { failWith, guard } from "@/services/guard";
import { PayrollRefused, reviewCheckin, saveCafeNetwork, saveCafePlace } from "@/services/payroll.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("place"), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().int().min(30).max(1000).optional() }).strict(),
  z.object({ action: z.literal("place-clear") }).strict(),
  z.object({ action: z.literal("network") }).strict(),
  z.object({ action: z.literal("network-clear") }).strict(),
  z.object({ action: z.literal("review"), id: Id, decision: z.enum(["ACCEPTED", "REJECTED"]), manipulation: z.boolean().optional() }).strict(),
]);

export async function POST(request: Request) {
  try {
    const user = await guard("payroll-attendance", "payroll:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    switch (b.action) {
      case "place":
        await saveCafePlace({ latMicro: toMicro(b.lat), lngMicro: toMicro(b.lng), radiusM: b.radiusM ?? null }, user.id);
        return NextResponse.json({ ok: true, message: "حُفظ موقع المقهى" });
      case "place-clear":
        await saveCafePlace(null, user.id);
        return NextResponse.json({ ok: true, message: "أُزيل موقع المقهى" });
      case "network": {
        const ip = clientIp(request.headers);
        if (!ip) return NextResponse.json({ error: "تعذّرت قراءة عنوان الشبكة. جرّب من الجوال وهو على واي فاي المقهى" }, { status: 400 });
        await saveCafeNetwork(ip, user.id);
        return NextResponse.json({ ok: true, message: "حُفظت شبكة المقهى. من يسجّل وهو عليها يُعدّ في المقهى" });
      }
      case "network-clear":
        await saveCafeNetwork(null, user.id);
        return NextResponse.json({ ok: true, message: "أُزيلت شبكة المقهى" });
      case "review": {
        const done = await reviewCheckin(b.id, b.decision, user.id, b.manipulation === true);
        return NextResponse.json({ ok: true, message: !done ? "لم يُوجد التسجيل" : b.decision === "ACCEPTED" ? "قُبل التسجيل" : b.manipulation ? "رُدّ التسجيل، وسُجّلت مخالفة التلاعب في الحضور" : "رُدّ التسجيل، وسقط ما حُسب منه" });
      }
    }
  } catch (e) {
    if (e instanceof PayrollRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    return failWith(e, "payroll-attendance");
  }
}
