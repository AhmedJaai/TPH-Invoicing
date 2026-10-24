/**
 * اشتراكُ هذا الجهاز في إشعار الصباح، وإيقافُه.
 *
 *   POST { action: "subscribe", subscription: { endpoint, keys: { p256dh, auth } } }
 *   POST { action: "unsubscribe", endpoint }
 *
 * بصلاحية `amounts:view` — الإحاطةُ لمن يرى «اليوم». وخاملٌ بلا مفاتيح VAPID: يُردّ
 * ٤٠٩ بسببه ولا يُكتب شيء (`saveSubscription`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { PushUnavailableError, removeSubscription, saveSubscription } from "@/services/push.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("subscribe"),
    subscription: z.object({
      endpoint: z.string().url().max(1000),
      keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
    }),
  }),
  z.object({ action: z.literal("unsubscribe"), endpoint: z.string().url().max(1000) }),
]);

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("push", "amounts:view");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "تعذّرت قراءة طلب الإشعار. حدّث الصفحة وأعد المحاولة." }, { status: 400 });
  const body = parsed.data;

  if (body.action === "unsubscribe") {
    await removeSubscription(user.id, body.endpoint);
    return NextResponse.json({ ok: true, message: "أُوقف إشعار الصباح على هذا الجهاز." });
  }
  try {
    await saveSubscription(
      user.id,
      { endpoint: body.subscription.endpoint, p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth },
      request.headers.get("user-agent")?.slice(0, 300) ?? null,
    );
  } catch (e) {
    if (e instanceof PushUnavailableError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  return NextResponse.json({ ok: true, message: "فُعّل إشعار الصباح على هذا الجهاز." });
}
