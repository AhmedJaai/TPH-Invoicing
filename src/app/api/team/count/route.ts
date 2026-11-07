/**
 * جردُ السبت من «TPH Team» — بلا جلسة، ورمزُ الموظّف إذنُه، ولا يعمل إلّا لمن أذن له المالك.
 *
 *   POST { token, action: "start" }                         → يبدأ جردَ هذا السبت إن لم يُبدأ
 *   POST { token, action: "save", countId, entries: [{productId, parts: [{key, quantity}]}] }
 *   POST { token, action: "send", countId }                → { text, phone } يفتحه في واتساب
 *
 * الخاناتُ (كرتون · حبّة · كيلو · جرام…) تصل نصّاً، ويجمعها الخادمُ بوحدة الصنف ووحدة تخزينه. والأسبوعُ يُشتقّ
 * من يوم الرياض لا من المتصفّح (`team-count.service.ts`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { isStoredUnit } from "@/lib/unit-conversion";
import type { PartKey } from "@/lib/inventory/count-parts";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { failWith, respondTo } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { resolveCheckinToken } from "@/services/payroll.service";
import { saveTeamCount, sendTeamCount, startTeamCount } from "@/services/team-count.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const Token = z.string().trim().min(24).max(64);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), token: Token }).strict(),
  z.object({ action: z.literal("send"), token: Token, countId: z.string().min(1).max(64) }).strict(),
  z.object({
    action: z.literal("save"), token: Token, countId: z.string().min(1).max(64),
    entries: z.array(z.object({
      productId: z.string().min(1).max(64),
      /** كلُّ الخانات فارغةً تمسح العدّ فيعود «لم يُعَدّ» — لا صفراً. */
      parts: z.array(z.object({
        key: z.custom<PartKey>((v) => v === "STORAGE" || isStoredUnit(v), "وحدة غير معروفة"),
        quantity: z.string().trim().max(20),
      }).strict()).max(4),
    }).strict()).min(1).max(500),
  }).strict(),
]);

export async function POST(request: Request) {
  try {
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    const employee = await resolveCheckinToken(b.token);
    if (!employee) return NextResponse.json({ error: "هذا الرابط لم يعد يعمل. اطلب رابطاً جديداً من الإدارة." }, { status: 404 });
    if (!employee.canCountInventory) return NextResponse.json({ error: "الجرد ليس من صلاحيات رابطك. اطلبه من الإدارة." }, { status: 403 });
    await consume("team-count", employee.id);
    const by = { employeeId: employee.id, name: employee.name };
    const today = todayInRiyadh();

    if (b.action === "start") {
      const countId = await startTeamCount(today, by);
      return NextResponse.json({ ok: true, countId, message: "بدأ جرد السبت. اكتب ما تجده على الرف." });
    }

    if (b.action === "send") {
      const { text, phone } = await sendTeamCount(today, b.countId, by);
      return NextResponse.json({ ok: true, text, phone });
    }

    const saved = await saveTeamCount(today, b.countId, b.entries, by);
    return NextResponse.json({ ok: true, saved, message: saved === 1 ? "حُفظ عدّ صنف واحد" : `حُفظ عدّ ${saved} أصناف` });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return failWith(e, "team-count");
  }
}
