/**
 * تقريرُ جرد السبت PDF من «TPH Team» — برمز الرابط ولمن أذن له المالك وحده. يُنزَّل في الجوال ثمّ
 * يُشارَك واتساب (`count-panel.tsx`). لا يُخزَّن ولا يُفهرس: يُرسم ممّا حُفظ لحظةَ الطلب.
 */
import { NextResponse } from "next/server";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { failWith } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { resolveCheckinToken } from "@/services/payroll.service";
import { teamCountPdf } from "@/services/team-count.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const employee = await resolveCheckinToken(token);
    if (!employee) return NextResponse.json({ error: "هذا الرابط لم يعد يعمل. اطلب رابطاً جديداً من الإدارة." }, { status: 404 });
    if (!employee.canCountInventory) return NextResponse.json({ error: "الجرد ليس من صلاحيات رابطك." }, { status: 403 });
    await consume("team-count", employee.id);
    const { pdf, fileName } = await teamCountPdf(todayInRiyadh(), { employeeId: employee.id, name: employee.name });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="count.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  } catch (e) {
    return failWith(e, "team-count-pdf");
  }
}
