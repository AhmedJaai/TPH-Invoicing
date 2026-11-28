import Link from "next/link";
import { CalendarClock, Link2, Printer, Timer, Undo2, Wallet, type LucideIcon } from "lucide-react";
import { Money } from "@/components/money";
import { MaybeMoney } from "@/components/finance-bits";
import { Badge, LinkButton, Meter, TONE_TEXT } from "@/components/ui";
import { countNoun, countNounGen, DAY, TRANSFER } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";
import { daysToPayday, payStatus, type PayStatus } from "@/lib/payroll/pay-status";
import { PAYDAY } from "@/lib/payroll/period";
import type { Payslip } from "@/lib/payroll/calc";
import type { PayrollRow } from "@/services/payroll.service";
import { formatMonth } from "@/lib/riyadh-time";
import { deductionParts, STATUS_UI } from "./pay-people";

/**
 * جوابُ صفحة الموظّف في شهرٍ — قبل البنود والنماذج:
 *   حالُه (من `payStatus` نفسها التي يجمع بها المسيّر، لا قاعدةٌ ثانية) · الباقي له بارزاً ·
 *   المستحقُّ وما وصله وشريطُه · ما نقص راتبَه بكلمات · والخطوةُ التالية زرّاً بجانبها.
 * والمجهولُ «غير معروف»، لا صفر.
 */

/** المسيّرُ يعدّ جماعة («لم يصلهم شيء»)، وهنا رجلٌ واحد — النصُّ وحده يختلف، والحالُ واحدة. */
const ONE: Record<PayStatus, (month: string) => string> = {
  NONE: (m) => `لم يصله شيء من راتب ${m}`,
  PARTIAL: (m) => `وصله جزء من راتب ${m}`,
  UNKNOWN: (m) => `مستحقه عن ${m} غير معروف`,
  OVER: () => "حُوّل له أكثر من مستحقه",
  DONE: (m) => `وصله راتب ${m} كاملاً`,
};

interface Step { href: string; label: string; icon: LucideIcon }

