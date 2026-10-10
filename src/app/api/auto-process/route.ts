/**
 * يوقف العملَ الآليّ في الخلفيّة أو يشغّله — بيد من يملك الاعتماد.
 * الحالُ في القاعدة لا في المتصفّح: يسري على كلّ جهاز.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { can } from "@/lib/permissions";
import { guard, respondTo } from "@/services/guard";
import { setAutoPaused } from "@/services/auto-process.service";

export const runtime = "nodejs";

const Body = z.object({ paused: z.boolean() }).strict();

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("auto-process", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  /* العملُ الآليّ يقيّد مبالغَ ويعتمدها — فضابطُه لمن يراها، كالاعتماد نفسه */
  if (!can(user.role, "amounts:view")) {
    return NextResponse.json({ error: "إيقافُ العمل الآليّ يحتاج صلاحية عرض المبالغ" }, { status: 403 });
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;

  await setAutoPaused(read.body.paused, user.id);
  return NextResponse.json({
    ok: true,
    paused: read.body.paused,
    message: read.body.paused
      ? "أُوقف العمل الآليّ — لا يُقيَّد ولا يُعتمَد شيءٌ في الخلفيّة حتى تشغّله"
      : "عاد العمل الآليّ — يُقيَّد ويُعتمَد ما تجتمع فيه الشروط",
  });
}
