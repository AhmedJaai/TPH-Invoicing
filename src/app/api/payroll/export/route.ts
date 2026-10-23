/**
 * المسيّرُ ملفّاً (CSV) — للمحاسب أو لرفع التحويلات. الأرقامُ نفسُها التي تعرضها الصفحة.
 */
import { NextResponse } from "next/server";
import { formatRiyals } from "@/lib/money";
import { currentMonthRiyadh } from "@/lib/riyadh-time";
import { failWith, guard } from "@/services/guard";
import { loadPayrollMonth } from "@/services/payroll.service";

export const runtime = "nodejs";

const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (minor: number | null) => (minor === null ? "غير معروف" : formatRiyals(minor));

export async function GET(request: Request) {
  try {
    await guard("payroll-export", "payroll:view");
    const m = new URL(request.url).searchParams.get("month") ?? "";
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : currentMonthRiyadh();
    const sheet = await loadPayrollMonth(month);
    const head = ["الموظف", "النوع", "الآيبان", "رقم المستفيد", "الراتب", "الإضافات", "الخصومات", "دقائق التأخير", "أيام الغياب", "السلف نقداً", "المستحق", "حُوّل", "الباقي للتحويل"];
    const lines = sheet.rows.map((r) => [
      r.employee.name, r.employee.kind === "PART_TIME" ? "جزئي" : "شهري", r.employee.iban, r.employee.bankBeneficiaryId,
      money(r.slip.baseMinor), money(r.slip.additionsMinor), money(r.slip.deductionsMinor), r.slip.lateMinutes + r.slip.earlyMinutes,
      r.slip.absentDays, money(r.slip.advancesMinor), money(r.slip.dueMinor), money(r.slip.paidMinor), money(r.slip.remainingMinor),
    ].map(cell).join(","));
    const body = "﻿" + [head.map(cell).join(","), ...lines].join("\r\n");
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="payroll-${month}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return failWith(e, "payroll-export");
  }
}
