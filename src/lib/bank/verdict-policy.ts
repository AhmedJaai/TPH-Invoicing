/**
 * كيف يتحوّل حكم النموذج إلى قرار.
 *
 * والقاعدة الحاكمة: **ثقةُ النموذج بنفسه ليست معايرة.** النموذج يقول
 * «٠٫٩٧» لأنّه تعلّم أن يقول أرقاماً كهذه، لا لأنّه قاس شيئاً. فمن
 * جعلها الحكمَ النهائيّ اشترى يقيناً لا يملكه أحد.
 *
 * فهي **إشارةٌ واحدة** بين ستّ:
 *
 *   ١. درجة المرشّح الحسابية
 *   ٢. الفارق عن المرشّح التالي
 *   ٣. جودة الأدلّة — نسبة ما صحّ من ادّعاء النموذج
 *   ٤. ثقة النموذج
 *   ٥. قيمة الحركة
 *   ٦. خطر بابها
 *
 * ولا شيء من هذا يبلغ «مطابقة تلقائية»: أقصى ما يبلغه حكم النموذج
 * **اقتراح**. لأنّ النموذج يرجّح، والإنسان يُقرّ، والمال لا يُنسَب
 * بترجيح.
 */
import type { ReasonAudit } from "./reason-codes";
import { evidenceQuality } from "./reason-codes";
import type { TxKind } from "./taxonomy";

/** أدنى ثقةٍ يُلتفَت عندها إلى حكم النموذج أصلاً. */
export const MIN_MODEL_CONFIDENCE = 0.6;

/** أدنى جودة أدلّة تُقبَل — ما دونها ادّعاءٌ أكثره ساقط. */
export const MIN_EVIDENCE_QUALITY = 0.5;

/**
 * أبوابٌ يُشدَّد فيها مهما بلغت الدرجة.
 *
 * خطأٌ في راتبٍ أو ضريبةٍ أو تحويلِ مالك أثقل من خطأ في شراء بضاعة:
 * الأوّل يمسّ شخصاً أو جهةً رسمية، والثاني يُصحَّح في الفاتورة التالية.
 */
export const HIGH_RISK_KINDS: readonly TxKind[] = [
  "SALARY", "GOVERNMENT", "OWNER_TRANSFER", "ZAKAT",
];

/**
 * القيمة التي تصير عندها الحركة جديرةً بنظر الإنسان مهما قال النموذج.
 *
 * وهي **نسبيّة لا ثابتة**: ألف ريال في مقهىً صغير كبيرة، وفي مقهىً
 * يشتري بمئة ألف شهرياً عاديّة. فتُحسب من وسيط حركاته هو.
 */
/** أرضيّةٌ لا سقف: خمسة آلاف ريال كبيرةٌ في كل حال. */
export const ABSOLUTE_HIGH_VALUE_MINOR = 500_000;

export const MEDIAN_MULTIPLE = 10;

/**
 * الحدّ هو **الأكبر** بين الأرضيّة والمقياس النسبيّ — لا الأصغر.
 *
 * فالمقهى الذي وسيط حركاته خمسة آلاف لا تُوقفه حركةٌ بستّة، والمقهى
 * الذي وسيطه خمسمئة تُوقفه. ولو أُخذ الأصغر لصار كلّ شيءٍ كبيراً في
 * المنشآت الكبيرة — وهو عكس المقصود.
 */
export function highValueThreshold(medianAmountMinor: number | null): number {
  if (medianAmountMinor === null || medianAmountMinor <= 0) {
    return ABSOLUTE_HIGH_VALUE_MINOR;
  }
  return Math.max(ABSOLUTE_HIGH_VALUE_MINOR, medianAmountMinor * MEDIAN_MULTIPLE);
}

export interface VerdictInput {
  /** درجة المرشّح الذي اختاره النموذج. */
  candidateScore: number;
  /** فارقه عن التالي، أو `null` إن لم يوجد. */
  margin: number | null;
  audit: ReasonAudit;
  modelConfidence: number;
  amountMinor: number;
  kind: TxKind;
  medianAmountMinor: number | null;
}

export interface VerdictDecision {
  disposition: "SUGGEST" | "REVIEW";
  reasons: string[];
  /** ما اعتُمد عليه — يُحفَظ كي يُفهَم القرار بعد شهور. */
  signals: {
    candidateScore: number;
    margin: number | null;
    evidenceQuality: number | null;
    modelConfidence: number;
    highValue: boolean;
    highRisk: boolean;
  };
}

/**
 * يزن الإشارات الستّ.
 *
 * والمخرَج `SUGGEST` أو `REVIEW` لا ثالث لهما: `AUTO` بابٌ مغلق أمام
 * النموذج، مفتوحٌ للحساب وحده.
 */
export function weighVerdict(input: VerdictInput): VerdictDecision {
  const quality = evidenceQuality(input.audit);
  const threshold = highValueThreshold(input.medianAmountMinor);
  const highValue = input.amountMinor >= threshold;
  const highRisk = HIGH_RISK_KINDS.includes(input.kind);

  const signals = {
    candidateScore: input.candidateScore,
    margin: input.margin,
    evidenceQuality: quality,
    modelConfidence: input.modelConfidence,
    highValue,
    highRisk,
  };

  const reasons: string[] = [];

  if (input.audit.upheld.length > 0) {
    reasons.push(`أدلّة صحّت: ${input.audit.upheld.join(" · ")}`);
  }
  if (input.audit.refuted.length > 0) {
    reasons.push(`ادّعاها النموذج ولم تقع: ${input.audit.refuted.join(" · ")}`);
  }
  if (input.audit.unknown.length > 0) {
    reasons.push(`رموزٌ ليست من القائمة: ${input.audit.unknown.join(" · ")}`);
  }

  /* ── ما يُسقِط الحكم إلى مراجعة ── */

  if (quality !== null && quality < MIN_EVIDENCE_QUALITY) {
    reasons.push("أكثر ما ادّعاه النموذج لم يقع — فلا يُقترَح حكمه");
    return { disposition: "REVIEW", reasons, signals };
  }

  if (input.modelConfidence < MIN_MODEL_CONFIDENCE) {
    reasons.push(
      `ثقة النموذج ${Math.round(input.modelConfidence * 100)} من مئة — دون حدّ الالتفات`,
    );
    return { disposition: "REVIEW", reasons, signals };
  }

  if (highRisk) {
    reasons.push("باب الحركة يُشدَّد فيه: خطؤه يمسّ شخصاً أو جهةً رسمية");
    return { disposition: "REVIEW", reasons, signals };
  }

  if (highValue) {
    reasons.push(
      `مبلغٌ كبير (${(input.amountMinor / 100).toFixed(2)} · الحدّ ${(threshold / 100).toFixed(2)}) — يُنظَر فيه`,
    );
    return { disposition: "REVIEW", reasons, signals };
  }

  reasons.push("ترجيحٌ ينتظر إقرارك — النموذج لا يُقرّر مالاً");
  return { disposition: "SUGGEST", reasons, signals };
}
