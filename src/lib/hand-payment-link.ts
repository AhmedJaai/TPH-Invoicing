/**
 * حوالةٌ في الكشف تنتظر المراجعة، وسدادُها مقيَّدٌ بيدٍ قبلها.
 *
 * وُجد في مختبرات القهوة ورونة (٢٦ سبتمبر ٢٠٢٦): رُفعت الفاتورة وقيل «سُدّدت»،
 * فقُيِّدت دفعةٌ بلا حركة بنك وأغلقت الفاتورة. ثمّ جاء الكشفُ بالحوالة، فلم يجد
 * المطابقُ فاتورةً مفتوحة — «المورّد معروف ولا فاتورة مفتوحة تطابق هذه الدفعة» —
 * ووقفت الحوالةُ في الطابور، والدفعةُ اليدويّة بلا دليل. والتبنّي
 * (`recordBankPayment`) لا يقع إلّا حين تُكتب دفعة، والحوالةُ في المراجعة لا تُكتب.
 *
 * فالربط: حوالةٌ صادرة لمورّدٍ معروف لم تُربط بدفعة، ودفعةٌ للمورّد نفسه
 * «حوالةً» بلا حركة ولا إيصال، في نافذة أيّام، والحوالةُ لا تقلّ عنها.
 *   - **المبلغُ نفسه**: هي هي — يُربط آلياً (السياسةُ نفسُها عند الاستيراد).
 *   - **الحوالةُ أكبر**: اقتراحٌ يُقَرّ — والفرقُ رصيدٌ للمورّد إلى أن يُفسَّر
 *     (رونة: ٢٥ رسمُ توصيلٍ في الفاتورة لم يُقرأ، فإجماليُّها ٤٦٢ لا ٤٣٧).
 */

export const LINK_WINDOW_DAYS = 14;

export interface WaitingTransfer {
  id: string;
  supplierId: string;
  /** YYYY-MM-DD */
  day: string;
  amountMinor: number;
}

export interface HandPayment {
  id: string;
  supplierId: string;
  day: string;
  amountMinor: number;
}

export interface HandPaymentLink {
  transferId: string;
  paymentId: string;
  supplierId: string;
  transferMinor: number;
  paymentMinor: number;
  /** ما زادته الحوالةُ على الدفعة — صفرٌ في المطابق. */
  extraMinor: number;
  daysApart: number;
  exact: boolean;
}

const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * يقرن كلَّ حوالةٍ بدفعةٍ واحدة وكلَّ دفعةٍ بحوالةٍ واحدة: المطابقُ مبلغاً
 * أوّلاً، ثمّ الأقربُ يوماً، ثمّ الأقلُّ فرقاً.
 */
export function linkHandPayments(
  transfers: readonly WaitingTransfer[],
  hand: readonly HandPayment[],
): HandPaymentLink[] {
  const pairs: HandPaymentLink[] = [];
  for (const t of transfers) {
    for (const p of hand) {
      if (p.supplierId !== t.supplierId || p.amountMinor > t.amountMinor) continue;
      const gap = Math.abs(dayNumber(t.day) - dayNumber(p.day));
      if (gap > LINK_WINDOW_DAYS) continue;
      pairs.push({
        transferId: t.id,
        paymentId: p.id,
        supplierId: t.supplierId,
        transferMinor: t.amountMinor,
        paymentMinor: p.amountMinor,
        extraMinor: t.amountMinor - p.amountMinor,
        daysApart: gap,
        exact: t.amountMinor === p.amountMinor,
      });
    }
  }
  pairs.sort((a, b) =>
    Number(b.exact) - Number(a.exact) || a.daysApart - b.daysApart || a.extraMinor - b.extraMinor);

  const usedT = new Set<string>();
  const usedP = new Set<string>();
  const out: HandPaymentLink[] = [];
  for (const x of pairs) {
    if (usedT.has(x.transferId) || usedP.has(x.paymentId)) continue;
    usedT.add(x.transferId);
    usedP.add(x.paymentId);
    out.push(x);
  }
  return out;
}

export function linkKey(l: Pick<HandPaymentLink, "transferId" | "paymentId">): string {
  return `${l.transferId}:${l.paymentId}`;
}
