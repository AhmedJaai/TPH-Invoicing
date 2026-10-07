/**
 * «سجّل أنّها سُدّدت» — كم دفعةً تُكتب؟
 *
 * **دفعةٌ لكلّ حوالة لا لكلّ فاتورة.** صاحبُ المقهى يحوّل للمورّد مبلغاً
 * واحداً عن عشر فواتير (وملفُّ التحويلات صفٌّ لكلّ مورّد)، وكان الإقرار يقيّد
 * عشر دفعات: فلا تجد حوالةُ الكشف توأماً بمبلغها وتُحال إلى «الصدى على رصيد»
 * الذي يحتاج إقراراً باليد. وفاتورتان بالمبلغ نفسه (بيكوف بمئةٍ وخمسين) كانت
 * ثانيتُهما توأمَ الأولى فيسقط الطلبُ كلُّه.
 *
 * فما بقي على فواتير المورّد الواحد في الطلب دفعةٌ واحدة بمجموعه، تُخصَّص
 * عليها. وشهرُها الأحدثُ بين فواتيرها (قرارٌ قائم). وفاتورةٌ بلا مورّد
 * دفعتُها وحدها — لا يُجمَع ما لا يُعرف صاحبُه.
 *
 * دالّةٌ خالصة: الخادمُ يحسب المتبقّي (بعد حوالات الكشف) ثمّ يسأل هنا.
 */
export interface MarkPaidRest {
  invoiceId: string;
  supplierId: string | null;
  periodMonth: string;
  /** ما بقي على الفاتورة بعد ما نُسب لها من حوالات الكشف — بالهللات. */
  restMinor: number;
}

export interface PlannedHandPayment {
  supplierId: string | null;
  amountMinor: number;
  appliesToMonth: string;
  allocations: { invoiceId: string; amountMinor: number }[];
}

export function planHandPayments(rests: readonly MarkPaidRest[]): PlannedHandPayment[] {
  const out: PlannedHandPayment[] = [];
  const bySupplier = new Map<string, PlannedHandPayment>();
  for (const r of rests) {
    if (!Number.isInteger(r.restMinor) || r.restMinor <= 0) continue;
    const share = { invoiceId: r.invoiceId, amountMinor: r.restMinor };
    const group = r.supplierId ? bySupplier.get(r.supplierId) : undefined;
    if (group) {
      group.amountMinor += r.restMinor;
      group.allocations.push(share);
      if (r.periodMonth > group.appliesToMonth) group.appliesToMonth = r.periodMonth;
      continue;
    }
    const fresh: PlannedHandPayment = {
      supplierId: r.supplierId,
      amountMinor: r.restMinor,
      appliesToMonth: r.periodMonth,
      allocations: [share],
    };
    out.push(fresh);
    if (r.supplierId) bySupplier.set(r.supplierId, fresh);
  }
  return out;
}
