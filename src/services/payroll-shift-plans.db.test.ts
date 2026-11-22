import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { attendanceCheckins, employeeShiftPlans, employees, payrollAttendance, users } from "@/db/schema";
import { shiftOn } from "@/lib/payroll/attendance";
import { clearLeave, loadEmployee, loadLeave, PayrollRefused, removeShiftPlan, saveShift, setLeave } from "./payroll.service";
import { caught, withRollback } from "@/test/db";
import type { Tx } from "./types";

/**
 * الدوامُ يتغيّر من تاريخ (106)، والإجازةُ من يومٍ إلى يوم — يُحكم بهما على أيّامٍ تُخصم من الراتب،
 * فالحدُّ المختبَر: ما قبل التاريخ يبقى بدوامه، وما بعده بالجديد، وما حُسب من الحضور يُعاد بعدل.
 */
const TODAY = "2026-11-21"; // السبت · وفترةُ الخصم ٢٧ أكتوبر – ٢٦ نوفمبر

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `t-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

/** شهريٌّ دوامُه ٤ عصراً ثماني ساعات، وراحتُه الجمعة. */
async function barista(tx: Tx): Promise<string> {
  const [e] = await tx.insert(employees).values({ name: "أنس", kind: "MONTHLY", hiredOn: "2026-05-01", shiftStart: "16:00", shiftMinutes: 480, daysOff: "5" }).returning({ id: employees.id });
  return e.id;
}

const shift = (shiftStart: string, fromDay?: string, daysOff = "5") => ({ shiftStart, shiftMinutes: 480, lateGraceMinutes: 0, daysOff, fromDay });

describe("saveShift — نافذٌ من تاريخ", { timeout: 90_000 }, () => {
  it("تغييرٌ قادم لا يمسّ اليوم، ويبدأ وحده في يومه", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const id = await barista(tx);
      await saveShift(id, shift("09:00", "2026-12-01", "6"), me, TODAY, tx);

      const plans = await tx.select().from(employeeShiftPlans).where(eq(employeeShiftPlans.employeeId, id)).orderBy(employeeShiftPlans.fromDay);
      expect(plans.map((p) => [p.fromDay, p.shiftStart, p.daysOff])).toEqual([["2026-05-01", "16:00", "5"], ["2026-12-01", "09:00", "6"]]);
      /* الصفُّ على دوام اليوم */
      const [row] = await tx.select().from(employees).where(eq(employees.id, id));
      expect([row.shiftStart, row.daysOff]).toEqual(["16:00", "5"]);

      const view = (await loadEmployee(id, tx))!;
      expect(shiftOn("2026-11-30", view, view.shiftRules)).toEqual({ off: false, start: "16:00", minutes: 480, source: "BASE" });
      expect(shiftOn("2026-12-01", view, view.shiftRules)).toEqual({ off: false, start: "09:00", minutes: 480, source: "BASE" });
      expect(shiftOn("2026-12-04", view, view.shiftRules)).toEqual({ off: false, start: "09:00", minutes: 480, source: "BASE" }); // الجمعة صارت دواماً
      expect(shiftOn("2026-12-05", view, view.shiftRules)).toEqual({ off: true }); // والسبتُ راحة

      /* مرّتين = مرّة: سطرُ اليوم نفسِه يُستبدل */
      await saveShift(id, shift("09:30", "2026-12-01", "6"), me, TODAY, tx);
      const again = await tx.select().from(employeeShiftPlans).where(eq(employeeShiftPlans.employeeId, id));
      expect(again.length).toBe(2);
      expect(again.find((p) => p.fromDay === "2026-12-01")?.shiftStart).toBe("09:30");

      /* والقادمُ يُلغى، والبادئُ لا */
      expect(await removeShiftPlan(id, "2026-12-01", me, TODAY, tx)).toBe(true);
      expect(await caught(removeShiftPlan(id, "2026-05-01", me, TODAY, tx))).toBeInstanceOf(PayrollRefused);
    }));

  it("تغييرٌ بتاريخٍ مضى يُعيد حسابَ ما حُسب من الحضور منذه، ولا يمسّ ما قبله ولا ما كتبه المالك", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const id = await barista(tx);
      /* حضر ٤:٣٠ في ١٨ و١٩ نوفمبر (١٣:٣٠ بتوقيت غرينتش)، فحُسب تأخيرُ ٣٠ دقيقة لكلٍّ */
      for (const d of ["2026-11-18", "2026-11-19"]) {
        await tx.insert(attendanceCheckins).values({ employeeId: id, kind: "IN", at: new Date(`${d}T13:30:00Z`), day: d, verdict: "IN_PLACE" });
        await tx.insert(payrollAttendance).values({ employeeId: id, day: d, kind: "LATE", minutes: 30, source: "CHECKIN" });
      }
      /* وفي ٢٠ نوفمبر كتب المالك بيده ٤٥ دقيقة */
      await tx.insert(attendanceCheckins).values({ employeeId: id, kind: "IN", at: new Date("2026-11-20T13:30:00Z"), day: "2026-11-20", verdict: "IN_PLACE" });
      await tx.insert(payrollAttendance).values({ employeeId: id, day: "2026-11-20", kind: "LATE", minutes: 45, source: "MANUAL" });

      /* صار دوامُه من ١٩ نوفمبر ٤:١٥ */
      const saved = await saveShift(id, shift("16:15", "2026-11-19"), me, TODAY, tx);
      expect(saved.recalculated).toBe(1);

      const late = await tx.select({ day: payrollAttendance.day, minutes: payrollAttendance.minutes, source: payrollAttendance.source }).from(payrollAttendance)
        .where(and(eq(payrollAttendance.employeeId, id), isNull(payrollAttendance.voidedAt))).orderBy(payrollAttendance.day);
      expect(late).toEqual([
        { day: "2026-11-18", minutes: 30, source: "CHECKIN" }, // قبل التاريخ: كما كان
        { day: "2026-11-19", minutes: 15, source: "CHECKIN" }, // بالدوام الجديد
        { day: "2026-11-20", minutes: 45, source: "MANUAL" }, // ما كتبه المالك يبقى
      ]);
      /* ومرّةً ثانية لا تغيّر شيئاً */
      expect((await saveShift(id, shift("16:15", "2026-11-19"), me, TODAY, tx)).recalculated).toBe(0);

      /* وصار ٤:٣٠ — فلا تأخير في ١٩: يُلغى البند ولا يُحذف */
      expect((await saveShift(id, shift("16:30", "2026-11-19"), me, TODAY, tx)).recalculated).toBe(1);
      const [voided] = await tx.select().from(payrollAttendance).where(and(eq(payrollAttendance.employeeId, id), eq(payrollAttendance.day, "2026-11-19")));
      expect(voided.voidedAt).not.toBeNull();
    }));

  it("تغييرٌ «من اليوم» يُعيد حسابَ ما حُسب اليومَ بالدوام القديم", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const id = await barista(tx);
      /* دخل ٧:٥٥ صباحاً وخرج ٤:١٦ عصراً، فحُسب خروجٌ مبكّر بدوام ٤ عصراً */
      await tx.insert(attendanceCheckins).values({ employeeId: id, kind: "IN", at: new Date(`${TODAY}T04:55:00Z`), day: TODAY, verdict: "IN_PLACE" });
      await tx.insert(attendanceCheckins).values({ employeeId: id, kind: "OUT", at: new Date(`${TODAY}T13:16:00Z`), day: TODAY, verdict: "IN_PLACE" });
      await tx.insert(payrollAttendance).values({ employeeId: id, day: TODAY, kind: "EARLY", minutes: 464, source: "CHECKIN" });

      const saved = await saveShift(id, shift("07:00", TODAY), me, TODAY, tx);
      expect(saved.recalculated).toBe(1);
      const rows = await tx.select({ kind: payrollAttendance.kind, minutes: payrollAttendance.minutes }).from(payrollAttendance)
        .where(and(eq(payrollAttendance.employeeId, id), isNull(payrollAttendance.voidedAt)));
      expect(rows).toEqual([{ kind: "LATE", minutes: 55 }]); // المبكّرُ أُلغي، والتأخيرُ بالدوام الجديد حُسب
    }));

  it("تاريخٌ بعد خروجه أو أبعد من سنة يُرفض", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const id = await barista(tx);
      await tx.update(employees).set({ leftOn: "2026-11-30" }).where(eq(employees.id, id));
      expect(await caught(saveShift(id, shift("09:00", "2026-12-01"), me, TODAY, tx))).toBeInstanceOf(PayrollRefused);
      expect(await caught(saveShift(id, shift("09:00", "2028-01-01"), me, TODAY, tx))).toBeInstanceOf(PayrollRefused);
    }));
});

describe("setLeave — إجازةٌ من يومٍ إلى يوم", { timeout: 90_000 }, () => {
  it("أيّامُ العمل إجازة، وأيّامُ الراحة تُترك، وتُقرأ سطراً واحداً وتُزال كلُّها", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const id = await barista(tx);
      /* الخميس ٢٦ → الأحد ٢٩ نوفمبر، والجمعة راحتُه. وفي الخميس تأخيرٌ يحلّ محلَّه */
      await tx.insert(payrollAttendance).values({ employeeId: id, day: "2026-11-26", kind: "LATE", minutes: 20, source: "CHECKIN" });
      expect(await setLeave({ employeeId: id, fromDay: "2026-11-26", toDay: "2026-11-29", note: "إجازة سنوية" }, me, tx)).toEqual({ days: 3, restDays: 1 });

      const rows = await tx.select({ day: payrollAttendance.day, kind: payrollAttendance.kind }).from(payrollAttendance)
        .where(and(eq(payrollAttendance.employeeId, id), isNull(payrollAttendance.voidedAt))).orderBy(payrollAttendance.day);
      expect(rows).toEqual([
        { day: "2026-11-26", kind: "LEAVE" }, { day: "2026-11-28", kind: "LEAVE" }, { day: "2026-11-29", kind: "LEAVE" },
      ]);
      expect(await loadLeave(id, "2026-11-01", tx)).toEqual([{ fromDay: "2026-11-26", toDay: "2026-11-29", days: 3, note: "إجازة سنوية" }]);

      /* مرّتين = مرّة */
      await setLeave({ employeeId: id, fromDay: "2026-11-26", toDay: "2026-11-29", note: "إجازة سنوية" }, me, tx);
      expect((await loadLeave(id, "2026-11-01", tx))[0].days).toBe(3);

      expect(await clearLeave({ employeeId: id, fromDay: "2026-11-26", toDay: "2026-11-29" }, me, tx)).toBe(3);
      expect(await loadLeave(id, "2026-11-01", tx)).toEqual([]);
    }));

  it("أيّامُ راحةٍ كلُّها، أو آخرٌ قبل الأوّل، أو أطولُ من ستّين يوماً — تُرفض", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const id = await barista(tx);
      expect(await caught(setLeave({ employeeId: id, fromDay: "2026-11-27", toDay: "2026-11-27", note: null }, me, tx))).toBeInstanceOf(PayrollRefused);
      expect(await caught(setLeave({ employeeId: id, fromDay: "2026-11-29", toDay: "2026-11-26", note: null }, me, tx))).toBeInstanceOf(PayrollRefused);
      expect(await caught(setLeave({ employeeId: id, fromDay: "2026-11-01", toDay: "2027-01-15", note: null }, me, tx))).toBeInstanceOf(PayrollRefused);
    }));

  it("الإجازةُ بعد تغيير الدوام تتبع راحتَه الجديدة", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const id = await barista(tx);
      await saveShift(id, shift("09:00", "2026-12-01", "6"), me, TODAY, tx);
      /* الخميس ٣ → السبت ٥ ديسمبر: الجمعةُ صارت دواماً، والسبتُ راحة */
      expect(await setLeave({ employeeId: id, fromDay: "2026-12-03", toDay: "2026-12-05", note: null }, me, tx)).toEqual({ days: 2, restDays: 1 });
    }));
});
