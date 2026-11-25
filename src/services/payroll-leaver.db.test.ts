import { describe, expect, it } from "vitest";
import { employeeRates, employees, payrollAttendance } from "@/db/schema";
import { loadPayrollMonths } from "./payroll.service";
import { withRollback } from "@/test/db";

/**
 * مَن ترك العمل بين ٢٧ وآخر الشهر يُدفع له عن تلك الأيّام في شهره الأخير — وحضورُها في فترة الشهر
 * التالي الذي لا يعمل فيه. فغيابُ أيّامه الأخيرة يُخصم في شهره الأخير، ولا يُقرأ مرّةً ثانية بعده.
 */
describe("غيابُ الأيّام الأخيرة لمن ترك العمل", { timeout: 120_000 }, () => {
  it("ترك ٢٩ أكتوبر وغاب ٢٧–٢٩: تُخصم الثلاثة في أكتوبر", () =>
    withRollback(async (tx) => {
      const [e] = await tx.insert(employees).values({ name: "موظف تجريبي", kind: "MONTHLY", hiredOn: "2099-01-01", leftOn: "2099-10-29" }).returning({ id: employees.id });
      await tx.insert(employeeRates).values({ employeeId: e.id, fromMonth: "2099-01", amountMinor: 3_000_00 });
      for (const day of ["2099-10-27", "2099-10-28", "2099-10-29"]) {
        await tx.insert(payrollAttendance).values({ employeeId: e.id, day, kind: "ABSENT", source: "MANUAL" });
      }
      const [oct, nov] = await loadPayrollMonths(["2099-10", "2099-11"], tx);
      const row = oct.rows.find((r) => r.employee.id === e.id)!;
      expect(row.slip.absentDays).toBe(3);
      expect(row.slip.absenceMinor).toBe(300_00);
      expect(nov.rows.find((r) => r.employee.id === e.id)).toBeUndefined();
    }));
});
