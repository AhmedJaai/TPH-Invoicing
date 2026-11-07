/**
 * جردُ السبت من «TPH Team» — بلا جلسة، ورمزُ الموظّف إذنُه، ولا يعمل إلّا لمن أذن له المالك.
 *
 *   POST { token, action: "start" }                         → يبدأ جردَ هذا السبت إن لم يُبدأ
 *   POST { token, action: "save", countId, entries: [{productId, quantity, unit}] }
 *
 * الكمّيّةُ تصل نصّاً وتُقرأ مِلّيّاتٍ هنا، والتحويلُ إلى وحدة الصنف في الخادم. والأسبوعُ يُشتقّ
 * من يوم الرياض لا من المتصفّح (`team-count.service.ts`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { parseQuantityMilli } from "@/lib/sales/values";
import { isAmbiguousThousands, ambiguousThousandsMessage } from "@/lib/inventory/units";
import { isStoredUnit, type StoredUnit } from "@/lib/unit-conversion";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { failWith, respondTo } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { resolveCheckinToken } from "@/services/payroll.service";
import { saveTeamCount, startTeamCount } from "@/services/team-count.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const Token = z.string().trim().min(24).max(64);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), token: Token }).strict(),
  z.object({
    action: z.literal("save"), token: Token, countId: z.string().min(1).max(64),
    entries: z.array(z.object({
      productId: z.string().min(1).max(64),
      /** الفراغُ يمسح العدّ فيعود «لم يُعَدّ» — لا صفراً. */
      quantity: z.string().trim().max(20),
      unit: z.custom<StoredUnit>(isStoredUnit, "وحدة غير معروفة"),
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

    const entries = [];
    for (const e of b.entries) {
      if (e.quantity !== "" && isAmbiguousThousands(e.quantity)) return NextResponse.json({ error: ambiguousThousandsMessage(e.quantity) }, { status: 400 });
      const milli = e.quantity === "" ? null : parseQuantityMilli(e.quantity);
      if (e.quantity !== "" && (milli === null || milli < 0)) return NextResponse.json({ error: `«${e.quantity}» ليس رقماً. اكتب مثل 2 أو 0.5` }, { status: 400 });
      entries.push({ productId: e.productId, milli, unit: e.unit });
    }
    const saved = await saveTeamCount(today, b.countId, entries, by);
    return NextResponse.json({ ok: true, saved, message: saved === 1 ? "حُفظ عدّ صنف واحد" : `حُفظ عدّ ${saved} أصناف` });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return failWith(e, "team-count");
  }
}
