/**
 * وقائعُ فودكس لـ«يحتاج قرارك» — ما اختلف فيه مع البنك ومع الفواتير، بعد ما أسكته صاحبُه.
 *
 * تُحسَب مع كلّ صفحة (عدّادُ القشرة)، فالبطاقاتُ تُقرأ لآخر `CARD_LOOKBACK_DAYS` وحدها.
 * والمشترياتُ بلا فاتورة تُسأل **لمورّدٍ مربوطٍ وحده**: غيرُ المربوط لا يُعرَف أغابت فاتورتُه
 * أم كُتب رقمُها في فودكس على غير صيغته — وسؤالٌ لا جوابَ له ضجيج.
 */
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";
import { loadPurchaseWitness } from "./foodics-compare.service";
import { cardGapKey, loadCardComparison, loadFoodicsSilenced } from "./foodics-takings.service";

/** كم يوماً إلى الوراء يُنبَّه على فرق دفعة — ما قبله في صفحته، تاريخٌ لا عمل. */
export const CARD_LOOKBACK_DAYS = 45;

export interface FoodicsAttentionFacts {
  /** دفعاتُ بنكٍ فرقُها عن بطاقات فودكس ظاهر. الموجبُ: فودكس قبض أكثر ممّا وصل. */
  cardGaps: { day: string; gapMinor: number }[];
  /** فاتورةٌ واحدة ومبلغان. */
  purchaseDiffers: { purchaseId: string; supplierName: string; invoiceNumber: string; gapMinor: number }[];
  /** حركةُ شراءٍ لمورّدٍ مربوطٍ بلا فاتورةٍ عندنا. */
  purchaseMissing: { purchaseId: string; supplierName: string; invoiceNumber: string | null; totalMinor: number }[];
}

export const purchaseSignalKey = (purchaseId: string) => `foodics-purchase:${purchaseId}`;
export const invoiceSignalKey = (invoiceId: string) => `foodics-purchase:inv-${invoiceId}`;
/** مورّدٌ فواتيرُه لا تدخل مخزونَ فودكس أصلاً — قرارٌ واحد يُغني عن إسكاتها واحدةً واحدة. */
export const supplierSignalKey = (supplierId: string) => `foodics-purchase:sup-${supplierId}`;

export async function loadFoodicsAttentionFacts(): Promise<FoodicsAttentionFacts> {
  const since = addDays(todayInRiyadh(), -CARD_LOOKBACK_DAYS);
  const [{ card }, witness, cardSilenced, purchaseSilenced] = await Promise.all([
    loadCardComparison(since),
    loadPurchaseWitness(),
    loadFoodicsSilenced("foodics-card"),
    loadFoodicsSilenced("foodics-purchase"),
  ]);
  return {
    cardGaps: card.batches
      .filter((b) => (b.verdict === "BANK_SHORT" || b.verdict === "BANK_OVER") && !cardSilenced.has(cardGapKey(b.day)))
      .map((b) => ({ day: b.day, gapMinor: b.gapMinor })),
    purchaseDiffers: witness.comparison.matched
      .filter((m) => !m.agrees && !purchaseSilenced.has(purchaseSignalKey(m.purchase.id)))
      .map((m) => ({ purchaseId: m.purchase.id, supplierName: m.invoice.supplierName, invoiceNumber: m.invoice.invoiceNumber, gapMinor: m.gapMinor })),
    purchaseMissing: witness.comparison.onlyFoodics
      .filter((p) => p.linkedSupplierId !== null && !purchaseSilenced.has(purchaseSignalKey(p.id)))
      .map((p) => ({ purchaseId: p.id, supplierName: p.foodicsSupplierName ?? "مورّد بلا اسم", invoiceNumber: p.invoiceNumber, totalMinor: p.totalMinor })),
  };
}
