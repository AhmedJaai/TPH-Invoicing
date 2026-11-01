/**
 * متى وصلت بضاعةُ فاتورةٍ — قرارُ صاحب المقهى بدل نائبِ «تاريخ الفاتورة».
 *
 * المورّد يسلّم في السابع ويصدر فاتورتَه في العاشر، فيُعرض ما تلا نهايةَ الجرد بأيّامٍ قليلة التباساً
 * ولا يُحسب ولا يُسقَط (`RECEIPT_AMBIGUITY_DAYS`). وكان العمودُ `invoices.received_on` يُقدَّم على تاريخ
 * الفاتورة ويُسقط الالتباس — ولا شيء في التطبيق يكتبه، فيقول التنبيهُ «قرّر» ولا زرَّ يقرّر
 * (أحمد، ١ نوفمبر ٢٠٢٦: «ما في زر أقوله إنه ما تحسب في الجرد لأنه جاء بعده»).
 *
 * القرارُ يوم الوصول: بعد نهاية الجرد ← لا يدخله ويدخل التالي، وفي أسبوعه أو قبله ← يدخله.
 */

/** أبعدُ ما يُقبل قبل تاريخ الفاتورة: بضاعةٌ تسبق فاتورتَها بأسابيع لا بأشهر. */
export const MAX_DAYS_BEFORE_INVOICE = 60;

export type ReceivedDateVerdict = { ok: true } | { ok: false; error: string };

const DAY_MS = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);

export function checkReceivedDate(input: { receivedOn: string; invoiceDay: string; today: string }): ReceivedDateVerdict {
  const { receivedOn, invoiceDay, today } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn) || Number.isNaN(Date.parse(`${receivedOn}T00:00:00Z`))) {
    return { ok: false, error: "اكتب يوم وصول البضاعة بصيغة YYYY-MM-DD." };
  }
  if (receivedOn > today) return { ok: false, error: "يوم وصول البضاعة لا يكون بعد اليوم." };
  if (days(invoiceDay, receivedOn) > MAX_DAYS_BEFORE_INVOICE) {
    return { ok: false, error: `وصول البضاعة قبل فاتورتها بأكثر من ${MAX_DAYS_BEFORE_INVOICE} يوماً غير مقبول. راجع التاريخ.` };
  }
  return { ok: true };
}
