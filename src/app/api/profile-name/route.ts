/**
 * اسمُك كما يظهر — في التحيّة وسجلّ التدقيق والإشعارات. يكتبه صاحبُه لنفسه وحده.
 *
 * الاسمُ يأتي من حساب جوجل مرّةً عند أوّل دخول («Ahmed»)، فتقول التحيّةُ العربيّة «صباح الخير، Ahmed».
 * وما يُكتب هنا يبقى: الدخولُ لا يكتب الاسمَ ثانيةً.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { readJson } from "@/lib/request-body";
import { recordAudit } from "@/lib/audit";
import { guard, respondTo } from "@/services/guard";

export const runtime = "nodejs";

const Body = z.object({ name: z.string().trim().min(2, "اكتب اسماً من حرفين على الأقل").max(60, "الاسم أطول من ستين حرفاً") }).strict();

export async function POST(request: Request) {
  try {
    /* كتابةٌ لا تُحرس بصلاحية قراءة: من يرفع مستنداً (المالكُ والمشتريات) — والأدوارُ القارئة وحدها لا تكتب شيئاً */
    const user = await guard("profile-name", "document:upload");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const name = read.body.name.replace(/\s+/g, " ");
    await db.transaction(async (t) => {
      const [before] = await t.select({ name: users.name }).from(users).where(eq(users.id, user.id)).limit(1);
      await t.update(users).set({ name }).where(eq(users.id, user.id));
      await recordAudit({ actorId: user.id, action: "USER_NAME_SET", entityType: "user", entityId: user.id, before: { الاسم: before?.name ?? null }, after: { الاسم: name } }, t);
    });
    return NextResponse.json({ ok: true, message: "حُفظ اسمك" });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
