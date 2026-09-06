/**
 * توزيع الدفعة على الفواتير.
 *
 * القاعدة التي يفرضها هذا الملف: **مجموع ما يُخصَّص من دفعة لا يتجاوز
 * قيمتها**. وجدنا في بيانات حقيقية دفعةً بـ١٥٠٠٫٠٠ خُصّص منها ١٥٠٠٫٠١ —
 * هللةٌ واحدة، لكنّ معناها أنّ النظام يُنشئ مالاً لم يُدفع. والفرق بين
 * نظام محاسبي ونظام تقريبي هو أنّ الأوّل لا يسمح بذلك ولو بهللة.
 *
 * دالة خالصة: تأخذ أرقاماً وتُرجع خطّة. الكتابة مسؤولية الخدمة.
 */

export interface AllocationRequest {
  invoiceId: string;
  /** المطلوب تخصيصه لهذه الفاتورة */
  amountMinor: number;
}

export interface PlannedAllocation {
  invoiceId: string;
  amountMinor: number;
}

export interface AllocationPlan {
  allocations: PlannedAllocation[];
  allocatedMinor: number;
  /** ما بقي من الدفعة بلا تخصيص */
  remainingMinor: number;
  /** ما طُلب ولم يُخصَّص لأنّ الدفعة نفدت */
  shortfallMinor: number;
}

export function planAllocations(
  paymentAmountMinor: number,
  alreadyAllocatedMinor: number,
  requests: readonly AllocationRequest[],
): AllocationPlan {
  let remaining = Math.max(0, paymentAmountMinor - alreadyAllocatedMinor);
  const allocations: PlannedAllocation[] = [];
  let allocated = 0;
  let requested = 0;

  for (const req of requests) {
    const want = Math.max(0, req.amountMinor);
    requested += want;
    if (remaining <= 0 || want === 0) continue;

    // يُقتطع ما بقي لا ما طُلب — الدفعة لا تُخلق من العدم
    const amount = Math.min(want, remaining);
    allocations.push({ invoiceId: req.invoiceId, amountMinor: amount });
    remaining -= amount;
    allocated += amount;
  }

  return {
    allocations,
    allocatedMinor: allocated,
    remainingMinor: remaining,
    shortfallMinor: Math.max(0, requested - allocated),
  };
}

/* ─────────────────── سداد حساب المورّد ─────────────────── */

/**
 * المورّد محور المستحقّات، لا الفاتورة.
 *
 * كان النظام يسأل عن كل حوالة: **أيّ فاتورة تفسّرها؟** فإن لم يجد
 * فاتورةً بمبلغها بالضبط وقف — وفي كشف أحمد خمسٌ وستّون حركة كذلك،
 * بمئةٍ وستّةٍ وسبعين ألف ريال: مورّدها معروف، ومالُها خرج، ولا شيء
 * يُكتَب. وسببُ ذلك أنّ بعض مورّديه لا يعطون فاتورةً أصلاً — يعطون
 * كشف حساب، أو ورقةً باليد.
 *
 * والواقع أنّ الحوالة سدادٌ **لحساب المورّد**؛ والفواتير تفصيلٌ داخله.
 * فتُقيَّد الدفعة، ثمّ تُوزَّع على ما هو مفتوح — والباقي يبقى «غير
 * مخصَّص»، وهي حالٌ صحيحة لا نقص.
 *
 * والترتيب سياسة معلنة: **الأقدم أوّلاً.** لا يكسرها إلّا رقمُ فاتورةٍ
 * في الحوالة، أو توزيعٌ يكتبه صاحب العمل بيده — ولا يخترعها المحسِّن
 * ليرفع درجةً.
 */
export interface OpenInvoice {
  invoiceId: string;
  invoiceDate: Date;
  outstandingMinor: number;
}

/**
 * لا تُسدَّد فاتورةٌ لم تكن قد وُجدت.
 *
 * والسبعةُ أيّام تسامحٌ مقصود: الفاتورة تُكتب بتاريخ التسليم وتصل
 * بعده، والحوالة قد تسبقها بأيّام. أمّا ما جاوز ذلك فسدادٌ مقدَّم،
 * وهو قرارُ إنسان لا استنتاجُ آلة.
 */
export const SETTLEMENT_FORWARD_DAYS = 7;

export function settleSupplierAccount(
  paymentAmountMinor: number,
  paidAt: Date,
  invoices: readonly OpenInvoice[],
): AllocationPlan {
  const horizon = paidAt.getTime() + SETTLEMENT_FORWARD_DAYS * 86_400_000;

  const eligible = invoices
    .filter((i) => i.outstandingMinor > 0 && i.invoiceDate.getTime() <= horizon)
    .sort((a, b) =>
      a.invoiceDate.getTime() - b.invoiceDate.getTime()
      || a.invoiceId.localeCompare(b.invoiceId));

  return planAllocations(
    paymentAmountMinor,
    0,
    eligible.map((i) => ({ invoiceId: i.invoiceId, amountMinor: i.outstandingMinor })),
  );
}
