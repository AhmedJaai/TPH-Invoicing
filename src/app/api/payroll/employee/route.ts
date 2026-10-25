/**
 * الموظّف: إضافتُه وتعديلُه، وراتبُه من شهرٍ يبدأ منه، ورابطُ حضوره.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { Amount, Day, Id, Month, positiveMinor } from "@/lib/payroll/request";
import { failWith, guard } from "@/services/guard";
import {
  deleteEmployee, issueCheckinLink, PayrollRefused, removeRate, revokeCheckinLink, saveEmployee, setRate,
} from "@/services/payroll.service";

export const runtime = "nodejs";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const Fields = z.object({
  name: z.string().trim().min(2, "اكتب الاسم").max(120),
  kind: z.enum(["MONTHLY", "PART_TIME"]),
  jobTitle: optionalText(60),
  phone: optionalText(20).refine((v) => v === null || /^\+?[0-9 ]{7,20}$/.test(v), "رقم الجوال أرقام فقط"),
  nationalId: optionalText(20).refine((v) => v === null || /^[0-9]{6,20}$/.test(v), "رقم الهوية أو الإقامة أرقام فقط"),
  bankBeneficiaryId: optionalText(20).refine((v) => v === null || /^[0-9]{4,20}$/.test(v), "رقم المستفيد أرقام فقط"),
  iban: optionalText(34).transform((v) => (v ? v.replace(/\s+/g, "").toUpperCase() : null)).refine((v) => v === null || /^SA[0-9]{22}$/.test(v), "الآيبان يبدأ بـ SA ثم 22 رقماً"),
  hiredOn: Day,
  leftOn: Day.nullable().optional().transform((v) => v ?? null),
  shiftStart: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "اكتب الوقت مثل 16:00").nullable().optional().transform((v) => v ?? null),
  shiftHours: z.string().trim().max(5).optional(),
  lateGraceMinutes: z.number().int().min(0).max(120).default(0),
  daysOff: z.string().regex(/^[0-6]{0,7}$/).default(""),
  note: optionalText(300),
});

const Body = z.discriminatedUnion("action", [
  Fields.extend({ action: z.literal("create"), salary: z.string().trim().max(20).optional() }).strict(),
  Fields.extend({ action: z.literal("update"), id: Id }).strict(),
  z.object({ action: z.literal("rate"), id: Id, fromMonth: Month, amount: Amount }).strict(),
  z.object({ action: z.literal("rate-remove"), rateId: Id }).strict(),
  z.object({ action: z.literal("link-issue"), id: Id }).strict(),
  z.object({ action: z.literal("link-revoke"), id: Id }).strict(),
  z.object({ action: z.literal("delete"), id: Id }).strict(),
]);

function shiftMinutes(text: string | undefined): number | null {
  if (!text) return 480;
  const m = /^(\d{1,2})(?::([0-5]\d))?$/.exec(text.trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2] ?? 0);
  return minutes >= 60 && minutes <= 960 ? minutes : null;
}

export async function POST(request: Request) {
  try {
    const user = await guard("payroll-employee", "payroll:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;

    if (b.action === "rate") {
      const amount = positiveMinor(b.amount);
      if (!amount.ok) return NextResponse.json({ error: amount.error }, { status: 400 });
      await setRate(b.id, b.fromMonth, amount.minor, user.id);
      return NextResponse.json({ ok: true, message: "حُفظ الراتب، ويسري من الشهر الذي اخترته" });
    }
    if (b.action === "rate-remove") {
      const done = await removeRate(b.rateId, user.id);
      return NextResponse.json({ ok: true, message: done ? "حُذف هذا التغيير، وعاد الراتب السابق" : "حُذف من قبل" });
    }
    if (b.action === "link-issue") {
      const token = await issueCheckinLink(b.id, user.id);
      return NextResponse.json({ ok: true, token, message: "أُنشئ رابط الحضور. أرسله للموظف، والرابط القديم لم يعد يعمل" });
    }
    if (b.action === "delete") {
      const done = await deleteEmployee(b.id, user.id);
      return NextResponse.json({ ok: true, message: done ? "حُذف الموظف" : "حُذف من قبل" });
    }
    if (b.action === "link-revoke") {
      const done = await revokeCheckinLink(b.id, user.id);
      return NextResponse.json({ ok: true, message: done ? "أُلغي رابط الحضور" : "لا رابط له" });
    }

    const minutes = shiftMinutes(b.shiftHours);
    if (minutes === null) return NextResponse.json({ error: "طول الدوام بالساعات بين 1 و16، مثل 8 أو 7:30" }, { status: 400 });
    const input = {
      name: b.name, kind: b.kind, jobTitle: b.jobTitle, phone: b.phone, nationalId: b.nationalId,
      bankBeneficiaryId: b.bankBeneficiaryId, iban: b.iban, hiredOn: b.hiredOn, leftOn: b.leftOn,
      shiftStart: b.shiftStart, shiftMinutes: minutes, lateGraceMinutes: b.lateGraceMinutes,
      daysOff: [...new Set(b.daysOff.split(""))].sort().join(""), note: b.note,
    };
    if (b.action === "create") {
      let rate: number | null = null;
      if (b.salary) {
        const amount = positiveMinor(b.salary);
        if (!amount.ok) return NextResponse.json({ error: amount.error }, { status: 400 });
        rate = amount.minor;
      }
      const id = await saveEmployee(null, input, rate, user.id);
      return NextResponse.json({ ok: true, id, message: `أُضيف ${b.name}` });
    }
    await saveEmployee(b.id, input, null, user.id);
    return NextResponse.json({ ok: true, id: b.id, message: "حُفظت بيانات الموظف" });
  } catch (e) {
    if (e instanceof PayrollRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    return failWith(e, "payroll-employee");
  }
}
