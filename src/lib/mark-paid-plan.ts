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

/**
 * «ادفع كذا فقط» — توزيعُ مبلغٍ جزئيّ على فواتير المورّد المفتوحة، **الأقدمُ أوّلاً**.
 *
 * المبلغُ يكتبه صاحبُ الدفعة في المتصفّح، فيُفحَص هنا على المفتوح كما قرأه الخادمُ
 * داخل المعاملة وبقفل الصفوف: عددٌ صحيح بالهللات، فوق الصفر، ولا يزيد على مجموع
 * المفتوح. والزائدُ **يُردّ ولا يُقصّ** — لو قُصّ لقرأ «سُجّل ما كتبتَ» ولم يُسجَّل.
 * `open` بترتيب السداد (تاريخُ الفاتورة ثمّ معرّفُها) كما يقفلها المسار.
 */
export type PartialSplit =
  | { ok: true; shares: { invoiceId: string; payMinor: number }[]; untouched: string[] }
  | { ok: false; reason: "NOT_AN_AMOUNT" | "EXCEEDS_OPEN"; openMinor: number };

export function distributePartial(
  open: readonly { invoiceId: string; openMinor: number }[],
  partialMinor: number,
): PartialSplit {
  const openMinor = open.reduce((s, i) => s + Math.max(0, i.openMinor), 0);
  if (!Number.isSafeInteger(partialMinor) || partialMinor <= 0) return { ok: false, reason: "NOT_AN_AMOUNT", openMinor };
  if (partialMinor > openMinor) return { ok: false, reason: "EXCEEDS_OPEN", openMinor };
  const shares: { invoiceId: string; payMinor: number }[] = [];
  const untouched: string[] = [];
  let left = partialMinor;
  for (const inv of open) {
    const pay = Math.min(Math.max(0, inv.openMinor), left);
    if (pay > 0) shares.push({ invoiceId: inv.invoiceId, payMinor: pay });
    else untouched.push(inv.invoiceId);
    left -= pay;
  }
  return { ok: true, shares, untouched };
}
