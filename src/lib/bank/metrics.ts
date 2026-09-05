/**
 * مقاييس النظام — لا مقاييس النموذج.
 *
 * السؤال الذي لم يكن يُجاب: **هل يتحسّن هذا النظام أم يسوء؟** كان
 * الجواب انطباعاً — «يبدو أنّه صار أدقّ» — وهذا لا يُبنى عليه قرار.
 *
 * والمقياس هنا يُحسَب من **الحقيقة الأرضيّة الوحيدة المتاحة**: ما فعله
 * الإنسان. أقرّ، أو ردّ، أو تراجع. وما لم يمرّ بإنسانٍ لا يُحسَب صواباً
 * ولا خطأً — يُحسَب مجهولاً.
 *
 * **وهذا هو الفرق بين قياسٍ وادّعاء.** «دقّة ٩٧٪» محسوبةً على ما لم
 * يراجعه أحد تعني «٩٧٪ من أحكامي توافق أحكامي». والمقياس الذي يقيس
 * نفسه بنفسه يرتفع كلّما ازداد النظام ثقةً بخطئه.
 *
 * ولذلك كلّ نسبةٍ هنا تُرجع `null` حين ينقص مقامُها — لا صفراً ولا
 * مئة. والصفر يقول «فشل»، والمئة تقول «كمال»، والحقيقة «لا نعرف بعد».
 */

/** أقلّ عيّنةٍ تُحسَب عليها نسبة. */
export const MIN_SAMPLE = 20;

export interface OutcomeCounts {
  /** حُسمت تلقائياً. */
  auto: number;
  /** اقتُرحت وانتظرت إنساناً. */
  suggested: number;
  /** رُفعت للمراجعة. */
  review: number;
  /** أقرّها إنسان — من المقترَح. */
  confirmedByHuman: number;
  /** ردّها إنسان — من المقترَح. */
  rejectedByHuman: number;
  /** تُراجِع عنها بعد أن كُتبت — من التلقائيّ. */
  autoReversed: number;
  /** مجموع ما دخل المطابقة أصلاً. */
  totalCandidatesForMatching: number;
}

export interface Metric {
  key: string;
  label: string;
  /** `null` = لا يُعرف بعد. */
  value: number | null;
  /** حجم العيّنة التي حُسبت عليها. */
  sample: number;
  /** ماذا يعني هذا الرقم، وماذا لا يعني. */
  meaning: string;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator < MIN_SAMPLE) return null;
  return numerator / denominator;
}

/**
 * أربعة مقاييس، لكلٍّ سؤالٌ مختلف.
 *
 * ولا يُجمَع منها رقمٌ واحد «للجودة»: الجمع يُخفي المقايضة. نظامٌ لا
 * يحسم شيئاً دقّتُه كاملة ونفعُه صفر، ونظامٌ يحسم كلّ شيء نفعُه كامل
 * ودقّتُه مجهولة. والرقمان معاً هما القصّة.
 */
