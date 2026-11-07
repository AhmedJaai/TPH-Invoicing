/**
 * رسائلُ الفريق عند صاحب المقهى: قرأها · ردّ عليها · أغلقها أو أعاد فتحها.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { Id } from "@/lib/payroll/request";
import { failWith, guard } from "@/services/guard";
import { markTeamMessageRead, replyToTeamMessage, setTeamMessageClosed, TEAM_REPLY_MAX, TeamMessageRefused } from "@/services/team.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), id: Id }).strict(),
  z.object({ action: z.literal("reply"), id: Id, reply: z.string().max(TEAM_REPLY_MAX + 100) }).strict(),
  z.object({ action: z.literal("close"), id: Id }).strict(),
  z.object({ action: z.literal("reopen"), id: Id }).strict(),
]);

export async function POST(request: Request) {
  try {
    const user = await guard("team-messages", "payroll:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    switch (b.action) {
      case "read": {
        await markTeamMessageRead(b.id, user.id);
        return NextResponse.json({ ok: true, message: "عُلّمت مقروءة" });
      }
      case "reply": {
        const r = await replyToTeamMessage(b.id, b.reply, user.id);
        return NextResponse.json({ ok: true, message: r.toEmployee ? "أُرسل الرد، ويراه الموظف في تطبيقه" : "حُفظ الرد. الرسالة بلا اسم فلن يصل لأحد" });
      }
      case "close":
      case "reopen": {
        const done = await setTeamMessageClosed(b.id, b.action === "close", user.id);
        return NextResponse.json({ ok: true, message: !done ? "لا تغيير" : b.action === "close" ? "أُغلقت الرسالة" : "أُعيد فتحها" });
      }
    }
  } catch (e) {
    if (e instanceof TeamMessageRefused) return NextResponse.json({ error: e.message }, { status: 400 });
    return failWith(e, "team-messages");
  }
}
