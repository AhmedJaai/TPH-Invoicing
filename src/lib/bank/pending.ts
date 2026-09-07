import { sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions } from "@/db/schema";

/**
 * العمل الباقي — **عددٌ واحدٌ رسميّ**.
 *
 * كان لسؤالٍ واحد ثلاثةُ أجوبة، ولكلٍّ منها شاشة: الرئيسية تقول «٨٥
 * حركة بلا تصنيف»، وصفحة البنك «١٩٤ تحتاج قرارك»، وطابور المراجعة
 * ‏«يُقَرّ ٥ · يُراجَع ٠ · يُحسَم ٩١». وقد تكون الثلاثة صحيحةً وتقيس
 * أشياء مختلفة — لكنّ الواجهة لم تقل ذلك في موضع. والعدد الذي يتغيّر
 * بتغيّر الصفحة يفقد صفته عدداً، ومعه تسقط الثقة بما عداه.
 *
 * فهذا مصدرٌ واحد، بالشرط نفسه الذي يبني به طابورُ المراجعة قوائمَه —
 * `lifecycle` وحدها، لا `match_status` و`match_disposition` معاً فهما
 * يصفان من جهتين لا تُقرآن معاً. وما عداه يُسمّى باسمه الدقيق.
 */
export async function countPendingWork(): Promise<number> {
  const [row] = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from ${bankTransactions}
      where ${bankTransactions.lifecycle} in ('RAW', 'INFERRED', 'SUGGESTED')
    `)
  ).rows;

  return Number(row?.n ?? 0);
}
