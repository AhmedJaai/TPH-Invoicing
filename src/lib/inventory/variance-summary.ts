/**
 * النقصُ والزيادةُ لا يتقاصّان.
 *
 * مجموعُ الفروق بإشارتها يجعل نقصاً بألفٍ وزيادةً بألفٍ **صفراً**،
 * فيقرأ صاحبُ المقهى «لا مشكلة» في أسبوعٍ ضاع فيه ألف ريال — وظهر ألفٌ
 * آخر في صنفٍ لم يُعَدّ جيّداً. والاثنان مشكلتان لا تُطفئ إحداهما
 * الأخرى: النقصُ يُسأل عنه أين ذهب، والزيادةُ يُسأل عنها لِمَ لم يُحسَب
 * ما دخل.
 *
 * فالمؤشّرُ الأساسيّ **النقص** و**حجمُ الفروق** (مجموعُ المطلق)، والصافي
 * ثانويٌّ يُعرَض ولا يقود.
 *
 * ── ونسبةُ النقص مقامُها كلفةُ الاستهلاك المتوقَّع ──
 *
 * «كم ضاع ممّا كان ينبغي أن يُصرَف؟» — لا من المبيعات (سعرُ البيع
 * يتضمّن الربح فيُصغّر النسبة) ولا من المخزون الباقي (يتضخّم آخرَ
 * الأسبوع). وحين لا تُعرَف كلفةُ بعض الاستهلاك يُقال إنّ المقامَ ناقص.
 *
 * ── والكمّيّاتُ لا تُجمَع عبر الأصناف ──
 *
 * كيلو بنٍّ ولترُ حليب لا يُجمَعان. فالنقصُ بالكمّيّة يُقرأ في سجلّ
 * الصنف وحده، وعلى مستوى الجرد يُجمَع بالكلفة.
 */
import type { StoredUnit } from "@/lib/unit-conversion";
import { varianceCostMinor } from "./purchases";

export interface SummaryLine {
  inScope: boolean;
  varianceMilli: number | null;
  varianceCostMinor: number | null;
  theoreticalConsumptionMilli: number | null;
  unitCostMilliMinor: number | null;
  baseUnit: StoredUnit;
}

export interface VarianceSummary {
  /** مقدارُ النقص — موجبٌ دائماً، والاسمُ يقول الجهة. */
  shortageCostMinor: number;
  /** ومقدارُ الزيادة — موجبٌ كذلك. */
  overageCostMinor: number;
  /** الصافي بإشارته (زيادة − نقص) — ثانويّ. */
  netCostMinor: number;
  /** حجمُ الفروق: نقصٌ + زيادة — لا يُطفئ فيه جهةٌ جهة. */
  absoluteCostMinor: number;
  linesShort: number;
  linesOver: number;
  /**
   * كم صنفاً داخلاً في الجرد حُسب فرقُه أصلاً — صفراً كان أو غيره.
   *
   * وبلا واحدٍ منها فالمجاميعُ أعلاه **غير معروفة** لا صفر: «النقص ٠٫٠٠»
   * في جردٍ لم يُحسَب فيه فرقٌ واحد يقول «لم يضع شيء» — وهو لم يُقَس.
   * والنسبةُ حينها `null`.
   */
  linesMeasured: number;
  /** أصنافٌ لها فرقٌ بلا كلفةٍ معروفة — خارج المجاميع أعلاه، ويُقال عددُها. */
  linesWithoutCost: number;
  /** كلفةُ الاستهلاك المتوقَّع لما عُرفت كلفتُه — مقامُ النسبة. */
  consumptionCostMinor: number;
  /** أكلُّ استهلاكٍ داخلٍ في الجرد معروفُ الكلفة؟ وإلّا فالمقامُ ناقص. */
  consumptionCostComplete: boolean;
  /** النقصُ ÷ كلفة الاستهلاك المتوقَّع، بنقاط الأساس — و`null` حين لا مقام. */
  shortageRateBp: number | null;
}

/** يجمع فروقَ الجرد بجهتيها — على الداخل في الجرد وحده. */
export function summariseVariance(lines: readonly SummaryLine[]): VarianceSummary {
  let shortage = 0;
  let overage = 0;
  let linesShort = 0;
  let linesOver = 0;
  let linesMeasured = 0;
  let linesWithoutCost = 0;
  let consumptionCost = 0;
  let complete = true;

  for (const l of lines) {
    if (!l.inScope) continue;
    if (l.varianceMilli !== null) linesMeasured++;

    if (l.varianceMilli !== null && l.varianceMilli !== 0) {
      if (l.varianceMilli < 0) linesShort++;
      else linesOver++;
      if (l.varianceCostMinor === null) linesWithoutCost++;
      else if (l.varianceCostMinor < 0) shortage += -l.varianceCostMinor;
      else overage += l.varianceCostMinor;
    }

    if (l.theoreticalConsumptionMilli !== null && l.theoreticalConsumptionMilli > 0) {
      const cost = varianceCostMinor(l.theoreticalConsumptionMilli, l.unitCostMilliMinor, l.baseUnit);
      if (cost === null) complete = false;
      else consumptionCost += cost;
    }
  }

  return {
    shortageCostMinor: shortage,
    overageCostMinor: overage,
    netCostMinor: overage - shortage,
    absoluteCostMinor: shortage + overage,
    linesShort,
    linesOver,
    linesMeasured,
    linesWithoutCost,
    consumptionCostMinor: consumptionCost,
    consumptionCostComplete: complete,
    shortageRateBp: consumptionCost > 0 && linesMeasured > 0
      ? Math.round((shortage * 10_000) / consumptionCost)
      : null,
  };
}

/**
 * أسابيعُ مجموعة — والجمعُ على المقادير لا على الصافي.
 *
 * نقصُ أسبوعٍ لا تُطفئه زيادةُ أسبوعٍ آخر، كما لا تُطفئ زيادةُ صنفٍ
 * نقصَ صنفٍ في الأسبوع نفسه.
 */
export function combineSummaries(weeks: readonly VarianceSummary[]): VarianceSummary {
  const shortage = weeks.reduce((s, w) => s + w.shortageCostMinor, 0);
  const overage = weeks.reduce((s, w) => s + w.overageCostMinor, 0);
  const consumption = weeks.reduce((s, w) => s + w.consumptionCostMinor, 0);
  return {
    shortageCostMinor: shortage,
    overageCostMinor: overage,
    netCostMinor: overage - shortage,
    absoluteCostMinor: shortage + overage,
    linesShort: weeks.reduce((s, w) => s + w.linesShort, 0),
    linesOver: weeks.reduce((s, w) => s + w.linesOver, 0),
    /* جردٌ مقفَلٌ قبل هذا الحقل لم يُحفَظ له — ويُعدّ مقيساً إن كان فيه فرق */
    linesMeasured: weeks.reduce((s, w) => s + (w.linesMeasured ?? (w.linesShort + w.linesOver)), 0),
    linesWithoutCost: weeks.reduce((s, w) => s + w.linesWithoutCost, 0),
    consumptionCostMinor: consumption,
    consumptionCostComplete: weeks.every((w) => w.consumptionCostComplete),
    shortageRateBp: consumption > 0 ? Math.round((shortage * 10_000) / consumption) : null,
  };
}
