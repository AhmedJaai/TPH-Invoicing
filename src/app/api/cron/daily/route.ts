/**
 * التشغيلُ المجدول اليوميّ — ٠٥:٣٠ بتوقيت الرياض: لقطةُ أرقام اليوم (`daily_figures`)،
 * ثمّ فحصا الصباح: أرقامُ الأشهر المقفلة كما خُتمت (`month-seal.service.ts`)، ورصيدُ
 * القراءة الذكيّة عند المزوّد. وما وجداه صفٌّ في `daily_checks` تقرؤه «يحتاج قرارك».
 *
 * مرّةً في يوم الرياض: التشغيلُ الثاني (إعادةُ GitHub أو تشغيلٌ بيد) لا يغيّر اللقطة،
 * ويعيد الفحصين (قراءةٌ وصفٌّ جديد). بسرّ `CRON_SECRET` وحده وباسم المالك.
 */
import { cronGuard, cronRefused, dailyCronJob, runCron } from "@/services/cron.service";
import { writeDailyFigures, type DayFigures } from "@/services/daily-figures.service";
import { loadBalanceTotals } from "@/services/supplier-balance.service";
import { loadCashPosition } from "@/services/briefing.service";
import { workCount } from "@/lib/work";
import { snapshotDay } from "@/lib/cron";
import { withDeadline } from "@/lib/ai/deadline";
import { runSealCheck } from "@/services/month-seal.service";
import { checkAiBalance } from "@/services/daily-checks.service";

export const runtime = "nodejs";
export const maxDuration = 120;

/** الأرقامُ الآن من مصادرها الواحدة — «يحتاج قرارك» كما يعدّه الشريطُ للمالك. */
async function gatherDayFigures(): Promise<DayFigures> {
  const [balances, attention, cash] = await Promise.all([loadBalanceTotals(), workCount("OWNER"), loadCashPosition()]);
  return { owedMinor: balances.totals.owedMinor, attentionCount: attention, cashMinor: cash.balanceMinor, cashAsOf: cash.asOf };
}

export async function POST(request: Request) {
  let actorId: string;
  try {
    /* تقرأ المبالغ وتكتب لقطتها وفحوصها وحدها — لا مالَ ولا قرار */
    actorId = (await cronGuard(request, "amounts:view")).id;
  } catch (e) {
    const refused = cronRefused(e, "cron/daily");
    if (refused) return refused;
    throw e;
  }
  return runCron("daily", () => dailyCronJob({
    day: () => snapshotDay(),
    gather: gatherDayFigures,
    write: writeDailyFigures,
    checkSeals: () => runSealCheck(actorId),
    /* نداءُ المزوّد تحت موعدٍ معلَن — والمجهولُ يُحفظ مجهولاً */
    checkAiBalance: () => withDeadline(12_000, () => checkAiBalance()),
  }));
}