export function EmployeeMonthAnswer({ row, employeeId, month, today, kind, canEdit, pendingTransfers, pendingMinor, overtimePending }: {
  row: PayrollRow;
  employeeId: string;
  month: string;
  today: string;
  kind: "MONTHLY" | "PART_TIME";
  canEdit: boolean;
  /** حوالاتٌ في الكشف مقترَحةٌ له لم تُوزَّع. */
  pendingTransfers: number;
  pendingMinor: number;
  /** أيّامُ عملٍ إضافيّ مقترَحة لم تُقرّ. */
  overtimePending: number;
}) {
  const slip = row.slip;
  const status = payStatus(slip);
  const ui = STATUS_UI[status];
  const label = formatMonth(month);
  const toPayday = status === "NONE" || status === "PARTIAL" ? daysToPayday(month, today, PAYDAY) : null;
  const parts = deductionParts(row);

  /* الخطوةُ التالية — الأولى زرٌّ أساسيّ، والباقي بجانبه */
  const steps: Step[] = [];
  if (canEdit) {
    if (status === "UNKNOWN" && kind === "MONTHLY") steps.push({ href: "#salary", label: "اكتب راتبه", icon: Wallet });
    if (pendingTransfers > 0 && status !== "DONE" && status !== "OVER") steps.push({ href: "#transfers", label: `وزّع ${countNoun(pendingTransfers, TRANSFER)} له`, icon: Link2 });
    if (overtimePending > 0) steps.push({ href: "#overtime", label: `أقرّ العمل الإضافي (${countNoun(overtimePending, DAY)})`, icon: Timer });
    if (status === "OVER") steps.push({ href: "#adjust", label: "سجّل الزيادة سلفة", icon: Undo2 });
  }

  return (
    <section aria-labelledby="month-answer" className="mt-4 overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className={`flex items-center gap-1.5 text-sm font-bold ${TONE_TEXT[ui.tone]}`}>
            <ui.icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            <span id="month-answer">{ONE[status](label)}</span>
          </p>
          {/* الرقمُ الكبير ما يُسأل عنه في حاله: الباقي، أو الزيادة، أو ما وصله إن اكتمل — لا «٠٫٠٠» بارزاً */}
          <p className="mt-2 text-xs font-bold text-muted">{status === "DONE" ? "وصله" : status === "OVER" ? "الزيادة" : "الباقي له"}</p>
          <p className="nums mt-0.5 text-4xl font-bold tracking-tight">
            {slip.remainingMinor === null ? <span className="text-2xl text-muted">غير معروف</span>
              : <Money minor={status === "DONE" ? slip.paidMinor : Math.abs(slip.remainingMinor)} currency />}
          </p>
          {toPayday !== null && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {toPayday === 0 ? `اليوم يوم الصرف (${PAYDAY})` : `يوم الصرف ${PAYDAY} — بعد ${countNounGen(toPayday, DAY)}`}
            </p>
          )}
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">{explain(slip, parts, kind)}</p>
        </div>

        <div className="min-w-0 space-y-3 md:border-s md:border-line md:ps-5">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Figure label="المستحق"><MaybeMoney minor={slip.dueMinor} why="لم يُكتب راتبه لهذا الشهر" /></Figure>
            <Figure label="وصله"><Money minor={slip.paidMinor} /></Figure>
            <Figure label={slip.remainingMinor !== null && slip.remainingMinor < 0 ? "زيادة" : "باقٍ"}>
              {slip.remainingMinor === null ? <MaybeMoney minor={null} /> : <Money minor={Math.abs(slip.remainingMinor)} tone={slip.remainingMinor < 0 ? "danger" : slip.remainingMinor > 0 ? "warn" : "ok"} />}
            </Figure>
          </dl>
          {slip.dueMinor !== null && slip.dueMinor > 0 && (
            <Meter value={slip.paidMinor} max={slip.dueMinor} tone={status === "DONE" ? "ok" : status === "OVER" ? "danger" : "warn"} label={`وصله ${formatRiyalsDisplay(slip.paidMinor)} من ${formatRiyalsDisplay(slip.dueMinor)}`} />
          )}
          {pendingMinor > 0 && status !== "DONE" && (
            <p className="text-xs text-ink-soft">
              وفي الكشف <Badge tone="info">{formatRiyalsDisplay(pendingMinor)} ريال</Badge> مقترحة له لم تُوزَّع.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {steps.map((s, i) => (
              <LinkButton key={s.href} href={s.href} variant={i === 0 ? "primary" : "secondary"} size="sm" icon={s.icon}>{s.label}</LinkButton>
            ))}
            <LinkButton href={`/payroll/slip/${employeeId}?month=${month}`} variant={steps.length === 0 ? "primary" : "quiet"} size="sm" icon={Printer}>قسيمة {label}</LinkButton>
          </div>
          {steps.length === 0 && (status === "NONE" || status === "PARTIAL") && (
            <p className="text-[11px] leading-relaxed text-muted">حين تحوّل له من البنك يظهر التحويل هنا لتوزّعه على راتبه.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** «من راتب ٥٬٥٠٠ نقص ١٬٠٠٠: تأخير ٤٥ دقيقة، غياب يوم.» — الحسابُ كلُّه بكلمات. */
function explain(slip: Payslip, parts: string[], kind: "MONTHLY" | "PART_TIME"): string {
  const base = kind === "PART_TIME" ? "أجر أسابيعه" : "راتبه";
  if (slip.baseMinor === null) return `لم يُكتب ${base} لهذا الشهر، فلا يُعرف كم يستحق.`;
  const bits = [`${base} ${formatRiyalsDisplay(slip.baseMinor)}`];
  if (slip.additionsMinor > 0) bits.push(`زاد ${formatRiyalsDisplay(slip.additionsMinor)} إضافات`);
  if (slip.deductionsMinor === null) bits.push("وخصوماته غير معروفة");
  else if (slip.deductionsMinor > 0) bits.push(`نقص ${formatRiyalsDisplay(slip.deductionsMinor)}${parts.length > 0 ? ` (${parts.join("، ")})` : ""}`);
  else bits.push("بلا تأخير ولا خصم");
  if (slip.advancesMinor > 0) bits.push(`وأخذ سلفاً نقداً ${formatRiyalsDisplay(slip.advancesMinor)}`);
  return `${bits.join("، ")}.`;
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-sunken/60 px-2 py-2.5">
      <dt className="text-[11px] font-bold text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-bold">{children}</dd>
    </div>
  );
}

/** سطرُ شهرٍ في السجلّ — بالحال نفسها، وبابُه الشهرُ وقسيمتُه. */
export function MonthHistoryRow({ employeeId, month, slip, active }: { employeeId: string; month: string; slip: Payslip; active: boolean }) {
  const status = payStatus(slip);
  const ui = STATUS_UI[status];
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm ${active ? "bg-sunken/50" : ""}`}>
      <Link href={`/payroll/employee/${employeeId}?month=${month}`} className="flex min-h-11 min-w-0 flex-1 basis-56 items-center gap-2 font-bold hover:underline" aria-current={active ? "page" : undefined}>
        <ui.icon className={`h-4 w-4 shrink-0 ${TONE_TEXT[ui.tone]}`} strokeWidth={2} aria-hidden />
        {formatMonth(month)}
      </Link>
      <span className="text-xs text-muted">المستحق <MaybeMoney minor={slip.dueMinor} /></span>
      <span className="text-xs text-muted">وصله <Money minor={slip.paidMinor} /></span>
      {slip.remainingMinor === null ? <Badge tone="muted">غير معروف</Badge>
        : slip.remainingMinor > 0 ? <Badge tone="warn">باقٍ {formatRiyalsDisplay(slip.remainingMinor)}</Badge>
        : slip.remainingMinor < 0 ? <Badge tone="danger">زيادة {formatRiyalsDisplay(-slip.remainingMinor)}</Badge>
        : <Badge tone="ok">اكتمل</Badge>}
      <Link href={`/payroll/slip/${employeeId}?month=${month}`} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent hover:underline">
        <Printer className="h-3.5 w-3.5" aria-hidden />القسيمة
      </Link>
    </li>
  );
}
