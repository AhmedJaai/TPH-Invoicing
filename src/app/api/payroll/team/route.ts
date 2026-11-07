/**
 * «TPH Team» عند صاحب المقهى: المرجعُ (يكتبه ويعدّله ويُخرجه)، وطلباتُ الموظّفين (يقرّها أو يردّها)،
 * ونشرُ قسائم الشهر في تطبيقهم.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { Id, Month } from "@/lib/payroll/request";
import { formatMonth } from "@/lib/riyadh-time";
import { failWith, guard } from "@/services/guard";
import { PayrollRefused, setSlipsPublished } from "@/services/payroll.service";
import { decideRequest, isBoardKind, saveBoardItem, setBoardArchived, TeamRequestRefused } from "@/services/team-board.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("board-save"), id: Id.nullable(), kind: z.string().refine(isBoardKind, "نوع غير معروف"),
    title: z.string().max(120), body: z.string().max(4000), weekday: z.number().int().min(0).max(6).nullable(), sort: z.number().int().min(0).max(9999).default(0),
  }).strict(),
  z.object({ action: z.literal("board-archive"), id: Id }).strict(),
  z.object({ action: z.literal("board-restore"), id: Id }).strict(),
  z.object({ action: z.literal("decide"), id: Id, approve: z.boolean(), note: z.string().max(500).optional() }).strict(),
  z.object({ action: z.literal("publish"), month: Month, published: z.boolean() }).strict(),
]);

export async function POST(request: Request) {
  try {
    const user = await guard("payroll-team", "payroll:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    switch (b.action) {
      case "board-save": {
        if (!isBoardKind(b.kind)) return NextResponse.json({ error: "نوع غير معروف" }, { status: 400 });
        const id = await saveBoardItem(b.id, { kind: b.kind, title: b.title, body: b.body, weekday: b.weekday, sort: b.sort }, user.id);
        return NextResponse.json({ ok: true, id, message: "حُفظ في المرجع، ويراه الفريق الآن" });
      }
      case "board-archive":
      case "board-restore": {
        const done = await setBoardArchived(b.id, b.action === "board-archive", user.id);
        return NextResponse.json({ ok: true, message: !done ? "لا تغيير" : b.action === "board-archive" ? "أُخرجت من المرجع" : "عادت إلى المرجع" });
      }
      case "decide": {
        const done = await decideRequest(b.id, b.approve, b.note ?? null, user.id);
        return NextResponse.json({ ok: true, message: !done ? "قُرّر فيه من قبل" : b.approve ? "اعتُمد، ونُفّذ" : "رُفض، ويرى الموظف ذلك" });
      }
      case "publish": {
        await setSlipsPublished(b.month, b.published, user.id);
        return NextResponse.json({ ok: true, message: b.published ? `يرى كل موظف قسيمة ${formatMonth(b.month)} في تطبيقه` : "أُخفيت القسائم" });
      }
    }
  } catch (e) {
    if (e instanceof TeamRequestRefused || e instanceof PayrollRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    return failWith(e, "payroll-team");
  }
}
