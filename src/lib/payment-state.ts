/**
 * حال الدفعة: من خروج المال إلى استقراره على فواتيره.
 *
 * كان للدفعة حالٌ واحد ضمنيّ: «موجودة». فمن دفع لمورّدٍ قبل أن تصله
 * فاتورته لا يجد لدفعته موضعاً — إمّا تُخصَّص على فاتورةٍ ليست لها،
 * وإمّا تبقى معلّقةً في «غير مطابَقة» إلى الأبد وكأنّها خطأ. وكلاهما
 * كذب: المال خرج، والفاتورة لم تصل بعد، وهذا أمرٌ يوميّ لا شذوذ.
 *
 * والأسوأ: لا فرق في النظام بين دفعةٍ لم تُخصَّص بعد ودفعةٍ **أُلغيت**
 * ورُدَّ مالُها. فتُحسَبان معاً في «المدفوع»، ويظهر المقهى وقد دفع ما
 * لم يدفع.
 *
 * فهذه حالاتٌ ستّ، لكلٍّ معناها المحاسبيّ:
 *
 *   UNAPPLIED          مالٌ خرج ولم يُنسَب إلى فاتورة بعد.
 *   PARTIALLY_APPLIED  نُسب بعضُه، وبقي منه.
 *   APPLIED            نُسب كلّه — وهذا هو الاستقرار.
 *   OVERPAYMENT        دُفع أكثر من الفاتورة، والزائد رصيدٌ للمورّد.
 *   ADVANCE            دفعةٌ مقدّمة قصداً، لا فاتورة لها بعد.
 *   REVERSED           رُدَّ مالُها — لا تُحسَب مدفوعةً.
 *   VOID               سُجّلت خطأً ولم تقع أصلاً.
 *
 * والفرق بين `UNAPPLIED` و`ADVANCE` نيّةٌ لا حساب: الأولى تنتظر عملاً،
 * والثانية تمّ عملها. ولذلك لا تُشتقّ الثانية — تُعلَن.
 * والفرق بين `REVERSED` و`VOID` أنّ الأولى وقعت ثمّ رُدّت — ولها أثرٌ
 * في الكشف — والثانية لم تقع.
 */

export type PaymentStatus =
  | "UNAPPLIED"
  | "PARTIALLY_APPLIED"
  | "APPLIED"
  | "OVERPAYMENT"
  | "ADVANCE"
  | "REVERSED"
  | "VOID";

/** حالاتٌ لا تُحسَب في «ما دُفع للمورّد». */
export const NON_CASH_STATUSES: readonly PaymentStatus[] = ["REVERSED", "VOID"];

/** حالاتٌ فيها مالٌ لم يستقرّ على فاتورة. */
export const OPEN_STATUSES: readonly PaymentStatus[] = [
  "UNAPPLIED", "PARTIALLY_APPLIED", "OVERPAYMENT", "ADVANCE",
];

export function countsAsPaid(status: PaymentStatus): boolean {
  return !NON_CASH_STATUSES.includes(status);
}

export interface PaymentFacts {
  amountMinor: number;
  allocatedMinor: number;
  /** رسمٌ بنكيّ قُيّد من هذه الدفعة — ليس مالاً للمورّد ولا فائضاً. */
  feeMinor: number;
  /** أعلنها صاحبها دفعةً مقدّمة. */
  declaredAdvance: boolean;
  reversedAt: Date | null;
  voided: boolean;
}

/**
 * حدّ التسامح في اعتبار الدفعة مستقرّة.
 *
 * هللةٌ واحدة — نفسها في `allocation.ts`. والفرق فوقها فائضٌ يُعلَن،
 * لأنّ الفائض الصامت هو بالضبط ما يجعل رصيد المورّد يكذب.
 */
export const SETTLE_TOLERANCE_MINOR = 1;

/**
 * يشتقّ الحال من الأرقام — لا يُحفَظ حالٌ يخالف ما تقوله التخصيصات.
 *
 * والترتيب مقصود: الإلغاء والردّ يسبقان كل حساب، فدفعةٌ رُدَّ مالُها لا
 * يُسأل عن تخصيصها.
 */
