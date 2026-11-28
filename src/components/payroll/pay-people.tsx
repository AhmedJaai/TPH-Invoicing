import Link from "next/link";
import { CircleAlert, CircleCheck, CircleDashed, CircleDot, Undo2, type LucideIcon } from "lucide-react";
import { Money } from "@/components/money";
import { Badge, Meter, Monogram, type Tone } from "@/components/ui";
import { countNoun, DAY, DISCIPLINARY, MINUTE } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";
import { ADJUSTMENT_LABEL } from "@/lib/payroll/calc";
import { PAY_STATUS_ORDER, payStatus, type PayStatus } from "@/lib/payroll/pay-status";
import type { PayrollRow } from "@/services/payroll.service";
import { formatDay } from "@/lib/riyadh-time";
import { SlipPdfButton } from "./slip-pdf-button";

/**
 * «من قبض ومن لم يقبض وكم بقي» — الموظّفون مجموعين بحالهم لا صفوفاً متساوية.
 *
 * كان المسيّرُ جدولاً بثمانية أعمدة، وأوّلُ رقمٍ في بطاقة الجوّال الراتبُ لا الباقي،
 * وتفصيلُ الخصم في `title` لا يُرى باللمس. فصار لكلّ موظّفٍ سطرٌ: الباقي بارزاً،
 * ومعادلةُ مستحقّه مكتوبة (الراتب − الخصومات … = المستحقّ)، وشريطُ ما وصله منه،
 * والسطرُ كلُّه بابُ قسيمته.
 */

export const STATUS_UI: Record<PayStatus, { title: string; hint: string; icon: LucideIcon; tone: Tone }> = {
  NONE: { title: "لم يصلهم شيء", hint: "لم يُوزَّع لهم من أي حوالة عن هذا الشهر.", icon: CircleDashed, tone: "warn" },
  PARTIAL: { title: "وصلهم جزء", hint: "وُزّع لهم بعض المستحق، والباقي بجانب كل اسم.", icon: CircleDot, tone: "warn" },
  UNKNOWN: { title: "مستحقهم غير معروف", hint: "لم يُكتب راتبهم لهذا الشهر، فلا يُعرف كم يستحقون. افتح الموظف واكتب راتبه.", icon: CircleAlert, tone: "danger" },
  OVER: { title: "حُوّل لهم أكثر من المستحق", hint: "الزيادة لا تُنسى: تظهر في رصيده منذ المباشرة، وتُخصم أو تُعدّ سلفة بقرارك.", icon: Undo2, tone: "danger" },
  DONE: { title: "اكتمل", hint: "وصل كل واحد منهم مستحقه عن الشهر.", icon: CircleCheck, tone: "ok" },
};

/** ما ينقص الراتب بكلماتٍ ومبالغ — يُقرأ في السطر لا في تلميح. */
export function deductionParts(r: PayrollRow): string[] {
  const s = r.slip;
  const parts: string[] = [];
  for (const a of r.adjustments) {
    if (a.kind === "DEDUCTION" || a.kind === "FINE" || a.kind === "LOAN_REPAYMENT") parts.push(`${ADJUSTMENT_LABEL[a.kind]} ${formatRiyalsDisplay(a.amountMinor)}`);
  }
  if (s.lateMinutes + s.earlyMinutes > 0) parts.push(`تأخير ${countNoun(s.lateMinutes + s.earlyMinutes, MINUTE)}`);
  if (s.absentDays > 0) parts.push(`غياب ${countNoun(s.absentDays, DAY)}`);
  if (s.unpaidLeaveDays > 0) parts.push(`إجازة بلا أجر ${countNoun(s.unpaidLeaveDays, DAY)}`);
  if (s.penaltiesMinor > 0) parts.push(`جزاءات اللائحة ${formatRiyalsDisplay(s.penaltiesMinor)}`);
  if (s.warnings > 0) parts.push(countNoun(s.warnings, DISCIPLINARY));
  return parts;
}

export function groupByStatus(rows: readonly PayrollRow[]): { status: PayStatus; rows: PayrollRow[] }[] {
  const by = new Map<PayStatus, PayrollRow[]>();
  for (const r of rows) {
    const st = payStatus(r.slip);
    by.set(st, [...(by.get(st) ?? []), r]);
  }
  return PAY_STATUS_ORDER.filter((s) => by.has(s)).map((status) => ({
    status,
    /* الأكبرُ باقياً أوّلاً — من تُحوّل له أوّلاً؛ والمجهولُ بالاسم */
    rows: (by.get(status) ?? []).sort((a, b) => (b.slip.remainingMinor ?? 0) - (a.slip.remainingMinor ?? 0) || a.employee.name.localeCompare(b.employee.name, "ar")),
  }));
}

