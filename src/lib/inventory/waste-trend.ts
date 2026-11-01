import type { StoredUnit } from "@/lib/unit-conversion";

/**
 * الفاقدُ عبر الجرود — هل يتحسّن أم يسوء؟ (أحمد، ١ نوفمبر ٢٠٢٦: «رسومٌ بيانيّة لهدر كلّ منتجٍ على مدار
 * كلّ جرد، وكيف الترند، وهل قاعدٌ يتحسّن أو لا»).
 *
 * **ما يُقاس**: نقصُ الصنف عمّا كان متوقَّعاً، نسبةً من استهلاكه المتوقَّع (`variance_consumption_bp`).
 * لا الصافي (زيادةُ أسبوعٍ لا تُطفئ نقصَ آخر)، ولا الكمّيّةُ وحدها (يتفاوت البيعُ من أسبوع). وهو
 * «فاقدٌ غيرُ مفسَّر»: الهدرُ المسجَّل مخصومٌ من المتوقَّع أصلاً فيُعرض بجانبه ولا يُجمع إليه.
 *
 * **والحكم**: نصفُ الأسابيع المقيسة الأوّل مقابل نصفِها الأخير — متوسّطان لا نقطتان، فأسبوعٌ شاذّ لا
 * يقلب الحكم. وتحتاج أربعةَ أسابيعَ مقيسةٍ على الأقلّ، وإلّا «لا يكفي»: لا يُحكم من نقطةٍ ولا نقطتين.
 * ويُعدّ التغيّرُ حقيقيّاً حين يتجاوز نصفَ نقطةٍ مئويّة **وخمسةَ عشرَ بالمئة** من الأوّل، فما دون ذلك «ثابت».
 */

export interface TrendPoint {
  countId: string;
  periodEnd: string;
  /** نقصُ الأسبوع من استهلاكه المتوقَّع بالنقطة الأساس (٠ إن لم ينقص). `null`: لم يُحسب فرقُه — لا صفر. */
  shortageBp: number | null;
  shortageMilli: number;
  /** كلفةُ النقص؛ `null` لا سعرَ للصنف في ذلك الجرد. */
  shortageCostMinor: number | null;
  recordedWasteMilli: number;
  /** تقريرُ هذا الجرد جزئيّ (لم يدخل كلُّ ما بيع في الحساب) — فنقصُه ناقصٌ أو مشوب، ويُعلَّم ولا يُخفى. */
  partial: boolean;
}

export type TrendVerdict = "IMPROVING" | "WORSENING" | "STEADY" | "TOO_FEW";

export const MIN_MEASURED_WEEKS = 4;
/** نصفُ نقطةٍ مئويّة. */
export const TREND_TOLERANCE_BP = 50;
export const TREND_TOLERANCE_RATIO = 0.15;
/** أسبوعٌ نقصُه فوق المئة بالمئة (عدٌّ خاطئ غالباً) لا يجرّ المتوسّطَ كلَّه. */
export const MAX_WEEK_BP = 10_000;

export interface TrendJudgement {
  verdict: TrendVerdict;
  /** متوسّطُ النصف الأوّل والأخير بالنقطة الأساس — `null` حين لا يكفي. */
  earlierBp: number | null;
  recentBp: number | null;
  measured: number;
}

const mean = (xs: readonly number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);

export function judgeTrend(points: readonly TrendPoint[]): TrendJudgement {
  const measured = points
    .filter((p): p is TrendPoint & { shortageBp: number } => p.shortageBp !== null)
    .sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0));
  if (measured.length < MIN_MEASURED_WEEKS) return { verdict: "TOO_FEW", earlierBp: null, recentBp: null, measured: measured.length };
  const half = Math.floor(measured.length / 2);
  const rate = (p: { shortageBp: number }) => Math.min(MAX_WEEK_BP, Math.max(0, p.shortageBp));
  const earlierBp = mean(measured.slice(0, half).map(rate));
  const recentBp = mean(measured.slice(-half).map(rate));
  const tolerance = Math.max(TREND_TOLERANCE_BP, Math.round(earlierBp * TREND_TOLERANCE_RATIO));
  const verdict: TrendVerdict = recentBp < earlierBp - tolerance ? "IMPROVING" : recentBp > earlierBp + tolerance ? "WORSENING" : "STEADY";
  return { verdict, earlierBp, recentBp, measured: measured.length };
}

