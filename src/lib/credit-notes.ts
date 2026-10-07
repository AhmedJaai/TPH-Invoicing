/**
 * الإشعار الدائن.
 *
 * فاتورةٌ بخمسة آلاف وإشعارٌ دائن بسبعمئة يعني أنّ المستحقّ **٤٬٣٠٠**
 * لا ٥٬٠٠٠. وكان الإشعار يُذكَر في كشف المورّد ولا يُغيّر شيئاً في
 * رصيده عندنا — فيُطالَب بمالٍ ليس عليه، ويبدو الفرق «اختلافاً».
 *
 * ويُفصَل الإشعارُ عن السداد: كلاهما دائن، لكنّ السداد مالٌ خرج
 * والإشعار تخفيضٌ لم يخرج له مال. وخلطهما يجعل التدفّق النقديّ يكذب.
 */

export type CreditKind = "CREDIT_NOTE" | "PAYMENT";

export interface CreditLine {
  id: string;
  date: Date;
  amountMinor: number;
  description: string | null;
  reference: string | null;
}

/**
 * ما يدلّ على أنّ الدائن إشعارٌ لا سداد.
 *
 * والدليل من نصّ المورّد نفسه — لا يُخمَّن من المبلغ ولا من التاريخ.
 */
const CREDIT_MARKERS = [
  /اشعار\s*دائن/i, /إشعار\s*دائن/i, /credit\s*note/i,
  /مرتجع/i, /مردود/i, /خصم/i, /تسويه/i, /تسوية/i, /\bCN[-\s]?\d/i,
];

/*
  ما يقول صراحةً إنّه مالٌ دُفع. «تسوية بحوالة» و«سداد بعد الخصم» سدادٌ لا
  إشعار: الكلمةُ الصريحة تسبق — وإلّا عُدّ مالٌ خرج تخفيضاً لم يخرج له مال.
*/
const PAYMENT_MARKERS = [
  /حوال[ةه]/i, /تحويل/i, /سداد/i, /دفع[ةه]/i, /\bpayment\b/i, /\btransfer\b/i, /\breceipt\b/i, /سند\s*قبض/i,
];

export function classifyCredit(line: CreditLine): CreditKind {
  const text = `${line.description ?? ""} ${line.reference ?? ""}`;
  /* «إشعار دائن» باسمه يسبق كلَّ شيء: المورّدُ سمّاه */
  if (/[اإ]شعار\s*دائن|credit\s*note|\bCN[-\s]?\d/i.test(text)) return "CREDIT_NOTE";
  if (PAYMENT_MARKERS.some((m) => m.test(text))) return "PAYMENT";
  return CREDIT_MARKERS.some((m) => m.test(text)) ? "CREDIT_NOTE" : "PAYMENT";
}

export interface SupplierBalance {
  billedMinor: number;
  paidMinor: number;
  creditNoteMinor: number;
  /** ما عليك فعلاً: المفوتر ناقص المسدَّد ناقص الإشعارات. */
  outstandingMinor: number;
}

/**
 * يحسب رصيد المورّد بالإشعارات.
 *
 * والإشعار يُطرَح من المستحقّ كالسداد، لكنّه لا يُعدّ سداداً: من ينظر
 * إلى «كم دفعتُ له» يجب ألّا يجد فيه تخفيضاً لم يخرج له مال.
 */
export function balanceWithCredits(input: {
  billedMinor: number;
  paidMinor: number;
  credits: readonly CreditLine[];
}): SupplierBalance {
  const creditNoteMinor = input.credits
    .filter((c) => classifyCredit(c) === "CREDIT_NOTE")
    .reduce((s, c) => s + Math.abs(c.amountMinor), 0);

  return {
    billedMinor: input.billedMinor,
    paidMinor: input.paidMinor,
    creditNoteMinor,
    outstandingMinor: Math.max(0, input.billedMinor - input.paidMinor - creditNoteMinor),
  };
}

/**
 * يفسّر فرقاً في كشف المورّد بإشعارٍ دائن.
 *
 * فإن كان الفرق يساوي إشعاراً في الكشف نفسه، فهو ليس اختلافاً بل
 * تخفيضٌ لم يُقيَّد عندنا — وتسميته اختلافاً تُرسل صاحب العمل يبحث عن
 * خطأٍ ليس موجوداً.
 */
export function explainByCredit(
  differenceMinor: number,
  credits: readonly CreditLine[],
): CreditLine | null {
  if (differenceMinor === 0) return null;
  const target = Math.abs(differenceMinor);
  return (
    credits
      .filter((c) => classifyCredit(c) === "CREDIT_NOTE")
      .find((c) => Math.abs(Math.abs(c.amountMinor) - target) <= 1) ?? null
  );
}