export function derivePaymentStatus(f: PaymentFacts): PaymentStatus {
  if (f.voided) return "VOID";
  if (f.reversedAt !== null) return "REVERSED";

  /*
    الرسم يخرج من القسمة قبلها.

    كان الرسم يُترك داخل مبلغ الدفعة، فتظهر دفعةٌ بخمسة آلاف وعشرين على
    فاتورة بخمسة آلاف «فائضةً بعشرين ريالاً» — ويُفتَح للمورّد رصيدٌ لا
    وجود له، بينما العشرون رسمُ البنك ذهبت إليه لا إلى المورّد.
  */
  const distributable = f.amountMinor - f.feeMinor;
  const remaining = distributable - f.allocatedMinor;

  if (f.allocatedMinor === 0) return f.declaredAdvance ? "ADVANCE" : "UNAPPLIED";
  if (remaining > SETTLE_TOLERANCE_MINOR) return "PARTIALLY_APPLIED";
  if (remaining < -SETTLE_TOLERANCE_MINOR) return "OVERPAYMENT";
  return "APPLIED";
}

/** ما بقي من الدفعة قابلاً للتخصيص — بعد الرسم، ولا يقلّ عن صفر. */
export function availableMinor(f: PaymentFacts): number {
  if (!countsAsPaid(derivePaymentStatus(f))) return 0;
  return Math.max(0, f.amountMinor - f.feeMinor - f.allocatedMinor);
}

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  UNAPPLIED: "بلا تخصيص",
  PARTIALLY_APPLIED: "خُصّص بعضها",
  APPLIED: "مستقرّة",
  OVERPAYMENT: "فائضة",
  ADVANCE: "دفعة مقدّمة",
  REVERSED: "مردودة",
  VOID: "ملغاة",
};

/** انتقالاتٌ مسموحة — وما عداها يُرفَض ولا يُكتَب. */
const ALLOWED: Record<PaymentStatus, readonly PaymentStatus[]> = {
  UNAPPLIED: ["PARTIALLY_APPLIED", "APPLIED", "OVERPAYMENT", "ADVANCE", "REVERSED", "VOID"],
  ADVANCE: ["PARTIALLY_APPLIED", "APPLIED", "OVERPAYMENT", "REVERSED", "VOID"],
  PARTIALLY_APPLIED: ["APPLIED", "OVERPAYMENT", "UNAPPLIED", "REVERSED", "VOID"],
  APPLIED: ["PARTIALLY_APPLIED", "UNAPPLIED", "OVERPAYMENT", "REVERSED", "VOID"],
  OVERPAYMENT: ["APPLIED", "PARTIALLY_APPLIED", "UNAPPLIED", "REVERSED", "VOID"],
  /*
    المردودة والملغاة نهايتان.

    وردُّ الردّ ليس انتقالاً بل قيدٌ جديد — وإلّا ضاع أنّ المال خرج
    ورجع وخرج، وهو ثلاثةُ أحداثٍ في الكشف لا حالٌ واحد.
  */
  REVERSED: [],
  VOID: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export interface ReversalPlan {
  /** التخصيصات التي تُفَكّ — الفواتير تعود مستحقّة. */
  freedInvoiceIds: string[];
  freedMinor: number;
  status: PaymentStatus;
  reason: string;
}

/**
 * يخطّط ردّ دفعة.
 *
 * والردّ لا يحذف: يفكّ التخصيصات ويُعلن الحال. فمن راجع بعد شهر يرى
 * أنّ الدفعة كانت ثمّ رُدّت — لا فراغاً بلا تفسير. والحذف يجعل الفاتورة
 * تعود مستحقّةً بلا سببٍ ظاهر، فيُدفَع ثمنها مرّتين.
 */
export function planReversal(
  allocations: readonly { invoiceId: string; amountMinor: number }[],
  kind: "REVERSED" | "VOID",
  reason: string,
): ReversalPlan {
  return {
    freedInvoiceIds: allocations.map((a) => a.invoiceId),
    freedMinor: allocations.reduce((s, a) => s + a.amountMinor, 0),
    status: kind,
    reason:
      reason.trim() ||
      (kind === "VOID" ? "سُجّلت خطأً — لم تقع" : "رُدَّ مالها"),
  };
}
