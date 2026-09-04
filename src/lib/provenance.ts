/**
 * من أين جاء هذا الرقم؟
 *
 * الرقم وحده يُصدَّق أو يُكذَّب، ولا يُراجَع. فإذا قال النظام «مشترياتك
 * ٤٢٬١٨٠» ولم يقل إنّ ستّة مستندات لم تُقرأ بعد فليست فيه، فقد أعطى
 * دقّةً لا يملكها.
 *
 * فكل رقم مهمّ يحمل بيان مصدره: ما دخل فيه، وما استُبعد ولماذا، وأين
 * يُصلَح المستبعَد. والتغطية تُحسب بالعدد لا بالمبلغ — لأنّ مبلغ ما لم
 * يُقرأ مجهول، فلا يصحّ أن يدخل مقاماً في نسبة.
 */

export interface Contribution {
  id: string;
  label: string;
  count: number;
  /** المبلغ المعروف. للمستبعَد المجهول قيمته: `null` لا صفر. */
  amountMinor: number | null;
  included: boolean;
  /** سبب الاستبعاد — يُذكر للمستبعَد وحده. */
  reason?: string;
  /** مكان الإصلاح. */
  href?: string;
  /** وحدة العدّ حين تختلف عن وحدة الرقم — «مستند» لا «فاتورة». */
  unit?: string;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface Provenance {
  /** مجموع ما دخل فعلاً. */
  valueMinor: number;
  includedCount: number;
  excludedCount: number;
  /** مبلغ المستبعَد المعروف قيمته. ما جُهلت قيمته لا يُجمع. */
  excludedKnownMinor: number;
  /** عدد المستبعَد المجهول مبلغه. */
  excludedUnknownCount: number;
  /** نسبة ما دخل من مجموع ما كان ينبغي أن يدخل. `null` حين لا شيء. */
  coverage: number | null;
  confidence: Confidence;
  contributions: readonly Contribution[];
}

export const HIGH_COVERAGE = 0.95;
export const MEDIUM_COVERAGE = 0.8;

export function confidenceOf(coverage: number | null): Confidence {
  if (coverage === null) return "LOW";
  if (coverage >= HIGH_COVERAGE) return "HIGH";
  if (coverage >= MEDIUM_COVERAGE) return "MEDIUM";
  return "LOW";
}

export function buildProvenance(contributions: readonly Contribution[]): Provenance {
  const included = contributions.filter((c) => c.included);
  const excluded = contributions.filter((c) => !c.included);

  const valueMinor = included.reduce((s, c) => s + (c.amountMinor ?? 0), 0);
  const includedCount = included.reduce((s, c) => s + c.count, 0);
  const excludedCount = excluded.reduce((s, c) => s + c.count, 0);

  const excludedKnownMinor = excluded.reduce((s, c) => s + (c.amountMinor ?? 0), 0);
  const excludedUnknownCount = excluded
    .filter((c) => c.amountMinor === null)
    .reduce((s, c) => s + c.count, 0);

  const universe = includedCount + excludedCount;
  const coverage = universe === 0 ? null : includedCount / universe;

  return {
    valueMinor,
    includedCount,
    excludedCount,
    excludedKnownMinor,
    excludedUnknownCount,
    coverage,
    confidence: confidenceOf(coverage),
    contributions: [...included, ...excluded],
  };
}

/**
 * جملة واحدة تصف حال الرقم، تُعرض تحته.
 *
 * تُذكر النواقص صراحةً: «١١٧ فاتورة · ٦ لم تُقرأ بعد». والصمت عن الستّة
 * هو ما يجعل الرقم مضلّلاً.
 */
export function summarize(p: Provenance, unit = "فاتورة"): string {
  if (p.includedCount === 0 && p.excludedCount === 0) return "لا بيانات بعد";

  const head = `${p.includedCount} ${unit}`;
  if (p.excludedCount === 0) return `${head} · مكتمل`;
  return `${head} · ${p.excludedCount} خارج الرقم`;
}
