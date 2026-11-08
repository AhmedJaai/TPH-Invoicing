/**
 * نصُّ تنبيه «TPH Team» — يسأله عاملُ الخدمة برمز الرابط حين يصله النداءُ الفارغ.
 *
 *   GET ?token=… → { title, body, url }
 *
 * بلا أسماء مورّدين ولا مبالغ: النصُّ يظهر على شاشة القفل.
 */
import { NextResponse } from "next/server";
import { resolveCheckinToken } from "@/services/payroll.service";
import { unenteredCount } from "@/services/team-invoices.service";
import { teamAppPath } from "@/lib/team-app";
import { countNoun, INVOICE } from "@/lib/arabic";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const employee = await resolveCheckinToken(token).catch(() => null);
  if (!employee || !token) return NextResponse.json({ error: "الرابط لا يعمل" }, { status: 404 });
  const n = employee.invoicesSince ? await unenteredCount(employee.invoicesSince).catch(() => 0) : 0;
  const body = n > 0 ? `وصلت فاتورة جديدة. ${countNoun(n, INVOICE)} لم تُدخل في فودكس بعد.` : "وصلت فاتورة جديدة.";
  return NextResponse.json({ title: "TPH Team", body, url: `${teamAppPath(token)}?tab=invoices` }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
