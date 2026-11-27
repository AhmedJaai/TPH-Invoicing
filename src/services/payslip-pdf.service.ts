/**
 * قسيمةُ الراتب PDF — سطورُها من المسيّر نفسه (`loadPayrollMonth` · `deductionItems`) لا حسابٌ ثانٍ.
 *
 * كلُّ ما غيّر المبلغ سطرٌ بسببه: كلُّ يومِ عملٍ إضافيّ أُقرّ، وكلُّ يومِ تأخيرٍ أو انصرافٍ أو غيابٍ بأجر
 * وقته وجزاء بنده ومرّته، وكلُّ خصمٍ وسلفةٍ وحوالة. ثمّ سجلُّ الحضور يوماً بيوم ليرى الموظّفُ من أين جاء
 * كلُّ رقم. ومجموعُ السطور يُطابَق بالقسيمة هللةً بهللة قبل الرسم — وإن خالفها رُفض الملفّ ولم يُرسَل خطأ.
 */
import { DAY, MINUTE, countNoun } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";
import { ADJUSTMENT_LABEL } from "@/lib/payroll/calc";
import { clock12, dayShiftRange, riyadhClock, shiftOn, WEEKDAY_LABEL } from "@/lib/payroll/attendance";
import { deductionItems } from "@/lib/payroll/deductions";
import { deductionPeriod } from "@/lib/payroll/period";
import { ORDINAL, penaltyLabel } from "@/lib/payroll/saudi-rules";
import { payslipPdf, type SlipLine, type SlipPdfInput, type SlipTone } from "@/lib/payroll/payslip-pdf";
import { addDays, formatDay, formatMonth, todayInRiyadh } from "@/lib/riyadh-time";
import { loadCheckins, loadOvertime, loadPayrollMonth, LEAVE_TYPE_LABEL, PayrollRefused, type PayrollRow } from "./payroll.service";

