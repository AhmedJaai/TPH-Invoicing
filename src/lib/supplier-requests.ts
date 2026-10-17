import { formatRiyalsDisplay } from "./money";
import { MS_PER_DAY } from "@/lib/riyadh-time";

/**
 * ما يُطلَب من المورّد — فاتورةٌ لمالٍ خرج بلا مستند، وكشفٌ غاب.
 *
 * كان التنبيه يقول «13 دفعة بلا فاتورة ← افتح المورّدين» فتُفتح قائمةٌ
 * عامّة لا تذكر دفعةً واحدة، ويعود صاحب العمل إلى التنبيه ليحفظ الأسماء
 * بعينه. فالقائمة هنا مورّداً مورّداً، ومع كلٍّ رسالتُه جاهزةً.
 */

export interface UnbackedPayment {
  paymentId: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierSlug: string | null;
  /** رقمُه بصيغة E.164 إن كُتب في ملفّه — يُفتح واتساب عليه لا على شاشة اختيار جهة. */
  supplierPhone?: string | null;
  /** YYYY-MM-DD */
  paidOn: string;
  amountMinor: number;
  /** ما بقي منها بلا فاتورة — لا الدفعة كلّها. */
  unbackedMinor: number;
  /** حركة البنك التي قُيّدت منها — إن وُجدت. */
  bankTransactionId: string | null;
  /** إيصالُها في الدرايف — منه يُعرَف لمن حُوّلت حين لا مورّد ولا حركة. */
  receiptDriveFileId?: string | null;
  /**
   * أيصدر هذا المورّد فواتير؟ — تتبعه **صياغةُ الطلب** لا العدّ.
   * ومن لا يصدر يُطلَب منه عقدُ توريد، ويبقى مالُه معدوداً.
   */
  issuesInvoices: boolean;
}

export interface UnbackedSupplier {
  supplierId: string | null;
  supplierName: string;
  supplierSlug: string | null;
  supplierPhone?: string | null;
  totalMinor: number;
  payments: UnbackedPayment[];
}

/**
 * يجمع الدفعات بمورّدها، الأثقل أوّلاً — وما لا مورّد له آخراً: لا يُطلَب
 * منه شيء قبل أن تُعرَف جهته.
 */
