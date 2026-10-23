import { redirect } from "next/navigation";
import { Landmark, UserPlus, Users } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney } from "@/components/finance-bits";
import { EmployeeForm } from "@/components/payroll/forms";
import { BLANK_EMPLOYEE } from "@/lib/payroll/form-defaults";
import { Badge, DataTable, EmptyState, NoAccess, Section, type Column } from "@/components/ui";
import { formatRiyals } from "@/lib/money";
import { countNoun, TRANSFER } from "@/lib/arabic";
import { activeIn, rateFor } from "@/lib/payroll/calc";
import { currentMonthRiyadh, formatDay, todayInRiyadh } from "@/lib/riyadh-time";
import { loadBankPayees, loadEmployees, type EmployeeView } from "@/services/payroll.service";

export const dynamic = "force-dynamic";

/** مَن يعمل ومَن خرج، وراتبُ كلٍّ اليوم — ومَن في الكشف ولم يُسجَّل. */
export default async function EmployeesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/payroll/employees");
  if (!can(user.role, "payroll:view")) {
    return <PageShell user={user} title="الموظفون"><NoAccess what="الموظفين" /></PageShell>;
  }
  const canEdit = can(user.role, "payroll:edit");
  const month = currentMonthRiyadh();
  const [list, payees] = await Promise.all([loadEmployees(), loadBankPayees()]);
  const working = list.filter((e) => activeIn(e, month) || e.hiredOn.slice(0, 7) > month);
  const left = list.filter((e) => !working.includes(e));

  const columns: Column<EmployeeView>[] = [
    {
      key: "name", header: "الموظف", primary: true,
      cell: (e) => <span><span className="font-bold">{e.name}</span><span className="block text-[11px] text-muted">{e.jobTitle ?? (e.kind === "PART_TIME" ? "جزئي" : "دوام كامل")}</span></span>,
      sortBy: (e) => e.name,
    },
    { key: "kind", header: "النوع", cell: (e) => (e.kind === "PART_TIME" ? <Badge tone="muted">جزئي، أسبوعي</Badge> : <Badge tone="accent">شهري</Badge>) },
    {
      key: "rate", header: "الراتب الآن", numeric: true,
      cell: (e) => {
        const r = rateFor(e.rates, month);
        return r === null ? <MaybeMoney minor={null} why="لم يُكتب" /> : <span><Money minor={r} />{e.kind === "PART_TIME" && <span className="text-[11px] text-muted"> / ساعة</span>}</span>;
      },
    },
    { key: "hired", header: "المباشرة", secondary: true, cell: (e) => formatDay(e.hiredOn) },
    { key: "shift", header: "الدوام", secondary: true, cell: (e) => (e.shiftStart ? <span className="nums" dir="ltr">{e.shiftStart}</span> : <span className="text-muted">—</span>) },
    { key: "link", header: "رابط الحضور", cell: (e) => (e.hasCheckinLink ? <Badge tone="ok">مفعّل</Badge> : <Badge tone="muted">لا رابط</Badge>) },
  ];

  return (
    <PageShell user={user} title="الموظفون" intro="من يعمل في المقهى، وراتب كل منهم من أي شهر، وبيانات تحويله وحضوره.">
      <Section title="يعملون الآن" icon={Users} count={working.length}>
        {working.length === 0 ? (
          <EmptyState icon={Users} title="لا موظفين بعد." hint="أضفهم من الأسفل، أو بضغطة ممن وجدناهم في كشف البنك." />
        ) : (
          <DataTable columns={columns} rows={working} keyOf={(e) => e.id} hrefOf={(e) => `/payroll/employee/${e.id}`} />
        )}
      </Section>

      {canEdit && payees.length > 0 && (
        <Section title="في كشف البنك ولم يُسجَّلوا موظفين" icon={Landmark} count={payees.length} hint="أشخاص حُوّلت لهم «رواتب» أو تحويلات. أضف من كان موظفاً، والباقي اتركه. يُملأ الاسم ورقم المستفيد وأول تحويل، وراجع الراتب قبل الحفظ.">
          <ul className="space-y-2">
            {payees.map((p) => (
              <li key={p.beneficiaryId} className="rounded-xl border border-line bg-raised shadow-raised">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <span className="min-w-0 flex-1 basis-56">
                      <span className="text-sm font-bold">{p.name}</span>
                      <span className="block text-[11px] text-muted">{countNoun(p.transfers, TRANSFER)} {p.transfers > 1 ? <>من {formatDay(p.firstDay)} إلى {formatDay(p.lastDay)}</> : formatDay(p.firstDay)} · آخرها <Money minor={p.lastMinor} /></span>
                    </span>
                    {p.viaOwner ? <Badge tone="muted">تحويلات لحسابك</Badge> : <Badge tone="accent">رواتب</Badge>}
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-accent"><UserPlus className="h-3.5 w-3.5" aria-hidden />أضفه</span>
                  </summary>
                  <div className="border-t border-line p-3">
                    <EmployeeForm initial={{
                      ...BLANK_EMPLOYEE, name: p.name, bankBeneficiaryId: p.beneficiaryId,
                      hiredOn: `${p.firstDay.slice(0, 7)}-01`, salary: p.viaOwner ? "" : formatRiyals(p.lastMinor),
                    }} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {canEdit && (
        <Section id="add" title="أضف موظفاً" icon={UserPlus}>
          <EmployeeForm initial={{ ...BLANK_EMPLOYEE, hiredOn: todayInRiyadh() }} />
        </Section>
      )}

      {left.length > 0 && (
        <Section title="تركوا العمل" icon={Users} count={left.length} hint="يبقى سجلهم ورواتبهم وما حُوّل لهم كما هو.">
          <DataTable columns={columns.filter((c) => c.key !== "link")} rows={left} keyOf={(e) => e.id} hrefOf={(e) => `/payroll/employee/${e.id}`} />
        </Section>
      )}
    </PageShell>
  );
}
