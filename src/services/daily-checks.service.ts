/**
 * فحوصُ الصباح (`daily_checks`) — ما يجده التشغيلُ اليوميّ صفّاً لكلّ فحص، تقرؤه «يحتاج قرارك».
 *
 * فحصٌ يسأل مزوّداً خارجيّاً أو يعيد حسابَ كلّ شهرٍ مقفل لا يجري مع كلّ صفحة: الشريطُ يعدّ
 * البنودَ في كلّ رسم. فيجري مرّةً في الصباح (`/api/cron/daily`)، ويُقرأ آخرُ ما وجده.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dailyChecks } from "@/db/schema";
import { balanceIsLow, type AiBalance } from "@/lib/ai/balance";
import { fetchDeepseekBalance } from "@/lib/ai/deepseek";
import type { Conn } from "./types";

export type DailyCheckKind = "SEAL_DRIFT" | "AI_BALANCE";

export async function recordDailyCheck(kind: DailyCheckKind, payload: unknown, conn: Conn = db): Promise<void> {
  await conn.insert(dailyChecks).values({ kind, payload, checkedAt: new Date() });
}

export async function latestDailyCheck(kind: DailyCheckKind, conn: Conn = db): Promise<{ payload: unknown; checkedAt: Date } | null> {
  const [row] = await conn.select({ payload: dailyChecks.payload, checkedAt: dailyChecks.checkedAt })
    .from(dailyChecks).where(eq(dailyChecks.kind, kind))
    .orderBy(desc(dailyChecks.checkedAt)).limit(1);
  return row ?? null;
}

/** يسأل المزوّدَ عن رصيده ويحفظ الجواب — والمجهولُ يُحفظ مجهولاً بسببه. */
export async function checkAiBalance(fetchBalance: () => Promise<AiBalance> = fetchDeepseekBalance, conn: Conn = db): Promise<AiBalance> {
  const balance = await fetchBalance();
  await recordDailyCheck("AI_BALANCE", balance, conn);
  return balance;
}

/** فحصٌ أقدم من يومين لا يُنذر — لا يُقال «ينفد» عن رصيدٍ لم يُسأل عنه منذ أيّام. */
const AI_CHECK_FRESH_MS = 48 * 60 * 60_000;

export interface LowAiBalance {
  cents: number;
  currency: string;
  available: boolean;
  checkedAt: Date;
}

const get = (o: unknown, k: string): unknown => (typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined);

/** ما حفظه الفحص ← رصيد. وما لا يُقرأ «غير معروف». */
export function readAiBalance(payload: unknown): AiBalance {
  const cents = get(payload, "cents");
  const currency = get(payload, "currency");
  if (get(payload, "known") === true && typeof cents === "number" && Number.isSafeInteger(cents) && typeof currency === "string") {
    return { known: true, cents, currency, available: get(payload, "available") !== false };
  }
  const reason = get(payload, "reason");
  return { known: false, reason: typeof reason === "string" ? reason : "غير معروف" };
}

/** آخرُ رصيدٍ مفحوص إن قلّ عن حدّه وكان الفحصُ حديثاً — وإلّا `null`. */
export async function loadLowAiBalance(now: Date = new Date(), conn: Conn = db): Promise<LowAiBalance | null> {
  const last = await latestDailyCheck("AI_BALANCE", conn);
  if (!last || now.getTime() - last.checkedAt.getTime() > AI_CHECK_FRESH_MS) return null;
  const b = readAiBalance(last.payload);
  if (!b.known || !balanceIsLow(b)) return null;
  return { cents: b.cents, currency: b.currency, available: b.available, checkedAt: last.checkedAt };
}