export function computeMetrics(c: OutcomeCounts): Metric[] {
  const humanJudged = c.confirmedByHuman + c.rejectedByHuman;

  return [
    {
      key: "stp",
      label: "نسبة الحسم التلقائيّ",
      value: ratio(c.auto, c.totalCandidatesForMatching),
      sample: c.totalCandidatesForMatching,
      meaning:
        "كم من الحركات حُسمت بلا إنسان. ترتفع بالتساهل وتنخفض بالتشدّد — " +
        "فلا تُقرأ وحدها، بل مع نسبة الخطأ التلقائيّ.",
    },
    {
      key: "false_auto",
      label: "نسبة الخطأ في الحسم التلقائيّ",
      /*
        وهذه أخطر رقمٍ في الصفحة: خطأ التلقائيّ يُكتَب مالاً بلا أن
        يراه أحد. وخطأ الاقتراح يراه إنسانٌ قبل أن يقع.
      */
      value: ratio(c.autoReversed, c.auto),
      sample: c.auto,
      meaning:
        "كم من المحسوم تلقائياً تُراجِع عنه إنسان. وهو أخطر الأرقام: " +
        "خطأ التلقائيّ يصير مالاً قبل أن يراه أحد.",
    },
    {
      key: "precision",
      label: "دقّة الاقتراح",
      value: ratio(c.confirmedByHuman, humanJudged),
      sample: humanJudged,
      meaning:
        "من كلّ ما عرضه النظام واقتضى حكماً، كم أقرّه الإنسان. " +
        "ولا تُحسَب على ما لم يُراجَع — فذلك قياسُ النظام بنفسه.",
    },
    {
      key: "coverage",
      label: "نسبة ما بلغ قراراً",
      value: ratio(
        c.auto + c.confirmedByHuman + c.rejectedByHuman,
        c.totalCandidatesForMatching,
      ),
      sample: c.totalCandidatesForMatching,
      meaning:
        "كم من الحركات وصلت إلى قرارٍ — بأيّ طريق. وما بقي معلّقاً " +
        "ليس صفراً ولا خطأً: هو عملٌ لم يُنجَز بعد.",
    },
  ];
}

/**
 * الاستدعاء (recall) لا يُحسَب — ويُقال ذلك صراحةً.
 *
 * لأنّ مقامه «كلّ ما كان يجب أن يُطابَق»، ولا سبيل إلى معرفته: الحركة
 * التي كان لها فاتورةٌ ولم يجدها النظام تبقى في «مجهولة» ولا يعلم أحد
 * أنّها كانت مطابَقةً فائتة — حتى يراها إنسان.
 *
 * والاجتهادُ في تقديره يُنتج رقماً يبدو معلوماً وهو مخترَع. فيُعلَن أنّه
 * لا يُقاس، ويُقاس بديلُه المتاح: كم من المجهول حسمه إنسانٌ بعدها،
 * وذلك حدٌّ أدنى للفائت لا قيمتُه.
 */
export const RECALL_NOTE =
  "الاستدعاء لا يُقاس في هذا النظام: مقامه «كل ما كان يجب أن يُطابَق»، " +
  "والمطابقة الفائتة لا تُعرَف حتى يراها إنسان. وما يُقاس بديلاً عنه: " +
  "كم من الحركات المجهولة حسمها إنسانٌ يدوياً — وهو حدٌّ أدنى للفائت لا قيمتُه.";

/** صياغةٌ عربية للنسبة — والمجهول يُقال لا يُصفَّر. */
export function formatMetric(m: Metric): string {
  if (m.value === null) {
    return m.sample === 0
      ? "لا بيانات بعد"
      : `لا يُقاس بعد — العيّنة ${m.sample} وأقلُّها ${MIN_SAMPLE}`;
  }
  return `${Math.round(m.value * 100)}٪ من ${m.sample}`;
}

/**
 * حكمٌ على الحال — لا درجة.
 *
 * والعتبات ليست معايير صناعية: هي ما يحتمله مقهىً يراجع كشفه بنفسه.
 * ومعنى «سيّئ» هنا: توقّف واقرأ، لا افزع.
 */
export type Health = "GOOD" | "WATCH" | "BAD" | "UNKNOWN";

export function healthOf(m: Metric): Health {
  if (m.value === null) return "UNKNOWN";

  if (m.key === "false_auto") {
    if (m.value <= 0.01) return "GOOD";
    if (m.value <= 0.05) return "WATCH";
    return "BAD";
  }
  if (m.key === "precision") {
    if (m.value >= 0.9) return "GOOD";
    if (m.value >= 0.75) return "WATCH";
    return "BAD";
  }
  /* والحسم والتغطية: قليلُهما تعبٌ لا خطر */
  if (m.value >= 0.7) return "GOOD";
  if (m.value >= 0.4) return "WATCH";
  return "BAD";
}
