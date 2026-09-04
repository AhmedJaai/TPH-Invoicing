/**
 * تطبيق حدّ الطلبات على القاعدة.
 *
 * العدّ خطوة واحدة: `insert … on conflict do update set count = count + 1`
 * ثمّ يُقارَن الراجع بالحدّ. فلا يقع سباق بين قراءة وكتابة، ولا يفلت طلبان
 * متزامنان من العدّ.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { decide, ruleFor, windowStart, type RateLimitDecision } from "@/lib/rate-limit";

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

/**
 * يعدّ الطلب ويقرّر.
 * يرمي `RateLimitedError` عند التجاوز.
 */
export async function consume(route: string, actorId: string): Promise<RateLimitDecision> {
  const rule = ruleFor(route);
  const now = new Date();
  const start = windowStart(now, rule.windowSeconds);
  const key = `${route}:${actorId}`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const decision = decide(Number(row?.count ?? 1), rule, now);

  await sweep(new Date(now.getTime() - rule.windowSeconds * 4000));

  if (!decision.allowed) throw new RateLimitedError(decision, route);
  return decision;
}

/** يُستعمل في الاختبار والتشخيص. */
export async function currentCount(route: string, actorId: string): Promise<number> {
  const rule = ruleFor(route);
  const start = windowStart(new Date(), rule.windowSeconds);
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, `${route}:${actorId}`), eq(rateLimits.windowStart, start)))
    .limit(1);
  return Number(row?.count ?? 0);
}
