import { permanentRedirect } from "next/navigation";

/**
 * لوحة القيادة القديمة صارت الرئيسية.
 *
 * كانت تعرض الأرقام نفسها بترتيب آخر — أربعمئة سطر تكرّر ما في `/`
 * و`/performance`. ولا تُحذف بلا تحويل: الروابط المحفوظة في متصفّح
 * أحمد لا يجوز أن تنكسر.
 */
export default function LegacyDashboard(): never {
  permanentRedirect("/");
}
