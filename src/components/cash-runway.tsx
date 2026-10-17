import { Hourglass } from "lucide-react";
import { Money } from "./money";
import { DAY, countNoun } from "@/lib/arabic";
import { RUNWAY_BLOCK_LABEL } from "@/lib/cash-runway";
import { loadRunway } from "@/services/cash-runway.service";

/**
 * سطرٌ تحت الرصيد: «يغطّي نحو ٢٣ يوماً من الصادر» بأساسه — أو لماذا لا يُحسب.
 * حدٌّ أدنى: الواردُ غير محسوب، ويُقال ذلك في السطر نفسه.
 */
export async function RunwayLine() {
  const r = await loadRunway();
  /* الرصيدُ المجهول تقوله البطاقةُ نفسُها — لا يُكرَّر تحتها */
  if (r.blocked === "NO_BALANCE") return null;
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
      <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} aria-hidden />
      {r.days === null || r.dailyOutflowMinor === null ? (
        <span className="text-muted">أيام النقد الباقية: {r.blocked ? RUNWAY_BLOCK_LABEL[r.blocked] : "لا يمكن حسابها"}.</span>
      ) : (
        <span>
          يغطّي الرصيد نحو <span className="font-bold text-ink">{r.days === 0 ? "صفر يوم" : countNoun(r.days, DAY)}</span> من المصروفات،
          بمعدل <Money minor={r.dailyOutflowMinor} /> في اليوم خلال آخر {countNoun(r.basisDays, DAY)} من الكشف، على افتراض ألا يدخل مال. الوارد غير محسوب.
        </span>
      )}
    </p>
  );
}
