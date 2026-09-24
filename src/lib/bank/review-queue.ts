/**
 * طابور المراجعة الموحَّد.
 *
 * كان ما ينتظر قرار الإنسان مبعثراً على شاشات: بعضُه في «البنك»،
 * وبعضُه في «ما يحتاج انتباهك»، وبعضُه لا يظهر إلّا في نتيجة الاستيراد
 * فيضيع بمجرّد إغلاقها. فلا يعرف صاحب العمل **كم بقي عليه**، ولا يرى
 * عملَه ينقص.
 *
 * والأهمّ أنّ الشاشات كانت تخلط ثلاثة أعمالٍ مختلفة في قائمةٍ واحدة،
 * وهي تحتاج ثلاثة أنواعٍ من الانتباه:
 *
 *   • **يُؤكَّد** — النظام واثق، ويطلب تأكيداً. عملُ ثوانٍ، ويُقبَل جمعاً.
 *   • **يُراجَع** — النظام متردّد بين مرشّحين. عملُ دقيقة، ويحتاج عيناً.
 *   • **يُحسَم** — النظام لا يعرف من هذه الجهة أصلاً. عملُ تعريف، وثمرتُه
 *     تتعدّى هذه الحركة إلى كل ما يشبهها بعدها.
 *
 * وخلطُها يجعل الطابور مرهقاً بلا سبب: من يفتح مئةً وسبعاً وعشرين حالة
 * يظنّها كلَّها بوزنٍ واحد، وإنّما فيها مئةٌ تُختَم في دقيقة وسبعٌ
 * تحتاجه فعلاً.
 *
 * والترتيب داخل كل مجموعة **بالمال لا بالتاريخ**: ما يزن أكثر يُراجَع
 * أوّلاً، لأنّ خطأه أغلى.
 */

export type ReviewBucket = "CONFIRM" | "REVIEW" | "RESOLVE";

export const BUCKET_LABEL: Record<ReviewBucket, string> = {
  CONFIRM: "يُؤكَّد",
  REVIEW: "يُراجَع",
  RESOLVE: "يُحسَم",
};

export const BUCKET_HINT: Record<ReviewBucket, string> = {
  CONFIRM: "النظام واثق ويطلب تأكيدك — تُؤكَّد جمعاً",
  REVIEW: "النظام متردّد — أكّدها، أو قيّدها على حساب المورّد، أو أعلِن أنّها ليست سداداً",
  RESOLVE: "جهةٌ لا يعرفها النظام — تعريفُها يسري على أمثالها",
};

export interface ReviewItem {
  transactionId: string;
  valueDate: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description: string;
  /** المورّد المرجَّح، إن رُجّح. */
  supplierName: string | null;
  /** معرّفه — به تُقيَّد الدفعة المقدَّمة بلا سؤالٍ عمّا يعرفه النظام. */
  supplierId?: string | null;
  /**
   * اسم المستفيد كما يقوله نصُّ البنك — لا `beneficiary_raw` الملوَّث
   * في الصفوف القديمة باسم المورّد الذي طابقه نظامُنا.
   */
  beneficiary?: string | null;
  disposition: "AUTO" | "SUGGEST" | "REVIEW" | null;
  category: string;
  score: number | null;
  reasons: string[];
}

export interface Bucketed {
  bucket: ReviewBucket;
  items: ReviewItem[];
  amountMinor: number;
}

/**
 * يوزّع ما ينتظر على مجموعاته.
 *
 * والقاعدة: الجهة المجهولة تسبق كل شيء — ليست حركةً تنتظر قراراً بل
 * حركةً لا يُعرف عمّاذا تُسأل. ولا معنى لعرض مرشّحين لمن لا نعرف من هو.
 */
