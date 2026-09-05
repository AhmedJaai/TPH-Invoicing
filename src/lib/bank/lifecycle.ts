/**
 * دورةُ حياة الحركة البنكية — طبقاتٌ لا حالات متنافسة.
 *
 * كان للحركة عمودان يصفانها من جهتين مختلفتين: `matchStatus` يقول
 * (غير مطابَقة · مطابَقة · متجاهَلة) و`matchDisposition` يقول
 * (تلقائيّ · اقتراح · مراجعة). وهما لا يُقرآن معاً: حركةٌ حالتها
 * `UNMATCHED` وقرارُها `AUTO` تعني «قُرّر حسمُها ولم تُكتَب» — وهي حالٌ
 * صحيحة قبل الموافقة، ومرضٌ بعدها، ولا شيء في العمودين يفرّق.
 *
 * والصواب أنّ هذه **طبقاتٌ متراكمة** لا خياراتٌ متنافسة، وكلّ طبقةٍ
 * تُبنى على ما تحتها ولا تمحوه:
 *
 *   RAW        ما قاله البنك حرفاً بحرف. لا يتغيّر أبداً.
 *   INFERRED   ما استنتجه النظام: البابُ والمستفيد. يتغيّر بتغيّر القواعد.
 *   SUGGESTED  ترجيحٌ ينتظر إنساناً. لا أثر له في المال.
 *   CONFIRMED  أقرّه إنسان أو بلغ الحسمَ التلقائيّ. قرارٌ لا مال بعد.
 *   POSTED     صار مالاً: دفعةٌ وتخصيصات.
 *
 * وفائدة الترتيب أنّه يجيب سؤالاً لم يكن يُجاب: **أين تقف هذه الحركة
 * الآن؟** وسؤالاً أهمّ: أيّ الحركات وقفت حيث لا ينبغي — أُقرَّت ولم
 * تُقيَّد، أو قُيّدت بلا إقرار.
 *
 * والمجهول طبقةٌ لا عيب: حركةٌ في `INFERRED` ليست خطأً، هي حركةٌ عُرف
 * بابُها ولم يُعرف مقابلها بعد.
 */

export type Lifecycle = "RAW" | "INFERRED" | "SUGGESTED" | "CONFIRMED" | "POSTED";

export const LIFECYCLE_ORDER: readonly Lifecycle[] = [
  "RAW", "INFERRED", "SUGGESTED", "CONFIRMED", "POSTED",
];

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  RAW: "خام — كما قاله البنك",
  INFERRED: "مُستنتَجة — عُرف بابها",
  SUGGESTED: "مقترَحة — تنتظر إقرارك",
  CONFIRMED: "مُقَرَّة — لم تُقيَّد بعد",
  POSTED: "مُقيَّدة — صارت مالاً",
};

export interface LifecycleFacts {
  /** صُنّفت باباً معروفاً (غير `UNKNOWN`). */
  classified: boolean;
  /** رُجّح لها مقابلٌ — فاتورة أو جهة. */
  hasCandidate: boolean;
  /** الحسم: `AUTO` أو إقرار إنسان. */
  decided: boolean;
  /** أُنشئت لها دفعة. */
  posted: boolean;
  /** أُعلنت «ليست سداداً» — وهذا قرارٌ تامّ لا نقص. */
  ignored: boolean;
}

export function deriveLifecycle(f: LifecycleFacts): Lifecycle {
  if (f.posted) return "POSTED";
  /*
    «ليست سداداً» إقرارٌ تامّ: قرارٌ اتُّخذ ولا مال يقابله. وكانت
    تُحسَب مع المعلَّق فتُنفَّخ قائمة المراجعة بما فُرغ منه.
  */
  if (f.ignored || f.decided) return "CONFIRMED";
  if (f.hasCandidate) return "SUGGESTED";
  if (f.classified) return "INFERRED";
  return "RAW";
}

/**
 * حالاتٌ لا يجوز أن تقع — وإن وقعت فهي عطبٌ يُعرَض لا يُصحَّح آلياً.
 *
 * لأنّ التصحيح الآليّ هنا يمحو الدليل: من يعرف أيّ الطرفين الصحيح؟
 * أُقرَّت ولم تُقيَّد قد يعني فشلَ كتابة، وقد يعني حذفاً يدوياً لدفعة.
 * وكلاهما يستحقّ عيناً لا خوارزمية.
 */
export interface LifecycleAnomaly {
  code: "POSTED_WITHOUT_DECISION" | "DECIDED_NOT_POSTED" | "POSTED_BUT_IGNORED";
  detail: string;
}

export function detectAnomalies(f: LifecycleFacts): LifecycleAnomaly[] {
  const out: LifecycleAnomaly[] = [];

  if (f.posted && !f.decided) {
    out.push({
      code: "POSTED_WITHOUT_DECISION",
      detail: "أُنشئت لها دفعة ولم يُسجَّل حسمُها — مالٌ كُتب بلا قرارٍ مسجَّل",
    });
  }

  if (f.decided && !f.posted && !f.ignored) {
    out.push({
      code: "DECIDED_NOT_POSTED",
      detail: "حُسمت ولم تُقيَّد — قرارٌ لم يبلغ المال",
    });
  }

  if (f.posted && f.ignored) {
    out.push({
      code: "POSTED_BUT_IGNORED",
      detail: "أُعلنت ليست سداداً ولها دفعة — قولان متناقضان عن حركةٍ واحدة",
    });
  }

  return out;
}

/** أين تقف الحركة من الطبقات — عدداً، للترتيب والعرض. */
export function lifecycleRank(l: Lifecycle): number {
  return LIFECYCLE_ORDER.indexOf(l);
}