/** سطرُ صنفٍ في جردٍ مقفل كما خُزّن. */
export interface TrendLine {
  productId: string;
  productName: string;
  category: string;
  baseUnit: StoredUnit;
  countId: string;
  periodEnd: string;
  varianceMilli: number | null;
  /** الفرقُ ÷ الاستهلاك المتوقَّع — سالبٌ للنقص. */
  varianceConsumptionBp: number | null;
  varianceCostMinor: number | null;
  recordedWasteMilli: number;
  partial: boolean;
}

export interface ProductTrend {
  productId: string;
  productName: string;
  category: string;
  baseUnit: StoredUnit;
  points: TrendPoint[];
  judgement: TrendJudgement;
  totalShortageMilli: number;
  /** `null` لا سعرَ لنقصه في أيّ جرد — لا صفر. */
  totalShortageCostMinor: number | null;
  totalRecordedWasteMilli: number;
  averageBp: number | null;
  lastBp: number | null;
}

export function toPoint(l: TrendLine): TrendPoint {
  const measured = l.varianceMilli !== null && l.varianceConsumptionBp !== null;
  return {
    countId: l.countId,
    periodEnd: l.periodEnd,
    shortageBp: measured ? Math.max(0, -(l.varianceConsumptionBp as number)) : null,
    shortageMilli: l.varianceMilli !== null && l.varianceMilli < 0 ? -l.varianceMilli : 0,
    shortageCostMinor: l.varianceCostMinor === null ? null : Math.max(0, -l.varianceCostMinor),
    recordedWasteMilli: l.recordedWasteMilli,
    partial: l.partial,
  };
}

const RANK: Record<TrendVerdict, number> = { WORSENING: 0, IMPROVING: 1, STEADY: 2, TOO_FEW: 3 };

/** كلُّ صنفٍ قيس فرقُه في جردٍ مقفل — يسوء أوّلاً، ثمّ الأكبرُ نقصاً بكلفته. */
export function buildProductTrends(lines: readonly TrendLine[]): ProductTrend[] {
  const byProduct = new Map<string, TrendLine[]>();
  for (const l of lines) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l]);
  const out: ProductTrend[] = [];
  for (const [productId, rows] of byProduct) {
    const points = rows.map(toPoint).sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0));
    const measured = points.filter((p) => p.shortageBp !== null);
    if (measured.length === 0) continue;
    const known = measured.filter((p) => p.shortageCostMinor !== null);
    out.push({
      productId, productName: rows[0].productName, category: rows[0].category, baseUnit: rows[0].baseUnit,
      points,
      judgement: judgeTrend(points),
      totalShortageMilli: measured.reduce((s, p) => s + p.shortageMilli, 0),
      totalShortageCostMinor: known.length === 0 ? null : known.reduce((s, p) => s + (p.shortageCostMinor ?? 0), 0),
      totalRecordedWasteMilli: points.reduce((s, p) => s + p.recordedWasteMilli, 0),
      averageBp: mean(measured.map((p) => Math.min(MAX_WEEK_BP, p.shortageBp as number))),
      lastBp: measured.at(-1)?.shortageBp ?? null,
    });
  }
  return out.sort((a, b) =>
    RANK[a.judgement.verdict] - RANK[b.judgement.verdict]
    || (b.totalShortageCostMinor ?? -1) - (a.totalShortageCostMinor ?? -1)
    || a.productName.localeCompare(b.productName, "ar"));
}
