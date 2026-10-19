/**
 * روابطُ تصوير الفريق — للمالك وحده (`users:manage`).
 *
 *   POST { action: "create", label } → { id, token }   (الرمزُ يُرى مرّةً واحدة)
 *   POST { action: "revoke", id }    → { ok }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { failWith, guard, respondTo } from "@/services/guard";
import { createLink, revokeLink } from "@/services/capture.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), label: z.string().trim().min(1, "اكتب اسم الموظف").max(60) }).strict(),
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(64) }).strict(),
]);

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("capture-link", "users:manage");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  try {
    if (read.body.action === "create") return NextResponse.json(await createLink(read.body.label, user.id));
    const done = await revokeLink(read.body.id, user.id);
    if (!done) return NextResponse.json({ error: "هذا الرابط أُلغي من قبل. حدّث الصفحة" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failWith(e, "capture-link");
  }
}
