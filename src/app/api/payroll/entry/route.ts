/**
 * بنودُ الشهر: خصمٌ وسلفةٌ ومخالفةٌ ومكافأة، وأيّامُ التأخير والغياب، وأسابيعُ الجزئيّ.
 * المبالغُ نصّاً تُقرأ هللاتٍ هنا، وأجرُ الأسبوع بالساعات يحسبه الخادم من أجر الساعة.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { isAdjustmentKind, parseHours } from "@/lib/payroll/calc";
import { Amount, Day, Id, Month, Note, positiveMinor } from "@/lib/payroll/request";
import { formatRiyalsDisplay } from "@/lib/money";
import { failWith, guard } from "@/services/guard";
import {
  addAdjustment, clearAttendance, clearWeek, PayrollRefused, setAttendance, setWeek, voidAdjustment,
} from "@/services/payroll.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("adjust"), employeeId: Id, month: Month, kind: z.string().refine(isAdjustmentKind, "نوع غير معروف"), amount: Amount, note: Note }).strict(),
  z.object({ action: z.literal("adjust-void"), id: Id }).strict(),
  z.object({ action: z.literal("day"), employeeId: Id, day: Day, kind: z.enum(["LATE", "EARLY", "ABSENT", "LEAVE"]), minutes: z.number().int().min(1).max(960).nullable().optional(), note: Note }).strict(),
  z.object({ action: z.literal("day-clear"), id: Id }).strict(),
  z.object({ action: z.literal("week"), employeeId: Id, day: Day, hours: z.string().trim().max(8).optional(), amount: z.string().trim().max(20).optional(), note: Note }).strict(),
  z.object({ action: z.literal("week-clear"), id: Id }).strict(),
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
      case "adjust-void": {
        const done = await voidAdjustment(b.id, user.id);
        return NextResponse.json({ ok: true, message: done ? "سُحب البند" : "سُحب من قبل" });
      }
      case "day": {
        await setAttendance({ employeeId: b.employeeId, day: b.day, kind: b.kind, minutes: b.minutes ?? null, note: b.note }, user.id);
        return NextResponse.json({ ok: true, message: "سُجّل اليوم، ويتراكم على الشهر" });
      }
      case "day-clear": {
        const done = await clearAttendance(b.id, user.id);
        return NextResponse.json({ ok: true, message: done ? "مُسح اليوم" : "مُسح من قبل" });
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
