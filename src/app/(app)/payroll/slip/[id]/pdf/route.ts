/**
 * قسيمةُ الراتب PDF — للمالك، يرسلها للموظّف (`slip-pdf-button.tsx`). تُرسم ممّا في المسيّر لحظةَ الطلب
 * ولا تُخزَّن.
 */
import { NextResponse } from "next/server";
import { currentMonthRiyadh } from "@/lib/riyadh-time";
import { failWith, guard } from "@/services/guard";
import { slipPdf } from "@/services/payslip-pdf.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[\w-]{1,64}$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await guard("payroll-slip-pdf", "payroll:view");
    const { id } = await params;
    if (!ID_RE.test(id)) return NextResponse.json({ error: "موظف غير معروف" }, { status: 400 });
    const q = new URL(request.url).searchParams.get("month");
    const month = q && MONTH_RE.test(q) ? q : currentMonthRiyadh();
    const { pdf, fileName } = await slipPdf(id, month);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="payslip-${month}.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  } catch (e) {
    return failWith(e, "payroll-slip-pdf");
  }
}
