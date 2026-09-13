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

/* ─────────────────── رصيدُ المورّد على فواتيره ─────────────────── */

/**
 * ما بقي من دفعةٍ بلا تخصيص — مالٌ خرج إلى المورّد ولم يُخصم من شيء.
 */
export interface AvailableCredit {
  paymentId: string;
  paidAt: Date;
  /** المتاح للتخصيص: المبلغ ناقص الرسم ناقص ما خُصّص. */
  availableMinor: number;
}

export interface CreditAllocation {
  paymentId: string;
  invoiceId: string;
  amountMinor: number;
}

export interface CreditPlan {
  allocations: CreditAllocation[];
  appliedMinor: number;
  /** ما بقي لنا عند المورّد بعد الخصم. */
  creditLeftMinor: number;
  /** ما بقي علينا من الفواتير بعد الخصم. */
  openLeftMinor: number;
}

/**
 * رصيدٌ لنا عند المورّد، وفواتير مفتوحة له — فيُخصم أحدهما من الآخر.
 *
 * **وكان هذا لا يقع أبداً.** الدفعة تُوزَّع لحظةَ قيدها على ما هو مفتوح
 * يومئذٍ، وما بقي منها يبقى معلّقاً. فإن وصلت الفاتورة بعد الحوالة —
 * وهو الغالب: لوريفا حُوِّل لها في ٢ سبتمبر ووصلت فواتيرها في ٤ و٧ —
 * بقيت الفاتورة «مستحقّة» والمال عند المورّد، ويقول النظام «عليك» عن
 * مالٍ دُفع.
 *
 * والترتيب هو سياسة السداد نفسها: أقدمُ دفعةٍ على أقدم فاتورة.
 *
 * و`forwardDays` حدُّ ما يُفعَل **آلياً**: فاتورةٌ بعد الحوالة بسبعة
 * أيّام تحتملها الحوالة (تسليمٌ ثمّ فاتورة)، وما جاوز ذلك سدادٌ مقدَّم
 * يقرّره إنسان — فيُمرَّر `null` حين يقرّر هو.
 */
export function planCreditApplication(
  credits: readonly AvailableCredit[],
  invoices: readonly OpenInvoice[],
  options: { forwardDays: number | null },
): CreditPlan {
  const open = [...invoices]
    .filter((i) => i.outstandingMinor > 0)
    .sort((a, b) =>
      a.invoiceDate.getTime() - b.invoiceDate.getTime()
      || a.invoiceId.localeCompare(b.invoiceId))
    .map((i) => ({ ...i, left: i.outstandingMinor }));

  const ordered = [...credits]
    .filter((c) => c.availableMinor > 0)
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime() || a.paymentId.localeCompare(b.paymentId));

  const allocations: CreditAllocation[] = [];
  let applied = 0;
  let creditLeft = 0;

  for (const c of ordered) {
    let available = c.availableMinor;
    const horizon = options.forwardDays === null
      ? Number.POSITIVE_INFINITY
      : c.paidAt.getTime() + options.forwardDays * 86_400_000;

    for (const inv of open) {
      if (available <= 0) break;
      if (inv.left <= 0 || inv.invoiceDate.getTime() > horizon) continue;
      const amount = Math.min(available, inv.left);
      allocations.push({ paymentId: c.paymentId, invoiceId: inv.invoiceId, amountMinor: amount });
      inv.left -= amount;
      available -= amount;
      applied += amount;
    }
    creditLeft += available;
  }

  return {
    allocations,
    appliedMinor: applied,
    creditLeftMinor: creditLeft,
    openLeftMinor: open.reduce((s, i) => s + i.left, 0),
  };
}
