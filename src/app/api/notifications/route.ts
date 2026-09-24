/**
 * مركزُ الإشعارات: ما تغيّر منذ آخر مرّة، وملخّصُ اليوم.
 *
 *   GET  ← القائمةُ وعددُ الجديد والملخّص
 *   POST { action: "seen" } ← «علّم الكلّ مقروءاً»
 *
 * الإشعاراتُ تُشتقّ ولا تُخزَّن (`notifications.service.ts`)، والمكتوبُ
 * حدُّ القراءة وحده — لا مال ولا قرار.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { loadNoticeFeed, markNoticesSeen } from "@/services/notifications.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await guard("notifications", "document:view");
    return NextResponse.json(await loadNoticeFeed(user));
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    console.error("[notifications] GET", e);
    return NextResponse.json({ error: "تعذّر تحميل الإشعارات. أعد المحاولة بعد لحظة." }, { status: 500 });
  }
}

const Body = z.object({ action: z.literal("seen") });

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("notifications", "document:view");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  let parsed;
  try {
    parsed = Body.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب." }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: "الطلب غير مفهوم." }, { status: 400 });
  try {
    const seenAt = await markNoticesSeen(user.id);
    return NextResponse.json({ seenAt });
  } catch (e) {
    console.error("[notifications] POST", e);
    return NextResponse.json({ error: "تعذّر حفظ القراءة — لم يتغيّر شيء." }, { status: 500 });
  }
}
