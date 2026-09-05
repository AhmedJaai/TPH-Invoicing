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
 *   • **يُقَرّ** — النظام واثق، ويطلب ختماً. عملُ ثوانٍ، ويُقبَل جمعاً.
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
  CONFIRM: "يُقَرّ",
  REVIEW: "يُراجَع",
  RESOLVE: "يُحسَم",
};

export const BUCKET_HINT: Record<ReviewBucket, string> = {
  CONFIRM: "النظام واثق ويطلب ختمك — تُقَرّ جمعاً",
  REVIEW: "النظام متردّد بين مرشّحين — تحتاج عينك",
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
  disposition: "AUTO" | "SUGGEST" | "REVIEW" | null;
  category: string;
  score: number | null;
  reasons: string[];
  /** عدد المرشّحين — واحدٌ يعني بلا منافس. */
  candidateCount: number;
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
  if (item.supplierName === null || item.category === "UNKNOWN") return "RESOLVE";
  if (item.disposition === "REVIEW") return "REVIEW";
  return "CONFIRM";
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
 * تُقرأ في ثانية: «يُقَرّ ٣٠١ · يُراجَع ١٧ · يُحسَم ٩». وهذا ما كان
 * غائباً — عددٌ واحد يقول «١٢٧ تحتاج مراجعة» يُرهب ولا يُرشد.
 */
export function describeQueue(groups: readonly Bucketed[]): string {
  const parts = groups
    .filter((g) => g.items.length > 0)
    .map((g) => `${BUCKET_LABEL[g.bucket]} ${g.items.length}`);

  return parts.length === 0 ? "لا شيء ينتظرك" : parts.join(" · ");
}

/** ما يصلح للإقرار الجماعيّ — وهو مجموعة «يُقَرّ» وحدها. */
export function bulkConfirmable(items: readonly ReviewItem[]): string[] {
  return items
    .filter((i) => bucketOf(i) === "CONFIRM" && i.disposition === "SUGGEST")
    .map((i) => i.transactionId);
}
