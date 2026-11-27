/**
 * بنودُ الشهر: خصمٌ وسلفةٌ ومخالفةٌ ومكافأة، وأيّامُ التأخير والغياب، وأسابيعُ الجزئيّ.
 * المبالغُ نصّاً تُقرأ هللاتٍ هنا، وأجرُ الأسبوع بالساعات يحسبه الخادم من أجر الساعة.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { isAdjustmentKind, parseHours } from "@/lib/payroll/calc";
import { isViolationCode } from "@/lib/payroll/saudi-rules";
import { Amount, Day, Id, Month, Note, positiveMinor } from "@/lib/payroll/request";
import { formatRiyalsDisplay } from "@/lib/money";
import { countNoun, countNounGen, DAY } from "@/lib/arabic";
import { formatMonth } from "@/lib/riyadh-time";
import { deductionMonthOf } from "@/lib/payroll/period";
import { failWith, guard } from "@/services/guard";
import {
  addAdjustment, addViolation, approveOvertime, dismissOvertime, unwaiveMonthLates, waiveMonthLates, clearAttendance, clearLeave, clearWeek, LEAVE_TYPE_LABEL, PayrollRefused, restoreAttendance, setAttendance, setLeave, setPenaltyWaived, setWeek, voidAdjustment, voidViolation,
} from "@/services/payroll.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("adjust"), employeeId: Id, month: Month, kind: z.string().refine(isAdjustmentKind, "نوع غير معروف"), amount: Amount, note: Note }).strict(),
  z.object({ action: z.literal("adjust-void"), id: Id }).strict(),
  z.object({ action: z.literal("day"), employeeId: Id, day: Day, kind: z.enum(["LATE", "EARLY", "ABSENT", "LEAVE"]), minutes: z.number().int().min(1).max(960).nullable().optional(), disrupted: z.boolean().optional(), note: Note }).strict(),
  z.object({ action: z.literal("violation"), employeeId: Id, day: Day, code: z.string().refine(isViolationCode, "بند غير معروف"), note: Note }).strict(),
  z.object({ action: z.literal("violation-void"), id: Id }).strict(),
  z.object({ action: z.literal("waive"), id: Id, waived: z.boolean() }).strict(),
  z.object({ action: z.literal("day-clear"), id: Id }).strict(),
  z.object({ action: z.literal("day-restore"), id: Id }).strict(),
  z.object({ action: z.literal("week"), employeeId: Id, day: Day, hours: z.string().trim().max(8).optional(), amount: z.string().trim().max(20).optional(), note: Note }).strict(),
  z.object({ action: z.literal("week-clear"), id: Id }).strict(),
  /* إجازةٌ من يومٍ إلى يوم — أيّامُ العمل فيها، وأيّامُ الراحة تُترك */
  z.object({ action: z.literal("leave"), employeeId: Id, fromDay: Day, toDay: Day, note: Note, leaveType: z.enum(["ANNUAL", "SICK", "UNPAID"]).optional() }).strict(),
  z.object({ action: z.literal("leave-clear"), employeeId: Id, fromDay: Day, toDay: Day }).strict(),
  /* العملُ الإضافيّ من التسجيل: يومٌ أو أيّام، أو «كلّها» (`days` فارغ) — المبلغُ يحسبه الخادم */
  z.object({ action: z.literal("overtime-approve"), employeeId: Id, month: Month, days: z.array(Day).min(1).max(40).nullable() }).strict(),
  z.object({ action: z.literal("overtime-dismiss"), employeeId: Id, day: Day, dismissed: z.boolean() }).strict(),
  /* إعفاءٌ جماعيّ من تأخيرات فترة الشهر لكلّ الموظّفين، وسحبُه */
  z.object({ action: z.literal("lates-waive"), month: Month }).strict(),
  z.object({ action: z.literal("lates-unwaive"), month: Month }).strict(),
]);

