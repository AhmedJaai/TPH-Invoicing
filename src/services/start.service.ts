/**
 * «أيعرف النظامُ شيئاً بعد؟» — سؤالٌ واحد تسأله الرئيسيةُ والطابور.
 *
 * لا يقول أحدُهما «كلُّ شيءٍ سليم» عن قاعدةٍ لم يُرفَع إليها مستندٌ ولا كشف،
 * ويقول الآخرُ «ابدأ من هنا». و`cache()` كي لا يُسأل مرّتين في الطلب.
 */
import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { startState, type StartState } from "@/lib/start";

export const loadStartState = cache(async (): Promise<StartState> => {
  const [row] = (await db.execute<{ documents: number; bank: number; recipes: number }>(sql`
    select (select count(*)::int from documents)         as documents,
           (select count(*)::int from bank_transactions) as bank,
           (select count(*)::int from recipes)           as recipes
  `)).rows;
  return startState({
    documents: Number(row?.documents ?? 0),
    bankTransactions: Number(row?.bank ?? 0),
    recipes: Number(row?.recipes ?? 0),
  });
});
