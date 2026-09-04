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