const money = (minor: number | null) => (minor === null ? "غير معروف" : formatRiyalsDisplay(minor));
const plus = (minor: number) => `+ ${formatRiyalsDisplay(minor)}`;
const minus = (minor: number) => `− ${formatRiyalsDisplay(minor)}`;
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
/** «الثلاثاء 24 نوفمبر» — للجدول بلا سنة. */
const shortDay = (day: string) => `${WEEKDAY_LABEL[new Date(`${day}T00:00:00Z`).getUTCDay()]} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const clockOf = (at: Date) => clock12(riyadhClock(at));

export class SlipMismatch extends Error {}

export async function buildSlipPdfInput(employeeId: string, month: string, today = todayInRiyadh()): Promise<{ input: SlipPdfInput; row: PayrollRow }> {
  const period = deductionPeriod(month);
  const [sheet, checkins, overtime] = await Promise.all([
    loadPayrollMonth(month),
    loadCheckins(period.from, period.to),
    loadOvertime(employeeId, month),
  ]);
  const row = sheet.rows.find((r) => r.employee.id === employeeId);
  if (!row) throw new PayrollRefused(`لم يكن يعمل في ${formatMonth(month)}.`);
  const e = row.employee;
  const s = row.slip;
  const monthly = e.kind === "MONTHLY";

  /* ── المستحقّات ── */
  const earnings: SlipLine[] = [{
    label: !monthly ? `أجر الأسابيع (${row.weeks.length})` : e.leftOn && e.leftOn.slice(0, 7) === month ? "آخر راتب" : s.days && s.days.worked !== s.days.of ? "الراتب بأيام العمل" : "الراتب الشهري",
    detail: monthly && s.days && s.days.worked !== s.days.of
      ? `${s.days.range ? `من ${formatDay(s.days.range.from)} إلى ${formatDay(s.days.range.to)}${s.days.worked > s.days.of ? " بعد راتب الشهر كاملاً" : ""}: ` : ""}${countNoun(s.days.worked, DAY)} من ${s.days.of} من راتب ${money(s.fullSalaryMinor)}${e.leftOn ? ` · ترك العمل ${formatDay(e.leftOn)}` : ""}`
      : undefined,
    value: money(s.baseMinor),
  }];
  for (const w of row.weeks) earnings.push({ label: `أسبوع ${formatDay(w.weekStart)}`, detail: w.note ?? undefined, value: formatRiyalsDisplay(w.amountMinor), tone: "muted" });
  /* العملُ الإضافيّ بترتيب أيّامه، وسعرُ ساعته مرّةً في رأس القسم لا مع كلّ سطر */
  const additions = row.adjustments.filter((a) => a.kind === "BONUS" || a.kind === "OVERTIME" || a.kind === "ALLOWANCE")
    .sort((a, b) => (a.workDay ?? "").localeCompare(b.workDay ?? ""));
  for (const a of additions) {
    const fromCheckin = a.kind === "OVERTIME" && a.workDay !== null && a.minutes !== null;
    earnings.push({
      label: fromCheckin ? `${shortDay(a.workDay!)} · عمل إضافي ${countNoun(a.minutes!, MINUTE)}` : ADJUSTMENT_LABEL[a.kind],
      detail: fromCheckin ? undefined : a.note ?? undefined,
      value: plus(a.amountMinor), tone: "plus",
    });
  }
  const hasOvertime = additions.some((a) => a.kind === "OVERTIME");

  /* ── الخصومات ── (التأخيرُ في حدود السماح في سجلّ الحضور وحده: لا مالَ فيه) */
  const items = deductionItems({ kind: e.kind, rateMinor: row.rateMinor, shiftMinutes: row.shiftMinutes, graceMinutes: e.lateGraceMinutes, attendance: row.attendance, violations: row.violations });
  const deductions: SlipLine[] = [];
  let itemized = 0;
  for (const i of items) {
    if (i.kind === "LEAVE" && i.leaveType !== "UNPAID") continue;
    if (i.withinGrace) continue;
    const what = i.kind === "LATE" ? `تأخر ${countNoun(i.minutes ?? 0, MINUTE)}`
      : i.kind === "EARLY" ? `انصرف قبل الموعد بـ${countNoun(i.minutes ?? 0, MINUTE)}`
      : i.kind === "ABSENT" ? "غياب" : "إجازة بلا أجر";
    const wage = i.wageMinor ?? 0;
    const pen = i.penalty;
    const penMinor = pen && !pen.waived && pen.amountMinor !== null ? pen.amountMinor : 0;
    const wageText = `${i.kind === "ABSENT" || i.kind === "LEAVE" ? "أجر اليوم" : "أجر الوقت"} ${money(i.wageMinor)}`;
    const penText = !pen ? null
      : pen.waived ? `عُفي عن جزاء البند ${pen.code}`
      : pen.warning ? `إنذار كتابي (البند ${pen.code}، المرة ${ORDINAL[Math.min(pen.occurrence, 4) - 1]})`
      : `جزاء ${money(pen.amountMinor)} (البند ${pen.code}، المرة ${ORDINAL[Math.min(pen.occurrence, 4) - 1]}، ${pen.rule})`;
    itemized += wage + penMinor;
    deductions.push({
      label: `${shortDay(i.day)} · ${what}`,
      detail: [penText && !pen?.waived && !pen?.warning ? `${wageText} + ${penText}` : [wageText, penText].filter(Boolean).join(" · "), i.note && i.source === "MANUAL" ? i.note : null].filter(Boolean).join(" · "),
      value: minus(wage + penMinor), tone: "minus",
    });
  }
  for (const v of row.violations.filter((x) => x.source === "MANUAL")) {
    const amount = v.waived || v.amountMinor === null ? 0 : v.amountMinor;
    itemized += amount;
    deductions.push({
      label: `${shortDay(v.day)} · ${v.label}`,
      detail: `البند ${v.code}، المرة ${ORDINAL[Math.min(v.occurrence, 4) - 1]}: ${v.waived ? "عُفي عنه" : penaltyLabel(v.penalty)}${v.detail && v.detail !== v.label ? ` · ${v.detail}` : ""}`,
      value: v.waived || v.penalty.kind === "WARNING" ? "إنذار" : v.amountMinor === null ? "—" : minus(amount),
      tone: amount > 0 ? "minus" : "muted",
    });
  }
  for (const a of row.adjustments.filter((x) => x.kind === "DEDUCTION" || x.kind === "FINE" || x.kind === "LOAN_REPAYMENT")) {
    itemized += a.amountMinor;
    deductions.push({ label: ADJUSTMENT_LABEL[a.kind], detail: a.note ?? undefined, value: minus(a.amountMinor), tone: "minus" });
  }
  /* الحدودُ النظاميّة: ما زاد عليها سُطّر ثمّ رُدّ */
  if (s.penaltiesDroppedMinor > 0) {
    itemized -= s.penaltiesDroppedMinor;
    deductions.push({ label: "ما زاد على حد أجر خمسة أيام للجزاءات في الشهر فلا يُحسم", detail: "لائحة تنظيم العمل", value: plus(s.penaltiesDroppedMinor), tone: "plus" });
  }
  if (s.overHalfMinor > 0) {
    itemized -= s.overHalfMinor;
    deductions.push({ label: "ما زاد على نصف الراتب فلا يُحسم", detail: "نظام العمل، م 92", value: plus(s.overHalfMinor), tone: "plus" });
  }
  /* أجرُ الغياب لا يزيد على أجر أيّام الشهر (`payslip`) */
  if (s.deductionsMinor !== null && itemized > s.deductionsMinor) {
    deductions.push({ label: "ما زاد على أجر أيام الشهر فلا يُحسم", value: plus(itemized - s.deductionsMinor), tone: "plus" });
    itemized = s.deductionsMinor;
  }
  if (s.deductionsMinor !== null && itemized !== s.deductionsMinor) {
    throw new SlipMismatch(`سطور الخصم (${formatRiyalsDisplay(itemized)}) تخالف القسيمة (${formatRiyalsDisplay(s.deductionsMinor)}). لم يُعدّ الملف.`);
  }

  /* ── السلف نقداً — تُنقص الصافي. والحوالاتُ وما بقي له لا تُذكر في القسيمة (أحمد، ٢٧ نوفمبر ٢٠٢٦) ── */
  const advances: SlipLine[] = row.adjustments.filter((x) => x.kind === "ADVANCE")
    .map((a) => ({ label: ADJUSTMENT_LABEL.ADVANCE, detail: a.note ?? undefined, value: minus(a.amountMinor), tone: "minus" as const }));

  /* ── سجلُّ الحضور يوماً بيوم ── */
  const mine = checkins.filter((c) => c.employeeId === employeeId && c.review !== "REJECTED");
  const end = period.to < today ? period.to : today;
  const otByDay = new Map((overtime?.days ?? []).filter((d) => d.approvedId).map((d) => [d.day, d]));
  const attRows: { cells: string[]; muted?: boolean }[] = [];
  const firstTracked = mine.length > 0 ? mine.map((c) => c.day).sort()[0] : null;
  const hasShift = Boolean(e.shiftStart) || e.plans.some((p) => p.shiftStart);
  for (let day = period.from; day <= end; day = addDays(day, 1)) {
    const shift = hasShift ? shiftOn(day, e, e.shiftRules) : null;
    const ins = mine.filter((c) => c.day === day && c.kind === "IN");
    const outs = mine.filter((c) => c.day === day && c.kind === "OUT");
    const recs = row.attendance.filter((a) => a.day === day);
    const notes: string[] = [];
    for (const a of recs) {
      if (a.kind === "LATE") notes.push(`تأخر ${a.minutes ?? 0} د${(a.minutes ?? 0) <= e.lateGraceMinutes ? " (في السماح)" : ""}`);
      else if (a.kind === "EARLY") notes.push(`انصرف مبكراً ${a.minutes ?? 0} د`);
      else if (a.kind === "ABSENT") notes.push("غياب");
      else if (a.kind === "LEAVE") notes.push(LEAVE_TYPE_LABEL[a.leaveType ?? "ANNUAL"]);
    }
    const ot = otByDay.get(day);
    if (ot) notes.push(`إضافي ${ot.minutes} د`);
    const off = shift?.off === true;
    /* قبل أن يبدأ التسجيلَ برابطه لا يُقال «لم يسجّل» — تبقى الخانةُ فارغة */
    const tracked = firstTracked !== null && day >= firstTracked;
    if (off && ins.length === 0 && outs.length === 0 && recs.length === 0) { attRows.push({ cells: [shortDay(day), "راحة", "", "", ""], muted: true }); continue; }
    /* «لا تسجيل» منذ بدأ يسجّل وحده — قبل رابطه لم يكن ما يُسجَّل */
    if (!off && ins.length === 0 && outs.length === 0 && recs.length === 0 && firstTracked !== null && day >= firstTracked) notes.push("لا تسجيل");
    attRows.push({
      cells: [
        shortDay(day),
        shift === null ? "—" : off ? "راحة" : dayShiftRange(shift) ?? "—",
        ins[0] ? clockOf(ins[0].at) : tracked ? "—" : "",
        outs.length > 0 ? clockOf(outs[outs.length - 1].at) : tracked ? "—" : "",
        notes.join(" · "),
      ],
    });
  }


  const input: SlipPdfInput = {
    title: `قسيمة راتب ${formatMonth(month)}`,
    issuer: "مؤسسة ذا بوبليك هاوس",
    employee: [
      ["الموظف", e.name],
      ...(e.nationalId ? [["رقم الهوية", e.nationalId] as [string, string]] : []),
      ["فترة الحضور", `${formatDay(period.from)} – ${formatDay(period.to)}`],
    ],
    summary: [
      [monthly ? "الراتب" : "أجر الأسابيع", money(s.baseMinor)],
      ["الإضافات", s.additionsMinor > 0 ? plus(s.additionsMinor) : "0.00", s.additionsMinor > 0 ? "plus" : undefined],
      ["الخصومات", s.deductionsMinor === null ? "غير معروف" : s.deductionsMinor > 0 ? minus(s.deductionsMinor) : "0.00", (s.deductionsMinor ?? 0) > 0 ? "minus" : undefined],
      ...(s.advancesMinor > 0 ? [["سلف نقداً", minus(s.advancesMinor), "minus"] as [string, string, SlipTone?]] : []),
      ["صافي الراتب", money(s.dueMinor)],
    ],
    sections: [
      { title: "المستحقات", subtitle: hasOvertime && overtime?.hourMinor ? `العمل الإضافي بأجر الساعة ونصفه (نظام العمل، م 107): الساعة ${formatRiyalsDisplay(overtime.hourMinor)}` : undefined,
        total: s.baseMinor === null ? undefined : formatRiyalsDisplay(s.baseMinor + s.additionsMinor), lines: earnings },
      { title: "الخصومات", total: s.deductionsMinor ? minus(s.deductionsMinor) : undefined, lines: deductions },
      { title: "السلف", total: s.advancesMinor ? minus(s.advancesMinor) : undefined, lines: advances },
    ],
    net: ["صافي الراتب", money(s.dueMinor)],
    attendance: attRows.length > 0 ? { columns: ["اليوم", "الدوام", "حضر", "انصرف", "ملاحظة"], widths: [24, 24, 13, 13, 26], rows: attRows } : null,
    /* بلا شرحٍ في ذيلها (أحمد، ٢٧ نوفمبر ٢٠٢٦) — القسيمةُ أرقامُها وسجلُّ حضورها */
    notes: [],
    issuedAt: formatDay(today),
  };
  return { input, row };
}

export async function slipPdf(employeeId: string, month: string): Promise<{ pdf: Buffer; fileName: string }> {
  const { input, row } = await buildSlipPdfInput(employeeId, month);
  const pdf = await payslipPdf(input);
  return { pdf, fileName: `قسيمة راتب ${row.employee.name} ${formatMonth(month)}.pdf` };
}
