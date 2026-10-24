/**
 * التشغيلُ المجدول اليوميّ — ٠٥:٣٠ بتوقيت الرياض: لقطةُ أرقام اليوم (`daily_figures`).
 *
 * مرّةً في يوم الرياض: التشغيلُ الثاني (إعادةُ GitHub أو تشغيلٌ بيد) لا يغيّر اللقطة.
 * بسرّ `CRON_SECRET` وحده وباسم المالك.
 */
import { cronGuard, cronRefused, dailyCronJob, runCron } from "@/services/cron.service";
import { writeDailyFigures, type DayFigures } from "@/services/daily-figures.service";
import { loadBalanceTotals } from "@/services/supplier-balance.service";
import { loadCashPosition } from "@/services/briefing.service";
import { workCount } from "@/lib/work";
import { snapshotDay } from "@/lib/cron";

export const runtime = "nodejs";
export const maxDuration = 120;

/** الأرقامُ الآن من مصادرها الواحدة — «يحتاج قرارك» كما يعدّه الشريطُ للمالك. */
async function gatherDayFigures(): Promise<DayFigures> {
  const [balances, attention, cash] = await Promise.all([loadBalanceTotals(), workCount("OWNER"), loadCashPosition()]);
  return { owedMinor: balances.totals.owedMinor, attentionCount: attention, cashMinor: cash.balanceMinor, cashAsOf: cash.asOf };
}

export async function POST(request: Request) {
  try {
    /* تقرأ المبالغ وتكتب لقطتها وحدها — لا مالَ ولا قرار */
    await cronGuard(request, "amounts:view");
  } catch (e) {
    const refused = cronRefused(e, "cron/daily");
    if (refused) return refused;
    throw e;
  }
  return runCron("daily", () => dailyCronJob({ day: () => snapshotDay(), gather: gatherDayFigures, write: writeDailyFigures }));
}
