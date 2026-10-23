import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { PrintButton } from "@/components/print-button";
import { BrandMark } from "@/components/icons";
import { LinkButton, NoAccess } from "@/components/ui";
import { formatRiyalsDisplay } from "@/lib/money";
import { ADJUSTMENT_LABEL, PURPOSE_LABEL } from "@/lib/payroll/calc";
import { ORDINAL, penaltyLabel } from "@/lib/payroll/saudi-rules";
import { currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadPayrollMonth } from "@/services/payroll.service";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = (minor: number | null) => (minor === null ? "غير معروف" : formatRiyalsDisplay(minor));

/** قسيمةُ الراتب — تُطبع أو تُحفظ PDF وتُرسل للموظّف. الأرقامُ نفسُها التي في المسيّر. */
export default async function SlipPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/payroll");
  if (!can(user.role, "payroll:view")) return <PageShell user={user} title="قسيمة الراتب"><NoAccess what="الرواتب" /></PageShell>;
  const { id } = await params;
  const q = await searchParams;
  const month = q.month && MONTH_RE.test(q.month) ? q.month : currentMonthRiyadh();
  const sheet = await loadPayrollMonth(month);
  const row = sheet.rows.find((r) => r.employee.id === id);
  if (!row) notFound();
  const s = row.slip;
  const lines: [string, string, boolean?][] = [
    [row.employee.kind === "PART_TIME" ? "أجر الأسابيع" : s.days && s.days.worked < s.days.of ? `الراتب (${s.days.worked} من ${s.days.of} يوماً)` : "الراتب الشهري", money(s.baseMinor)],
    ...row.adjustments.filter((a) => a.kind === "BONUS" || a.kind === "OVERTIME" || a.kind === "ALLOWANCE").map((a): [string, string] => [`${ADJUSTMENT_LABEL[a.kind]}${a.note ? ` (${a.note})` : ""}`, `+ ${money(a.amountMinor)}`]),
    ...row.adjustments.filter((a) => a.kind === "DEDUCTION" || a.kind === "FINE" || a.kind === "LOAN_REPAYMENT").map((a): [string, string] => [`${ADJUSTMENT_LABEL[a.kind]}${a.note ? ` (${a.note})` : ""}`, `− ${money(a.amountMinor)}`]),
    ...(s.lateMinutes + s.earlyMinutes > 0 ? [[`أجر دقائق التأخير والانصراف (${s.lateMinutes + s.earlyMinutes} دقيقة)`, `− ${money(s.lateMinor)}`] as [string, string]] : []),
    ...(s.absentDays > 0 ? [[`أجر أيام الغياب (${s.absentDays} يوم)`, `− ${money(s.absenceMinor)}`] as [string, string]] : []),
    ...row.violations.filter((v) => !v.waived).map((v): [string, string] => [
      `${v.detail} ${formatDay(v.day)} — البند ${v.code} من لائحة تنظيم العمل، المرة ${ORDINAL[Math.min(v.occurrence, 4) - 1]}: ${penaltyLabel(v.penalty)}`,
      v.amountMinor === null ? "—" : v.amountMinor === 0 ? "إنذار" : `− ${money(v.amountMinor)}`,
    ]),
    ...(s.penaltiesDroppedMinor > 0 ? [["ما زاد على حد أجر خمسة أيام للجزاءات فلا يُحسم", `+ ${money(s.penaltiesDroppedMinor)}`] as [string, string]] : []),
    ...(s.overHalfMinor > 0 ? [["ما زاد على نصف الراتب فلا يُحسم (م ٩٢)", `+ ${money(s.overHalfMinor)}`] as [string, string]] : []),
    ["المستحق", money(s.earnedMinor), true],
    ...(s.advancesMinor > 0 ? [["سلف نقداً", `− ${money(s.advancesMinor)}`] as [string, string]] : []),
    ...row.links.filter((l) => l.purpose === "SALARY" || l.purpose === "ADVANCE").map((l): [string, string] => [`${PURPOSE_LABEL[l.purpose]} محوّل ${formatDay(l.txDay)}`, `− ${money(l.amountMinor)}`]),
    ...row.adjustments.filter((a) => a.kind === "PAID_OUTSIDE").map((a): [string, string] => [`دُفع له خارج الكشف${a.note ? ` (${a.note})` : ""}`, `− ${money(a.amountMinor)}`]),
    [s.remainingMinor !== null && s.remainingMinor < 0 ? "حُوّل زيادة" : "الباقي", money(s.remainingMinor === null ? null : Math.abs(s.remainingMinor)), true],
  ];
  return (
    <PageShell user={user} title="قسيمة الراتب" actions={<><LinkButton href={`/payroll/employee/${id}?month=${month}`} variant="quiet" size="sm" icon={ArrowRight}>الموظف</LinkButton><PrintButton /></>}>
      <article className="mx-auto max-w-xl rounded-2xl border border-line bg-raised p-6 shadow-raised print:border-0 print:shadow-none">
        <header className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-xs text-muted">مؤسسة ذا بوبليك هاوس</p>
            <h2 className="text-lg font-bold">قسيمة راتب {formatMonth(month)}</h2>
          </div>
          <BrandMark className="h-10 w-auto text-accent" />
        </header>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">الموظف</dt><dd className="font-bold">{row.employee.name}</dd>
          {row.employee.jobTitle && <><dt className="text-muted">المسمى</dt><dd>{row.employee.jobTitle}</dd></>}
          {row.employee.nationalId && <><dt className="text-muted">رقم الهوية</dt><dd className="nums">{row.employee.nationalId}</dd></>}
        </dl>
        <table className="mt-5 w-full text-sm">
          <tbody>
            {lines.map(([label, value, strong], i) => (
              <tr key={i} className={strong ? "border-t border-line font-bold" : ""}>
                <td className="py-1.5">{label}</td>
                <td className="nums py-1.5 text-end" dir="ltr">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-[11px] text-muted">المبالغ بالريال السعودي. صدرت من نظام المقهى.</p>
      </article>
    </PageShell>
  );
}