export async function POST(request: Request) {
  try {
    const user = await guard("payroll-entry", "payroll:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    switch (b.action) {
      case "adjust": {
        if (!isAdjustmentKind(b.kind)) return NextResponse.json({ error: "نوع غير معروف" }, { status: 400 });
        const amount = positiveMinor(b.amount);
        if (!amount.ok) return NextResponse.json({ error: amount.error }, { status: 400 });
        await addAdjustment({ employeeId: b.employeeId, month: b.month, kind: b.kind, amountMinor: amount.minor, note: b.note }, user.id);
        return NextResponse.json({ ok: true, message: "أُضيف، وتغيّر المستحق" });
      }
      case "overtime-approve": {
        const n = await approveOvertime({ employeeId: b.employeeId, month: b.month, days: b.days }, user.id);
        return NextResponse.json({ ok: true, message: n === 0 ? "أُقرّ من قبل" : `أُقرّ عمل إضافي ${countNoun(n, DAY)}، وزاد المستحق` });
      }
      case "lates-waive": {
        const r = await waiveMonthLates(b.month, user.id);
        return NextResponse.json({ ok: true, message: r.rows === 0 ? "لا تأخير يُخصم في هذا الشهر" : `أُعفي ${r.employees} موظفين من ${r.rows} تأخيراً — كان سيُخصم ${formatRiyalsDisplay(r.wageMinor + r.penaltyMinor)} قبل حد الجزاءات` });
      }
      case "lates-unwaive": {
        const n = await unwaiveMonthLates(b.month, user.id);
        return NextResponse.json({ ok: true, message: n === 0 ? "لا إعفاء يُسحب" : `سُحب الإعفاء عن ${n} تأخيراً، وعاد خصمها` });
      }
      case "overtime-dismiss": {
        await dismissOvertime({ employeeId: b.employeeId, day: b.day, dismissed: b.dismissed }, user.id);
        return NextResponse.json({ ok: true, message: b.dismissed ? "لن يُقترح هذا اليوم" : "عاد مقترحاً" });
      }
      case "adjust-void": {
        const done = await voidAdjustment(b.id, user.id);
        return NextResponse.json({ ok: true, message: done ? "سُحب البند" : "سُحب من قبل" });
      }
      case "day": {
        await setAttendance({ employeeId: b.employeeId, day: b.day, kind: b.kind, minutes: b.minutes ?? null, note: b.note, disrupted: b.disrupted }, user.id);
        return NextResponse.json({ ok: true, message: `سُجّل اليوم، ويُحسم من راتب ${formatMonth(deductionMonthOf(b.day))}` });
      }
      case "leave": {
        const type = b.leaveType ?? "ANNUAL";
        const r = await setLeave({ employeeId: b.employeeId, fromDay: b.fromDay, toDay: b.toDay, note: b.note, leaveType: type }, user.id);
        const pay = type === "UNPAID" ? `ويُخصم أجر ${countNounGen(r.days, DAY)} من راتبه` : type === "SICK" ? "ولا يُخصم عنها ولا تُطرح من رصيده السنوي" : "ولا يُخصم عنها، وتُطرح من رصيده السنوي";
        return NextResponse.json({ ok: true, message: `سُجّلت ${LEAVE_TYPE_LABEL[type]} ${countNoun(r.days, DAY)}، ${pay}${r.restDays > 0 ? `. وتُركت ${countNoun(r.restDays, DAY)} راحة` : ""}` });
      }
      case "leave-clear": {
        const n = await clearLeave({ employeeId: b.employeeId, fromDay: b.fromDay, toDay: b.toDay }, user.id);
        return NextResponse.json({ ok: true, message: n > 0 ? `أُزيلت الإجازة (${countNoun(n, DAY)})` : "أُزيلت من قبل" });
      }
      case "violation": {
        await addViolation({ employeeId: b.employeeId, day: b.day, code: b.code, note: b.note }, user.id);
        return NextResponse.json({ ok: true, message: `سُجّلت المخالفة، وحُسب جزاؤها من جدول اللائحة ويُحسم من راتب ${formatMonth(deductionMonthOf(b.day))}` });
      }
      case "violation-void": {
        const done = await voidViolation(b.id, user.id);
        return NextResponse.json({ ok: true, message: done ? "سُحبت المخالفة" : "سُحبت من قبل" });
      }
      case "waive": {
        const done = await setPenaltyWaived(b.id, b.waived, user.id);
        return NextResponse.json({ ok: true, message: !done ? "لم تُوجد المخالفة" : b.waived ? "عُفي عن الجزاء، ولا تُعدّ في التكرار" : "أُعيد الجزاء" });
      }
      case "day-clear": {
        const done = await clearAttendance(b.id, user.id);
        return NextResponse.json({ ok: true, message: done ? "أُلغي خصم اليوم، ولا يُحسم شيء عنه" : "أُلغي من قبل" });
      }
      case "day-restore": {
        const done = await restoreAttendance(b.id, user.id);
        return NextResponse.json({ ok: true, message: done ? "عاد خصم اليوم كما كان" : "لم يكن ملغى" });
      }
      case "week": {
        let minutes: number | null = null;
        if (b.hours) {
          minutes = parseHours(b.hours);
          if (minutes === null) return NextResponse.json({ error: "اكتب الساعات رقماً، مثل 24 أو 22.5 أو 22:30" }, { status: 400 });
        }
        let amountMinor: number | null = null;
        if (b.amount) {
          const amount = positiveMinor(b.amount);
          if (!amount.ok) return NextResponse.json({ error: amount.error }, { status: 400 });
          amountMinor = amount.minor;
        }
        if (minutes === null && amountMinor === null) return NextResponse.json({ error: "اكتب الساعات أو المبلغ." }, { status: 400 });
        const pay = await setWeek({ employeeId: b.employeeId, day: b.day, minutes, amountMinor, note: b.note }, user.id);
        return NextResponse.json({ ok: true, message: `سُجّل الأسبوع: ${formatRiyalsDisplay(pay)} ريال` });
      }
      case "week-clear": {
        const done = await clearWeek(b.id, user.id);
        return NextResponse.json({ ok: true, message: done ? "مُسح الأسبوع" : "مُسح من قبل" });
      }
    }
  } catch (e) {
    if (e instanceof PayrollRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    return failWith(e, "payroll-entry");
  }
}
