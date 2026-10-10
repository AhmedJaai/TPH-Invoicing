/**
 * دفترُ نداءات الذكاء في القاعدة — يُكتب بعد كلّ نداءٍ نجح، ويُقرأ للسقف وللبطاقة.
 *
 * **ولا يُسقط قراءةً**: الجدولُ قد لا يكون وصل بعد (هجرةٌ معلّقة) أو تتعثّر القاعدة —
 * فالكتابةُ والقراءةُ تُلتقَطان، والمجهولُ `null` لا صفر.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { budgetVerdict, dailyBudgetMicroUsd, toMicroUsd, type BudgetVerdict } from "@/lib/ai/usage-ledger";

/** في الاختبارات النقيّة وبلا قاعدةٍ لا دفتر — النداءُ يمضي كما كان. */
function ledgerEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== "test";
}

export interface AiUsageEntry {
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
}

export async function recordAiUsage(entry: AiUsageEntry): Promise<void> {
  if (!ledgerEnabled()) return;
  try {
    await db.insert(aiUsage).values({
      task: entry.task,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cachedTokens: entry.cachedTokens,
      costMicroUsd: toMicroUsd(entry.estimatedCostUsd),
    });
  } catch (e) {
    console.warn("[ai-usage] لم يُقيَّد النداء في الدفتر:", (e as Error).message.slice(0, 120));
  }
}

export interface AiSpend { calls: number; costMicroUsd: number }

async function spendSince(startSql: ReturnType<typeof sql>): Promise<AiSpend | null> {
  try {
    const result = await db.execute<{ calls: number; cost: string | number }>(sql`
      select count(*)::int as calls, coalesce(sum(${aiUsage}.cost_micro_usd), 0)::bigint as cost
        from ${aiUsage}
       where ${aiUsage}.at >= ${startSql}
    `);
    const row = result.rows[0];
    return row ? { calls: Number(row.calls), costMicroUsd: Number(row.cost) } : null;
  } catch {
    return null;
  }
}

/** إنفاقُ اليوم بتوقيت الرياض — أو `null`: لا يُعرف. */
export function aiSpendToday(): Promise<AiSpend | null> {
  return spendSince(sql`(date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh')`);
}

/** إنفاقُ الشهر الجاري بتوقيت الرياض — أو `null`: لا يُعرف. */
export function aiSpendThisMonth(): Promise<AiSpend | null> {
  return spendSince(sql`(date_trunc('month', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh')`);
}

/**
 * أيُسمح بنداءٍ آخر اليوم؟ بلا سقفٍ مضبوط لا يُسأل شيء (ولا استعلام).
 * وإن ضُبط ولم يُعرف الإنفاق مرّ النداء: دفترٌ لا يُقرأ لا يوقف عملَ صاحبه.
 */
export async function aiBudgetVerdict(): Promise<BudgetVerdict> {
  const budget = dailyBudgetMicroUsd(process.env.AI_DAILY_BUDGET_USD);
  if (budget === null || !ledgerEnabled()) return { allowed: true };
  const spent = await aiSpendToday();
  return spent ? budgetVerdict(spent.costMicroUsd, budget) : { allowed: true };
}
