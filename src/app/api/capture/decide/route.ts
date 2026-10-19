/**
 * رفضُ صورةٍ من الفريق بسببها — ويراه مرسلُها في صفحته.
 *
 *   POST { id, reason } → { ok }
 *
 * والاعتمادُ ليس هنا: الصورةُ تُعتمد بالأرشفة المعتادة (`/api/archive` بـ`captureId`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { failWith, guard, respondTo } from "@/services/guard";
import { rejectCapture } from "@/services/capture.service";

export const runtime = "nodejs";

const Body = z.object({
  id: z.string().min(1).max(64),
  reason: z.string().trim().min(2, "اكتب سبب الرفض ليعرفه من صوّرها").max(300),
}).strict();

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("capture-decide", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  try {
    const done = await rejectCapture(read.body.id, read.body.reason, user.id);
    if (!done) return NextResponse.json({ error: "هذه الصورة حُسمت من قبل. حدّث الصفحة" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failWith(e, "capture-decide");
  }
}
