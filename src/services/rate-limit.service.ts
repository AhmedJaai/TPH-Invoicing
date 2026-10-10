/**
 * تطبيق حدّ الطلبات على القاعدة.
 *
 * العدّ خطوة واحدة: `insert … on conflict do update set count = count + 1`
 * ثمّ يُقارَن الراجع بالحدّ. فلا يقع سباق بين قراءة وكتابة، ولا يفلت طلبان
 * متزامنان من العدّ.
 */
import { lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import {
  decide, isUnlimited, MEMORY_COUNTED_ROUTES, MemoryWindowCounter, ruleFor, windowStart, type RateLimitDecision,
} from "@/lib/rate-limit";

/** خطأ يُترجم في الواجهة إلى ٤٢٩. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;
  readonly limit: number;
  constructor(decision: RateLimitDecision, route: string) {
    super(
      `تجاوزتَ حدّ الاستعمال لهذه العملية (${decision.limit} في الساعة). ` +
        `أعد المحاولة بعد ${Math.ceil(decision.retryAfterSeconds / 60)} دقيقة.`,
    );
    this.name = "RateLimitedError";
    this.retryAfterSeconds = decision.retryAfterSeconds;
    this.limit = decision.limit;
    void route;
  }
}

/** تنظيف النوافذ المنقضية — رخيص ويجري أحياناً لا في كل طلب. */
async function sweep(before: Date): Promise<void> {
  if (Math.random() > 0.02) return;
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, before));
}

/** عدُّ القراءات الرخيصة — في ذاكرة هذه النسخة من الدالّة. */
const cheapReads = new MemoryWindowCounter();
/** مَن ردّته القاعدةُ في نافذته الجارية — يُردّ تاليه بلا كتابة. */
const alreadyBlocked = new MemoryWindowCounter();

/**
 * يعدّ الطلب ويقرّر.
 * يرمي `RateLimitedError` عند التجاوز.
 *
 * ثلاثةُ طرق، والقاعدةُ لما يكلّف وحده:
 *   • بلا حدّ (المزامنة، بقرار أحمد): لا يُعدّ — عدُّ ما لا يُرفَض كتابةٌ بلا نفع.
 *   • قراءةٌ رخيصة (الجرس والبحث): تُعدّ في الذاكرة.
 *   • ما سواهما: في القاعدة — ومن رُدّ مرّةً في نافذته لا يكتب المردودُ بعده صفّاً
 *     (كان كلُّ طلبٍ مرفوض يزيد العدّاد في Neon، فالحلقةُ العالقة تكتب وهي تُرَدّ).
 */
export async function consume(route: string, actorId: string): Promise<RateLimitDecision> {
  const rule = ruleFor(route);
  const now = new Date();
  const start = windowStart(now, rule.windowSeconds);
  const key = `${route}:${actorId}`;

  if (isUnlimited(rule)) return decide(0, rule, now);

  if (MEMORY_COUNTED_ROUTES.has(route)) {
    const decision = decide(cheapReads.hit(key, rule, now), rule, now);
    if (!decision.allowed) throw new RateLimitedError(decision, route);
    return decision;
  }

  const blockedAt = alreadyBlocked.peek(key, rule, now);
  if (blockedAt > rule.limit) throw new RateLimitedError(decide(blockedAt, rule, now), route);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = Number(row?.count ?? 1);
  const decision = decide(count, rule, now);

  await sweep(new Date(now.getTime() - rule.windowSeconds * 4000));

  if (!decision.allowed) {
    alreadyBlocked.remember(key, rule, now, count);
    throw new RateLimitedError(decision, route);
  }
  return decision;
}
