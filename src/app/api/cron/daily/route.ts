/**
 * التشغيلُ المجدول اليوميّ — ٠٥:٣٠ بتوقيت الرياض: لقطةُ أرقام اليوم (`daily_figures`)،
 * ثمّ فحصا الصباح: أرقامُ الأشهر المقفلة كما خُتمت (`month-seal.service.ts`)، ورصيدُ
 * القراءة الذكيّة عند المزوّد. وما وجداه صفٌّ في `daily_checks` تقرؤه «يحتاج قرارك».
 *
 * مرّةً في يوم الرياض: التشغيلُ الثاني (إعادةُ GitHub أو تشغيلٌ بيد) لا يغيّر اللقطة،
 * ويعيد الفحصين (قراءةٌ وصفٌّ جديد). بسرّ `CRON_SECRET` وحده وباسم المالك.
 * ومع اللقطة الأولى إشعارُ الصباح إلى الأجهزة المشتركة (خاملٌ بلا مفاتيح VAPID).
 */
import { cronGuard, cronRefused, dailyCronJob, runCron } from "@/services/cron.service";
import { writeDailyFigures, type DayFigures } from "@/services/daily-figures.service";
import { loadBalanceTotals } from "@/services/supplier-balance.service";
import { loadCashPosition } from "@/services/briefing.service";
import { workCount } from "@/lib/work";
import { snapshotDay } from "@/lib/cron";
import { withDeadline } from "@/lib/ai/deadline";
import { runSealCheck } from "@/services/month-seal.service";
import { checkUnitCosts } from "@/services/daily-checks.service";
import { refreshBudgetFindings } from "@/services/budget.service";
import { checkAiBalance } from "@/services/daily-checks.service";
import { sendMorningPush } from "@/services/push.service";
import { foodicsConfigured } from "@/lib/foodics/client";
import { fetchFoodicsCatalog } from "@/services/foodics-sync.service";
import { importParsedCatalog } from "@/services/catalog-import.service";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { refreshStaleReadings } from "@/services/finance-reading.service";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    /* خاملٌ بلا `VAPID_*` — وإلّا فنداءٌ فارغ إلى كلّ جهازٍ مشترك */
    pushBrief: () => withDeadline(30_000, () => sendMorningPush()),
    /* يقرأ بنودَ الفواتير كلَّها — صباحاً لا مع كلّ صفحة */
    checkUnitCosts: () => withDeadline(60_000, () => checkUnitCosts()),
    checkBudgets: () => withDeadline(60_000, () => refreshBudgetFindings()),
    /* وصفاتُ فودكس كلَّ صباح (أحمد، ٢٤ نوفمبر ٢٠٢٦: «الوصفات المفروض يسحبها كل يوم») — تسري من اليوم، والماضي لا يُمسّ */
    refreshCatalog: foodicsConfigured()
      ? () => withDeadline(45_000, async () => (await importParsedCatalog(await fetchFoodicsCatalog(), { effectiveFrom: todayInRiyadh(), actorId, dryRun: false })).recipes)
      : undefined,
    /* القراءةُ الذكيّة لا تبقى على أرقامٍ قديمة — شهران على الأكثر، كلٌّ تحت موعده */
    refreshReadings: () => withDeadline(90_000, () => refreshStaleReadings(actorId, 2)),
  }));
}
