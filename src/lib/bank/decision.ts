/**
 * القرار: تُطابَق تلقائياً، أم تُقترَح، أم تُترَك لك.
 *
 * كان الناتج رقماً — ٠٫٩٨ أو ٠٫٦ — وهو ليس احتمالاً بل تسميةٌ متنكّرة
 * في زيّ رقم. و«٩٨٪» تُوحي بيقين لا يملكه النظام.
 *
 * وقاعدتان تحكمان، ولا تكفي إحداهما:
 *
 *   ١. الدرجة فوق الحدّ.
 *   ٢. **والفارق** عن المرشّح الذي يليه فوق حدٍّ آخر.
 *
 * فمرشّحان بدرجة ٩٧ و٩٦ لا يُطابَق أحدهما تلقائياً مهما علت درجته —
 * لأنّ النظام لا يعرف أيّهما، وأحدهما خطأ. والمبدأ: **أثبِت المطابقة
 * لا تجدها**؛ فالمطابقة الخاطئة في المال أغلى من غيابها.
 */
import type { Assignment } from "./optimizer";
import type { Disposition, Outcome } from "./taxonomy";

/** أدنى درجة تُقبَل للمطابقة التلقائية. */
export const AUTO_SCORE = 0.85;

/** أدنى فارق عن المرشّح التالي يسمح بالتلقائية. */
export const AUTO_MARGIN = 0.08;

/**
 * تسامحٌ في مقارنة الدرجات.
 *
 * الدرجات كسور عشرية، و`0.95 - 0.08` تساوي `0.8700000000000001` لا
 * `0.87` — فيصير الفارق `0.07999999999999996` ويسقط تحت الحدّ بخطأ
 * تمثيلٍ لا بضعف ترجيح. والقرار المالي لا يُقلَب في الخانة السادسة عشرة.
 */
export const SCORE_EPSILON = 1e-9;

/** أدنى درجة تُعرَض اقتراحاً — وما دونها لا يُعرَض أصلاً. */
export const SUGGEST_SCORE = 0.5;

/**
 * نتائج لا تُطابَق تلقائياً مهما علت درجتها.
 *
 * الزيادة والسداد الجزئي يُغيّران رصيد الفاتورة على نحوٍ لا يُفترَض:
 * الزيادة قد تكون رسماً أو خطأً أو دفعةً مقدَّمة، والجزئيّ قد يكون
 * اتفاقاً أو نقصاً. وكلاهما قرارُ صاحب العمل.
 */
export const NEVER_AUTO: readonly Outcome[] = [
  "OVERPAYMENT", "PARTIAL_PAYMENT", "AMOUNT_MISMATCH", "DUPLICATE_PAYMENT",
];

export interface Decision {
  disposition: Disposition;
  /** لماذا هذا القرار — يُعرَض كما هو تحت «لماذا؟». */
  reasons: string[];
}

export function decide(a: Assignment): Decision {
  const { score, outcome } = { score: a.candidate.score, outcome: a.candidate.outcome };
  const margin = a.runnerUpScore === null ? 1 : score - a.runnerUpScore;
  const reasons: string[] = [...a.candidate.evidence];

  if (score < SUGGEST_SCORE - SCORE_EPSILON) {
    reasons.push("الترجيح ضعيف — لا يكفي حتى للاقتراح");
    return { disposition: "REVIEW", reasons };
  }

  if (NEVER_AUTO.includes(outcome)) {
    reasons.push("هذه الحالة لا تُطابَق تلقائياً: تغيّر الرصيد على نحوٍ يحتاج قرارك");
    return { disposition: "SUGGEST", reasons };
  }

  if (score < AUTO_SCORE - SCORE_EPSILON) {
    reasons.push(`الترجيح ${Math.round(score * 100)} من مئة — دون حدّ التلقائية`);
    return { disposition: "SUGGEST", reasons };
  }

  if (margin < AUTO_MARGIN - SCORE_EPSILON) {
    reasons.push(
      `يوجد مرشّح آخر قريبٌ منه (${Math.round((a.runnerUpScore ?? 0) * 100)} مقابل ${Math.round(score * 100)}) — فلا يُحسم تلقائياً`,
    );
    return { disposition: "SUGGEST", reasons };
  }

  reasons.push("لا مرشّح آخر يقاربه");
  return { disposition: "AUTO", reasons };
}

export interface Tally {
  auto: number;
  suggest: number;
  review: number;
}

export function tally(decisions: readonly Decision[]): Tally {
  const t: Tally = { auto: 0, suggest: 0, review: 0 };
  for (const d of decisions) {
    if (d.disposition === "AUTO") t.auto++;
    else if (d.disposition === "SUGGEST") t.suggest++;
    else t.review++;
  }
  return t;
}

/**
 * وصفٌ يُقرأ لدرجة الترجيح.
 *
 * تُعرَض كلمةٌ لا نسبة: النسبة تُقرأ يقيناً وهي ترجيح.
 */
export function strengthLabel(score: number): string {
  if (score >= AUTO_SCORE) return "ترجيح قوي";
  if (score >= 0.7) return "ترجيح معتبر";
  if (score >= SUGGEST_SCORE) return "ترجيح ضعيف";
  return "لا ترجيح";
}
