import type { Payslip } from "./calc";

/**
 * حالُ الموظّف في شهرٍ: وصله شيء؟ كلُّه؟ أكثر؟ — جوابُ «من قبض ومن لم يقبض».
 *
 * من القسيمة وحدها (`payslip`)، فلا قاعدةٌ ثانية: «اكتمل» هو `remainingMinor ≤ 0`
 * كما يعدّه المسيّر. والمجهولُ (راتبٌ لم يُكتب) حالٌ وحده — لا يُعدّ «لم يصله شيء»
 * ولا «اكتمل»؛ فلا يُعرف كم يستحقّ.
 */
export type PayStatus = "NONE" | "PARTIAL" | "UNKNOWN" | "OVER" | "DONE";

export function payStatus(slip: Pick<Payslip, "dueMinor" | "paidMinor" | "remainingMinor">): PayStatus {
  if (slip.dueMinor === null || slip.remainingMinor === null) return "UNKNOWN";
  if (slip.remainingMinor < 0) return "OVER";
  if (slip.remainingMinor === 0) return "DONE";
  return slip.paidMinor > 0 ? "PARTIAL" : "NONE";
}

/** ترتيبُ المجموعات في الصفحة: ما يحتاج فعلاً أوّلاً، والمكتملُ آخراً. */
export const PAY_STATUS_ORDER: readonly PayStatus[] = ["NONE", "PARTIAL", "UNKNOWN", "OVER", "DONE"];

/**
 * كم يوماً حتى يوم الصرف لراتب `month` — `null` إن مضى أو لم يكن الشهرَ الجاري.
 * يومُ الصرف في الشهر نفسه (`PAYDAY`)، و`today` بتوقيت الرياض «YYYY-MM-DD».
 */
export function daysToPayday(month: string, today: string, payday: number): number | null {
  if (today.slice(0, 7) !== month) return null;
  const day = Number(today.slice(8, 10));
  return day <= payday ? payday - day : null;
}