export function bucketOf(item: ReviewItem): ReviewBucket {
  if (item.supplierName === null) return "RESOLVE";
  /*
    ── البابُ المجهول لا يعني الجهةَ المجهولة ──

    كان كلُّ `UNKNOWN` يذهب إلى «يُحسَم» وفعلُه «عرِّف هذه الجهة» —
    ومنه حوالاتٌ **عرف المحرّكُ مورّدَها** ولم يجد فاتورةً تطابقها:
    تقول الشاشةُ «المورّد معروف ولا فاتورة مفتوحة تطابق هذه الدفعة»
    ثمّ تطلب تعريفَه. وفعلُها الحقّ قيدُها على حسابه (سداد مورّدٍ لا
    فاتورةٍ بعينها)، وهو ما يقبله الخادمُ أصلاً: يقرأ المورّدَ من
    الحركة لا من بابها. فيبقى «يُحسَم» لما لا تُعرَف جهتُه، أو ما دخل.
  */
  if (item.category === "UNKNOWN" && !knownSupplierPayment(item)) return "RESOLVE";
  if (item.disposition === "REVIEW" || item.category === "UNKNOWN") return "REVIEW";
  return "CONFIRM";
}

/** صادرٌ عُرف مورّدُه — ببابه المكتوب أو بترجيح المحرّك قبل أن يُكتَب الباب. */
function knownSupplierPayment(i: ReviewItem): boolean {
  return i.direction === "DEBIT"
    && i.supplierName !== null
    && Boolean(i.supplierId)
    && (i.category === "SUPPLIER" || i.category === "UNKNOWN");
}

export function groupForReview(items: readonly ReviewItem[]): Bucketed[] {
  const order: ReviewBucket[] = ["CONFIRM", "REVIEW", "RESOLVE"];

  return order.map((bucket) => {
    const list = items
      .filter((i) => bucketOf(i) === bucket)
      /* بالمال لا بالتاريخ: ما يزن أكثر خطؤه أغلى */
      .sort((a, b) => b.amountMinor - a.amountMinor);

    return {
      bucket,
      items: list,
      amountMinor: list.reduce((sum, i) => sum + i.amountMinor, 0),
    };
  });
}

/**
 * جملةٌ واحدة تصف ما بقي.
 *
 * تُقرأ في ثانية: «يُؤكَّد ٣٠١ · يُراجَع ١٧ · يُحسَم ٩». وهذا ما كان
 * غائباً — عددٌ واحد يقول «١٢٧ تحتاج مراجعة» يُرهب ولا يُرشد.
 */
export function describeQueue(groups: readonly Bucketed[]): string {
  const parts = groups
    .filter((g) => g.items.length > 0)
    .map((g) => `${BUCKET_LABEL[g.bucket]} ${g.items.length}`);

  return parts.length === 0 ? "لا شيء ينتظرك" : parts.join(" · ");
}

/**
 * ما يُقيَّد على حساب المورّد بضغطة — لا على فاتورةٍ بعينها.
 *
 * حركةٌ عرّف أحمدُ جهتَها فقال «مورّد»، ولا اقتراحَ فاتورةٍ لها: زرُّ
 * «أكّد» يردّها الخادمُ بحقّ — «ليست اقتراحاً، والإقرار الجماعيّ
 * للاقتراحات وحدها» — فيبقى البند معروضاً بزرٍّ لا يعمل.
 *
 * وفعلُها الصحيح موجودٌ منذ البداية: تُقيَّد الدفعة على حساب المورّد،
 * وتُوزَّع على المفتوح بالأقدم أوّلاً، وما بقي يبقى «غير مخصَّص». وكان
 * في شاشة البنك وحدها، وهذه هي الشاشة التي تُسمّى طابور المراجعة.
 */
export function settleable(i: ReviewItem): boolean {
  return knownSupplierPayment(i) && i.disposition !== "SUGGEST";
}

/** ما يصلح للتأكيد الجماعيّ — وهو مجموعة «يُؤكَّد» وحدها. */
export function bulkConfirmable(items: readonly ReviewItem[]): string[] {
  return items
    .filter((i) => bucketOf(i) === "CONFIRM" && i.disposition === "SUGGEST")
    .map((i) => i.transactionId);
}