export function PayPeople({ rows, month, monthLabel }: { rows: readonly PayrollRow[]; month: string; monthLabel: string }) {
  const groups = groupByStatus(rows);
  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const ui = STATUS_UI[g.status];
        return (
          <section key={g.status} id={`pay-${g.status.toLowerCase()}`} aria-labelledby={`pay-${g.status}-h`} className="scroll-mt-28">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h3 id={`pay-${g.status}-h`} className="flex items-center gap-1.5 text-sm font-bold">
                <ui.icon className={`h-4 w-4 ${g.status === "DONE" ? "text-ok" : g.status === "UNKNOWN" || g.status === "OVER" ? "text-danger" : "text-warn"}`} strokeWidth={2} aria-hidden />
                {ui.title}
                <span className="nums nums-count rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-soft">{g.rows.length}</span>
              </h3>
              <p className="text-[11px] text-muted">{ui.hint}</p>
            </div>
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
              {g.rows.map((r) => <PersonRow key={r.employee.id} r={r} status={g.status} month={month} monthLabel={monthLabel} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PersonRow({ r, status, month, monthLabel }: { r: PayrollRow; status: PayStatus; month: string; monthLabel: string }) {
  const s = r.slip;
  const ded = deductionParts(r);
  const due = s.dueMinor;
  const explained = s.additionsMinor > 0 || (s.deductionsMinor ?? 0) > 0 || s.advancesMinor > 0;
  return (
    /* السطرُ رابطُ قسيمته، والقسيمةُ PDF فعلٌ بجانبه لا داخله — لا زرَّ داخل رابط */
    <li className="relative grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-3.5 transition-colors hover:bg-hover sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center sm:px-5">
      <span className="flex min-w-0 items-start gap-3">
        <Monogram name={r.employee.name} className="mt-0.5 h-9 w-9 text-sm" />
        <span className="min-w-0 flex-1">
          <Link href={`/payroll/employee/${r.employee.id}?month=${month}`} data-nav-item
            className="block text-[14px] font-bold leading-snug after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:underline">
            {r.employee.name}
          </Link>
          <span className="block text-[11px] text-muted">
            {r.employee.kind === "PART_TIME" ? "جزئي" : r.employee.jobTitle ?? "دوام كامل"}
            {s.days && s.days.worked !== s.days.of && <> · {s.days.range ? "آخر راتب " : ""}<span className="nums nums-count">{s.days.worked}</span> من <span className="nums nums-count">{s.days.of}</span> يوماً</>}
          </span>
          {/* معادلةُ المستحقّ مكتوبة — كلُّ ما نقص بسببه، لا رقمٌ أحمر بلا تفسير */}
          <span className="mt-1.5 block text-[11px] leading-relaxed text-ink-soft">
            {s.baseMinor === null
              ? <span className="font-bold text-danger">لم يُكتب راتبه لهذا الشهر</span>
              : <>
                  <span className="whitespace-nowrap">الراتب <Money minor={s.baseMinor} /></span>
                  {s.additionsMinor > 0 && <> <span className="whitespace-nowrap">+ إضافات <Money minor={s.additionsMinor} /></span></>}
                  {s.deductionsMinor !== null && s.deductionsMinor > 0 && <> <span className="whitespace-nowrap">− خصومات <Money minor={s.deductionsMinor} /></span></>}
                  {s.advancesMinor > 0 && <> <span className="whitespace-nowrap">− سلف نقداً <Money minor={s.advancesMinor} /></span></>}
                  {due !== null && explained && <> <strong className="whitespace-nowrap text-ink">= المستحق <Money minor={due} /></strong></>}
                </>}
          </span>
          {ded.length > 0 && <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{ded.join(" · ")}</span>}
          {(r.article80.length > 0 || r.loanMinor > 0 || r.employee.leftOn) && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {/* يظهر في شهر خروجه بآخر راتبه، ويغيب بعده */}
              {r.employee.leftOn && <Badge tone="muted">ترك العمل {formatDay(r.employee.leftOn)}</Badge>}
              {r.article80.length > 0 && <Badge tone="danger">غياب يجيز الفصل</Badge>}
              {r.loanMinor > 0 && <Badge tone="muted">رصيد سلف {formatRiyalsDisplay(r.loanMinor)}</Badge>}
            </span>
          )}
        </span>
      </span>

      {/* الجواب: الباقي، ثمّ ما وصله من مستحقّه — على الجوّال تحت الاسم بعرض السطر */}
      <span className="min-w-0 ps-12 sm:ps-0 sm:text-end">
        <span className="flex items-baseline justify-between gap-2 sm:block">
          {status === "UNKNOWN" ? (
            <span className="block text-sm font-bold text-danger">غير معروف</span>
          ) : status === "DONE" ? (
            <span className="block text-sm font-bold text-ok">اكتمل</span>
          ) : status === "OVER" ? (
            <span className="block text-sm font-bold text-danger">زيادة <Money minor={-(s.remainingMinor ?? 0)} /></span>
          ) : (
            <span className="block text-[17px] font-bold leading-tight">باقٍ <Money minor={s.remainingMinor ?? 0} tone="warn" /></span>
          )}
          <span className="block text-[11px] text-muted sm:mt-0.5">
            {s.paidMinor > 0 ? <>وصله <Money minor={s.paidMinor} /></> : "لم يُحوَّل له"}
            {due !== null && <> من <Money minor={due} /></>}
          </span>
        </span>
        {due !== null && due > 0 && (
          <span className="mt-1.5 block">
            <Meter value={Math.min(s.paidMinor, due)} max={due} tone={status === "DONE" ? "ok" : status === "OVER" ? "danger" : "accent"} label={`ما وصل ${r.employee.name} من مستحقه`} />
          </span>
        )}
      </span>
      {/* آخرَ الشهر: قسيمةُ كلٍّ منهم PDF تُرسل من هنا — فوق رابط السطر */}
      <span className="relative z-10 ps-12 sm:ps-0">
        <SlipPdfButton compact employeeId={r.employee.id} month={month} name={r.employee.name} monthLabel={monthLabel} phone={r.employee.phone} />
      </span>
    </li>
  );
}

/** عددُ الموظّفين في كلّ حال — لسطر الجواب. */
export function statusCounts(rows: readonly PayrollRow[]): Record<PayStatus, number> {
  const out: Record<PayStatus, number> = { NONE: 0, PARTIAL: 0, UNKNOWN: 0, OVER: 0, DONE: 0 };
  for (const r of rows) out[payStatus(r.slip)]++;
  return out;
}