export function groupUnbackedBySupplier(rows: readonly UnbackedPayment[]): UnbackedSupplier[] {
  const groups = new Map<string, UnbackedSupplier>();
  for (const r of rows) {
    const key = r.supplierId ?? "~";
    const g = groups.get(key) ?? {
      supplierId: r.supplierId,
      supplierName: r.supplierName ?? "بلا مورّد",
      supplierSlug: r.supplierSlug,
      supplierPhone: r.supplierPhone ?? null,
      totalMinor: 0,
      payments: [],
    };
    g.totalMinor += r.unbackedMinor;
    g.payments.push(r);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.payments.sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  return [...groups.values()].sort(
    (a, b) => Number(a.supplierId === null) - Number(b.supplierId === null) || b.totalMinor - a.totalMinor,
  );
}

/** رسالة «اطلب الفاتورة» — بتاريخ كلّ حوالةٍ ومبلغها، ليبحث بها المورّد في سجلّه. */
export function buildInvoiceRequest(group: UnbackedSupplier): string {
  const lines = group.payments.map((p) =>
    `• ${p.paidOn}: حوالة ${formatRiyalsDisplay(p.amountMinor)} ريال`
    + (p.unbackedMinor < p.amountMinor ? ` (المتبقي بلا فاتورة منها: ${formatRiyalsDisplay(p.unbackedMinor)}` : ""),
  );
  return [
    `السلام عليكم ${group.supplierName}،`,
    ``,
    `حوّلت لكم مؤسسة ذا بوبليك هاوس المبالغ التالية ولم تصلنا فواتيرها:`,
    ...lines,
    ``,
    `نرجو إرسال الفواتير الضريبية باسم المؤسسة ورقمها الضريبي 310007971600003.`,
    `شاكرين لكم.`,
  ].join("\n");
}

/** رسالة «اطلب الكشف» — عن شهرٍ بعينه. */
export function buildStatementRequest(supplierName: string, month: string): string {
  return [
    `السلام عليكم ${supplierName}،`,
    ``,
    `نرجو إرسال كشف حساب مؤسسة ذا بوبليك هاوس (الرقم الضريبي 310007971600003) عن شهر ${month}،`
      + ` متضمناً الفواتير والسدادات والرصيد الختامي.`,
    `شاكرين لكم.`,
  ].join("\n");
}

/**
 * «لك عنده» أم «دفعتَ له بلا فاتورة»؟ (SCN-105)
 *
 * كانت الصفحة تكتب «لك عنده ٢٦٬٧٦٧» لكلّ مالٍ دُفع فوق الفواتير — وهي
 * تُقرأ ديناً على المورّد، فيُطالَب غاناش بمالٍ هو في الغالب فواتير لم
 * تصلنا. والتنبيه يسمّي المال نفسه «لم يُنسب بعد». فالاسم يتبع ما نعرف:
 * المقدَّمة المعلَنة وحدها «لك عنده»، وما عداها «دفعتَ له بلا فاتورة».
 */
export function splitSupplierCredit(creditMinor: number, advanceMinor: number): {
  advanceMinor: number;
  unbackedMinor: number;
} {
  const credit = Math.max(0, creditMinor);
  const advance = Math.min(credit, Math.max(0, advanceMinor));
  return { advanceMinor: advance, unbackedMinor: credit - advance };
}

export interface PriceRiseFacts {
  supplierName: string;
  itemName: string;
  previousMinor: number;
  currentMinor: number;
  /** YYYY-MM-DD */
  previousDay: string;
  currentDay: string;
  /** معدّلُ الشراء السنويّ (`yearlyQuantity`) — `null` إن جُهل، فلا يُذكر أثرٌ سنويّ. */
  yearQuantity: number | null;
}

/**
 * رسالةُ «السعر ارتفع» للمورّد — بالدليل: السعران وتاريخاهما، والأثرُ السنويّ بكمّيّة
 * ما اشتُري فعلاً إن عُرفت. قالبٌ حتميّ لا نموذج، وصاحبُ المقهى يعدّلها قبل إرسالها.
 * والأثرُ يُحذف (لا يُقدَّر) حين تُجهل الكمّيّة أو لا يكون السعرُ ارتفع.
 */
export function buildPriceRiseMessage(f: PriceRiseFacts): string {
  const delta = f.currentMinor - f.previousMinor;
  const annual = f.yearQuantity !== null && f.yearQuantity > 0 && delta > 0 ? Math.round(delta * f.yearQuantity) : null;
  return [
    `السلام عليكم ${f.supplierName}،`,
    ``,
    `لاحظنا تغيّراً في سعر «${f.itemName}» في فواتيركم لمؤسسة ذا بوبليك هاوس:`,
    `• ${f.previousDay}: ${formatRiyalsDisplay(f.previousMinor)} ريال للوحدة`,
    `• ${f.currentDay}: ${formatRiyalsDisplay(f.currentMinor)} ريال للوحدة (بزيادة ${formatRiyalsDisplay(delta)})`,
    ...(annual !== null ? [`وبحسب معدل شرائنا منكم تبلغ الزيادة نحو ${formatRiyalsDisplay(annual)} ريال سنوياً.`] : []),
    ``,
    `نرجو إفادتنا بسبب التغيّر، وبإمكانية العودة إلى السعر السابق.`,
    `شاكرين لكم.`,
  ].join("\n");
}

/** أقصرُ تاريخِ شراءٍ يُبنى عليه معدّلٌ سنويّ — دونه شهران لا يقولان شيئاً عن سنة. */
export const YEARLY_RATE_MIN_DAYS = 60;

/**
 * معدّلُ الشراء السنويّ من الكمّيّة الكلّيّة ومدّتها — `null` إن جُهلت الكمّيّة أو قصرت
 * المدّة. تقديرٌ يُقال «نحو»، لا رقمٌ واقع.
 */
export function yearlyQuantity(totalQuantity: number | null, firstDay: Date | null, lastDay: Date | null): number | null {
  if (totalQuantity === null || totalQuantity <= 0 || !firstDay || !lastDay) return null;
  const days = Math.round((lastDay.getTime() - firstDay.getTime()) / MS_PER_DAY);
  if (days < YEARLY_RATE_MIN_DAYS) return null;
  return Math.round((totalQuantity * 365) / days);
}

/**
 * مفتاحُ «طولب بفواتيره» — المورّدُ وأقدمُ دفعةٍ بلا مستند عنده. فإن وصلت فواتيرُها
 * وجاءت دفعاتٌ جديدة تغيّر المفتاح: طلبٌ قديم لا يُحسب على مطالبةٍ لم تقع.
 * `null` لما لا مورّدَ له — لا يُطلَب منه شيء.
 */
export function invoiceRequestKey(group: Pick<UnbackedSupplier, "supplierId" | "payments">): string | null {
  const oldest = group.payments[0];
  if (!group.supplierId || !oldest) return null;
  return `supplier-request:${group.supplierId}:${oldest.paymentId}`;
}

/** بعد كم يوماً من الطلب يُقال «ذكِّره». */
export const REMIND_AFTER_DAYS = 7;

/** «طولب اليوم» · «طولب قبل ٩ أيّام — ذكِّره» */
export function describeRequested(daysAgo: number): string {
  const when = daysAgo <= 0 ? "اليوم" : daysAgo === 1 ? "أمس" : daysAgo === 2 ? "قبل يومين" : daysAgo <= 10 ? `قبل ${daysAgo} أيّام` : `قبل ${daysAgo} يوماً`;
  return daysAgo >= REMIND_AFTER_DAYS ? `طُولب ${when}، وحان وقت التذكير` : `طُولب ${when}`;
}
