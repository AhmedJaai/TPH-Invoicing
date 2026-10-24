/**
 * لقطةُ أرقام اليوم (`daily_figures`) — مرّةً في يوم الرياض. والأرقامُ من مصادرها الواحدة
 * يجمعها `/api/cron/daily`: «عليك» من `loadBalanceTotals`، و«يحتاج قرارك» من `workCount`
 * (عددُ الشريط نفسه)، والنقدُ من `loadCashPosition` (المجهولُ `null`). لا حسابَ هنا.
 *
 * لا شاشةَ تقرؤها بعد: هي ماضٍ يُجمَع من اليوم، فلا يُبنى «منذ أمس» على إعادة حسابٍ
 * من دفاترٍ تغيّرت. والكتابةُ الثانية في اليوم نفسه لا تغيّر شيئاً.
 */
import { db } from "@/db";
import { dailyFigures } from "@/db/schema";
import type { Conn } from "./types";

export interface DayFigures {
  owedMinor: number;
  attentionCount: number;
  cashMinor: number | null;
  cashAsOf: string | null;
}

/** يكتب لقطةَ اليوم إن لم تُكتب — `true` إن كتب الآن، و`false` إن سبقه تشغيلٌ آخر في اليوم نفسه. */
export async function writeDailyFigures(day: string, figures: DayFigures, conn: Conn = db): Promise<boolean> {
  const rows = await conn.insert(dailyFigures)
    .values({ day, ...figures })
    .onConflictDoNothing({ target: dailyFigures.day })
    .returning({ day: dailyFigures.day });
  return rows.length > 0;
}
