/**
 * اشتراكاتُ إشعار الصباح وإرسالُه — خاملٌ كلُّه ما لم يوجد المفتاحان (`pushConfig`).
 *
 * الإشعارُ نداءٌ فارغ إلى مزوّد المتصفّح (`lib/push/web-push.ts`)، وعاملُ الخدمة يسأل
 * `/api/push/brief` بجلسة صاحبه عن نصّه. فلا رقمَ يمرّ بالمزوّد، ومن انتهت جلستُه يرى
 * «افتح التطبيق» لا أرقاماً قديمة.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";
import { can } from "@/lib/permissions";
import { isPushEndpoint, pushConfig, pushOutcome, pushRequest } from "@/lib/push/web-push";

/** المفتاحُ العامّ للمتصفّح — `null`: الإشعارُ غير مفعّل على الخادم. */
export function pushPublicKey(): string | null {
  return pushConfig(process.env)?.publicKey ?? null;
}

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export class PushUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushUnavailableError";
  }
}

/** جهازٌ يشترك — والعنوانُ نفسُه من حسابٍ آخر (جهازٌ تبدّل صاحبه) ينتقل إليه. */
export async function saveSubscription(userId: string, sub: SubscriptionInput, userAgent: string | null): Promise<void> {
  if (!pushConfig(process.env)) throw new PushUnavailableError("إشعار الصباح غير مفعّل على الخادم بعد.");
  if (!isPushEndpoint(sub.endpoint)) throw new PushUnavailableError("هذا المتصفح يستعمل خدمة إشعارات غير معروفة، فلا يُشترك منه.");
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent, failures: 0, lastError: null },
    });
}

/** يوقفه صاحبُه — من جهازه، فلا يُمسّ اشتراكُ غيره. */
export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export type MorningPushResult = { enabled: false } | { enabled: true; sent: number; gone: number; failed: number };

/**
 * إحاطةُ الصباح إلى كلّ جهازٍ مشترك لمن يرى المبالغ وحسابُه فعّال — مرّةً، من التشغيل
 * اليوميّ (`dailyCronJob`). وما انتهى اشتراكُه (٤٠٤/٤١٠) يُمحى، وما تعذّر يُعدّ ويُعاد غداً.
 */
export async function sendMorningPush(fetchImpl: typeof fetch = fetch, now = new Date()): Promise<MorningPushResult> {
  const config = pushConfig(process.env);
  if (!config) return { enabled: false };

  const rows = await db
    .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, role: users.role })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .where(eq(users.isActive, true));

  let sent = 0, gone = 0, failed = 0;
  for (const row of rows) {
    if (!can(row.role, "amounts:view") || !isPushEndpoint(row.endpoint)) continue;
    let status = 0;
    let error: string | null = null;
    try {
      const res = await fetchImpl(row.endpoint, { ...pushRequest(row.endpoint, config, now), signal: AbortSignal.timeout(10_000) });
      status = res.status;
      if (status >= 300) error = `ردّ مزوّد الإشعار ${status}`;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 160) : "تعذّر الاتصال بمزوّد الإشعار";
    }
    const outcome = status ? pushOutcome(status) : "failed";
    if (outcome === "sent") {
      sent++;
      await db.update(pushSubscriptions).set({ lastSentAt: now, failures: 0, lastError: null }).where(eq(pushSubscriptions.id, row.id));
    } else if (outcome === "gone") {
      gone++;
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
    } else {
      failed++;
      await db.update(pushSubscriptions)
        .set({ failures: sql`${pushSubscriptions.failures} + 1`, lastError: error })
        .where(eq(pushSubscriptions.id, row.id));
    }
  }
  return { enabled: true, sent, gone, failed };
}
