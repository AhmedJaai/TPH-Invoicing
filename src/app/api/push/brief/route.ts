/**
 * نصُّ إشعار الصباح — يسأله عاملُ الخدمة بجلسة صاحب الجهاز حين يصله النداءُ الفارغ.
 *
 * من مصادر «اليوم» نفسها (عددُ «يحتاج قرارك» · الدفعةُ الجاهزة · «أيعرف شيئاً؟») وبلا
 * مبالغ: النصُّ يظهر على شاشة القفل (`pushBriefText`). ومن انتهت جلستُه يُردّ ٤٠١،
 * فيعرض العاملُ «افتح التطبيق» — لا رقماً قديماً ولا شيئاً من غيره.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { can } from "@/lib/permissions";
import { workCount } from "@/lib/work";
import { pushBriefText } from "@/lib/push/web-push";
import { previousMonth } from "@/lib/filing";
import { currentMonthRiyadh } from "@/lib/riyadh-time";
import { loadStartState } from "@/services/start.service";
import { loadPaymentRun } from "@/services/payment-run.service";

export const runtime = "nodejs";

export async function GET() {
  /* الطلبُ كلُّه لا الحارسُ وحده: خطأُ عملٍ معروف يُقال بنصّه لا ٥٠٠ */
  try {
    return await handle();
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}

async function handle() {
  const user = await guard("push-brief", "amounts:view");
  const canPay = can(user.role, "payment:approve");
  const [pending, start, run] = await Promise.all([
    workCount(user.role),
    loadStartState(),
    canPay ? loadPaymentRun(previousMonth(currentMonthRiyadh())) : Promise.resolve(null),
  ]);
  const text = pushBriefText({ knowsNothing: start.knowsNothing, pending, runReady: !!run && run.readyTotalMinor > 0 });
  return NextResponse.json({ ...text, url: "/" }, { headers: { "cache-control": "no-store" } });
}
