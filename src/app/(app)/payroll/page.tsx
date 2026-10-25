import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight, Download, Info, Link2, ReceiptText, UserPlus, Users } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney, MonthTabs } from "@/components/finance-bits";
import { PostAction } from "@/components/post-action";
import { LinkSuggestedButton, LinkTransferForm, NotPayrollButton, type OwedByMonth } from "@/components/payroll/forms";
import { Badge, buttonClass, Callout, DataTable, EmptyState, LinkButton, Meter, NoAccess, Section, Stat, StatGrid, type Column } from "@/components/ui";
import { monthsBetween } from "@/lib/finance/pnl";
import { formatRiyalsDisplay } from "@/lib/money";
import { countNoun, EMPLOYEE, TRANSFER } from "@/lib/arabic";
import { ADJUSTMENT_LABEL, payrollTotals, PURPOSE_LABEL, suggestedPayMonth } from "@/lib/payroll/calc";
import { currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadBankPayees, loadEmployees, loadPayrollMonth, loadPayrollMonths, loadOpenTransfers, transfersSince, type PayrollRow, type TransferView } from "@/services/payroll.service";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ما ينقص الراتب، بكلماتٍ — لعمود الخصومات. */
function deductionText(r: PayrollRow): string {
  const s = r.slip;
  const parts: string[] = [];
  for (const a of r.adjustments) {
    if (a.kind === "DEDUCTION" || a.kind === "FINE" || a.kind === "LOAN_REPAYMENT") parts.push(`${ADJUSTMENT_LABEL[a.kind]} ${formatRiyalsDisplay(a.amountMinor)}`);
  }
  if (s.lateMinutes + s.earlyMinutes > 0) parts.push(`تأخير ${s.lateMinutes + s.earlyMinutes} دقيقة`);
  if (s.absentDays > 0) parts.push(`غياب ${s.absentDays} يوم`);
  if (s.penaltiesMinor > 0) parts.push(`جزاءات اللائحة ${formatRiyalsDisplay(s.penaltiesMinor)}`);
  if (s.warnings > 0) parts.push(`${s.warnings} إنذار`);
  return parts.join(" · ");
}

/**
 * مسيّرُ الرواتب — لكلّ موظّفٍ في الشهر: راتبُه بأيّامه، وما زاد وما نقص، وما حُوِّل له، وكم بقي.
 * وتحته الحوالاتُ التي لم تُوزَّع بعد: حوالةُ «راتب» تُقترح لصاحبها برقم المستفيد، وتحويلُ المالك
 * لنفسه يُقسَم بيده على مَن دفع لهم.
 */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/payroll");
  if (!can(user.role, "payroll:view")) {
    return <PageShell user={user} title="مسيّر الرواتب"><NoAccess what="الرواتب" /></PageShell>;
  }
  const canEdit = can(user.role, "payroll:edit");
  const q = await searchParams;
  const current = currentMonthRiyadh();
  const month = q.month && MONTH_RE.test(q.month) ? q.month : current;

  const [sheet, open, payees, staff] = await Promise.all([
    loadPayrollMonth(month),
    loadOpenTransfers(transfersSince(month)),
    loadBankPayees(),
    loadEmployees(),
  ]);
  const totals = payrollTotals(sheet.rows.map((r) => r.slip));
  /* الأشهرُ من أوّل مباشرةٍ مسجّلة — لا من تاريخٍ مكتوب في الشيفرة */
  const firstMonth = staff.reduce((m, e) => (e.hiredOn.slice(0, 7) < m ? e.hiredOn.slice(0, 7) : m), month < current ? month : current);
  const months = monthsBetween(firstMonth, current > month ? current : month).reverse().slice(0, 12);
  /* الحوالةُ قد تكون لمن ترك العمل أو لم يبدأ شهرَه — فالقائمةُ كلُّ الموظّفين، العاملون أوّلاً */
  const people = [...staff].sort((a, b) => Number(Boolean(a.leftOn)) - Number(Boolean(b.leftOn))).map((e) => ({ id: e.id, name: e.leftOn ? `${e.name} (ترك العمل)` : e.name }));
  const salaryOpen = open.filter((o) => !o.viaOwner);
  const ownerOpen = open.filter((o) => o.viaOwner);
  /* ما بقي لكلّ موظّف — لزرّ «املأ بما بقي» — لشهر الصفحة وأشهرِ الحوالات المفتوحة (أربعةٌ على الأكثر) */
  const owedMonths = [...new Set([month, ...open.map((o) => o.suggestion?.month ?? suggestedPayMonth(o.day))])].sort().reverse().slice(0, 4);
  const others = owedMonths.filter((m) => m !== month);
  const owedSheets = [sheet, ...await loadPayrollMonths(others)];
  /*
    وما في الطريق إليه: حوالةُ «راتب» إلى حسابه لم تُربط بعد هي راتبُه — فلا يُملأ له من تحويلك لنفسك
    ما سيصله بحوالته (البراء وأنس في ٢٧ سبتمبر)، وإلّا حُسب له مرّتين.
  */
  const incoming = new Map<string, number>();
  for (const o of salaryOpen) {
    if (!o.suggestion) continue;
    const k = `${o.suggestion.month}|${o.suggestion.employeeId}`;
    incoming.set(k, (incoming.get(k) ?? 0) + o.freeMinor);
  }
  const owed: OwedByMonth = Object.fromEntries(owedSheets.map((sh) => [sh.month, sh.rows
    .map((r) => ({ employeeId: r.employee.id, remainingMinor: (r.slip.remainingMinor ?? 0) - (incoming.get(`${sh.month}|${r.employee.id}`) ?? 0) }))
    .filter((r) => r.remainingMinor > 0)]));
  const suggested = open.filter((o) => o.suggestion && !o.viaOwner);
  const settled = sheet.rows.filter((r) => r.slip.remainingMinor !== null && r.slip.remainingMinor <= 0).length;
  const notInPnl = open.filter((o) => o.notInPnl);
  const allLinks = sheet.rows.flatMap((r) => r.links.map((l) => ({ ...l, name: r.employee.name })));
  /* أجزاءُ الحوالة الواحدة معاً — تُرى القسمةُ كما وقعت */
  const groups = [...allLinks.reduce((m, l) => {
    const g = m.get(l.txId) ?? { txId: l.txId, day: l.txDay, viaOwner: l.viaOwner, payee: l.txPayee, txAmountMinor: l.txAmountMinor, freeMinor: l.txFreeMinor, parts: [] as typeof allLinks };
    g.parts.push(l);
    return m.set(l.txId, g);
  }, new Map<string, { txId: string; day: string; viaOwner: boolean; payee: string | null; txAmountMinor: number; freeMinor: number; parts: typeof allLinks }>()).values()].sort((a, b) => a.day.localeCompare(b.day));

  const columns: Column<PayrollRow>[] = [
    {
      key: "name", header: "الموظف", primary: true,
      cell: (r) => (
        <span className="min-w-0">
          <span className="font-bold">{r.employee.name}</span>
          <span className="block text-[11px] text-muted">
            {r.employee.kind === "PART_TIME" ? "جزئي" : r.employee.jobTitle ?? "دوام كامل"}
            {r.slip.days && r.slip.days.worked < r.slip.days.of && <> · {r.slip.days.worked} من {r.slip.days.of} يوماً</>}
          </span>
          {(r.violations.some((v) => !v.waived) || r.loanMinor > 0 || r.article80.length > 0 || r.rateMinor === null) && (
            <span className="mt-1 flex flex-wrap gap-1">
              {r.rateMinor === null && <Badge tone="warn">بلا راتب مكتوب</Badge>}
              {r.slip.warnings > 0 && <Badge tone="warn">{r.slip.warnings === 1 ? "إنذار" : `${r.slip.warnings} إنذارات`}</Badge>}
              {r.slip.penaltiesMinor > 0 && <Badge tone="danger">جزاءات {formatRiyalsDisplay(r.slip.penaltiesMinor)}</Badge>}
              {r.article80.length > 0 && <Badge tone="danger">غياب يجيز الفصل</Badge>}
              {r.loanMinor > 0 && <Badge tone="muted">سلف {formatRiyalsDisplay(r.loanMinor)}</Badge>}
            </span>
          )}
        </span>
      ),
      sortBy: (r) => r.employee.name,
    },
    {
      key: "base", header: "الراتب", numeric: true,
      cell: (r) => <MaybeMoney minor={r.slip.baseMinor} why={r.employee.kind === "MONTHLY" ? "لم يُكتب راتبه" : undefined} />,
      sortBy: (r) => r.slip.baseMinor,
    },
    { key: "add", header: "إضافات", numeric: true, secondary: true, cell: (r) => (r.slip.additionsMinor > 0 ? <Money minor={r.slip.additionsMinor} /> : <span className="text-muted">—</span>) },
    {
      key: "ded", header: "خصومات", numeric: true,
      cell: (r) => r.slip.deductionsMinor === null ? <MaybeMoney minor={null} />
        : r.slip.deductionsMinor > 0 ? <span title={deductionText(r)}><Money minor={-r.slip.deductionsMinor} signed /></span> : <span className="text-muted">—</span>,
    },
    { key: "adv", header: "سلف نقداً", numeric: true, secondary: true, cell: (r) => (r.slip.advancesMinor > 0 ? <Money minor={-r.slip.advancesMinor} signed /> : <span className="text-muted">—</span>) },
    { key: "due", header: "المستحق", numeric: true, cell: (r) => <MaybeMoney minor={r.slip.dueMinor} />, sortBy: (r) => r.slip.dueMinor },
    { key: "paid", header: "حُوّل", numeric: true, cell: (r) => (r.slip.paidMinor > 0 ? <Money minor={r.slip.paidMinor} /> : <span className="text-muted">—</span>), sortBy: (r) => r.slip.paidMinor },
    {
      key: "left", header: "الباقي للتحويل", numeric: true,
      cell: (r) => r.slip.remainingMinor === null ? <MaybeMoney minor={null} />
        : r.slip.remainingMinor > 0 ? <strong><Money minor={r.slip.remainingMinor} tone="warn" /></strong>
        : r.slip.remainingMinor < 0 ? <span className="text-[11px] font-bold text-danger">حُوّل زيادة <Money minor={-r.slip.remainingMinor} /></span>
        : <Badge tone="ok">اكتمل</Badge>,
      sortBy: (r) => r.slip.remainingMinor,
    },
  ];

  return (
    <PageShell
      user={user}
      title="مسيّر الرواتب"
      intro="كم يستحق كل موظف هذا الشهر بعد الخصومات والسلف، وكم حوّلت له، وكم بقي."
      actions={
        <>
          <a href={`/api/payroll/export?month=${month}`} download className={buttonClass("quiet", "sm")}><Download className="h-3.5 w-3.5" aria-hidden />تنزيل المسيّر</a>
          <LinkButton href="/payroll/employees" variant="secondary" size="sm" icon={Users}>الموظفون</LinkButton>
        </>
      }
    >
      <MonthTabs base="/payroll" months={months} active={month} />

      {sheet.rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Users}
            title={`لا موظفين يعملون في ${formatMonth(month)}.`}
            hint={payees.length > 0
              ? `وجدنا في كشف البنك ${payees.length} أشخاص حوّلت لهم، أضفهم بضغطة من صفحة الموظفين.`
              : "أضف موظفيك وراتب كل منهم، ثم يُحسب المسيّر كل شهر وحده."}
            action={canEdit ? <LinkButton href="/payroll/employees#add" variant="primary" icon={UserPlus}>أضف الموظفين</LinkButton> : undefined}
          />
        </div>
      ) : (
        <>
          <div className="mt-5">
            <StatGrid>
              <Stat label={month === current ? "المستحق عن الشهر كاملاً" : "المستحق للشهر"} minor={totals.dueMinor} sub={totals.unknown > 0 ? `ومعه ${countNoun(totals.unknown, EMPLOYEE)} بلا راتب مكتوب، فالمجموع ناقص` : countNoun(sheet.rows.length, EMPLOYEE)} tone={totals.unknown > 0 ? "warn" : undefined} />
              {/* «٠٫٠٠ حُوّل» فوق حوالاتٍ لم توزَّع يُقرأ «لم أحوّل شيئاً» — فيُقال ما ينتظر التوزيع بجانب الرقم ويُفتح */}
              <Stat
                label="حُوّل من الرواتب"
                minor={totals.paidMinor}
                sub={salaryOpen.length > 0
                  ? <><a href="#transfers" className="font-bold text-warn hover:underline">{countNoun(salaryOpen.length, TRANSFER)} في الكشف لم توزَّع بعد</a>، فما يُعدّ هنا ما وُزّع منها</>
                  : "ما وُزّع من الحوالات راتباً أو سلفة، وما دُفع خارج الكشف"}
              />
              <Stat label="الباقي للتحويل" minor={totals.remainingMinor} tone={totals.remainingMinor > 0 ? "warn" : "ok"} sub={totals.overpaidMinor > 0 ? `وحُوّل زيادةً ${formatRiyalsDisplay(totals.overpaidMinor)} لبعضهم` : "هذا ما يلزمك تحويله الآن"} />
            </StatGrid>
            {totals.dueMinor > 0 && (
              <div className="mt-3 rounded-xl border border-line bg-raised px-4 py-3 shadow-raised">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold">{settled === sheet.rows.length ? "اكتمل الشهر: وصل كل موظف مستحقه" : `اكتمل ${settled} من ${countNoun(sheet.rows.length, EMPLOYEE)}`}</span>
                  <span className="nums text-muted">{Math.min(100, Math.floor((Math.min(totals.paidMinor, totals.dueMinor) * 100) / totals.dueMinor))}٪ مما يستحقونه</span>
                </div>
                <Meter value={Math.min(totals.paidMinor, totals.dueMinor)} max={totals.dueMinor} tone={settled === sheet.rows.length ? "ok" : "accent"} label="ما حُوّل مما يستحقه الموظفون" />
              </div>
            )}
          </div>

          <Section title="الموظفون هذا الشهر" icon={ReceiptText} count={sheet.rows.length} hint="افتح أي موظف لتضيف خصماً أو سلفة أو مخالفة أو تأخيراً، أو لترى قسيمة راتبه.">
            <DataTable columns={columns} rows={sheet.rows} keyOf={(r) => r.employee.id} hrefOf={(r) => `/payroll/employee/${r.employee.id}?month=${month}`} />
          </Section>
        </>
      )}

      <Section
        id="transfers"
        title="حوالات لم توزَّع بعد"
        icon={ArrowLeftRight}
        count={salaryOpen.length}
        hint="حوالات «راتب» في الكشف لم توزَّع بعد. وزّع كل واحدة على صاحبها وغرضها، فليس كل ما حُوّل لموظف راتباً. وما ليس لموظف أصلاً فأخفه."
        action={canEdit && suggested.length > 0 ? <LinkSuggestedButton month={month} txIds={suggested.map((o) => o.id)} /> : undefined}
      >
        {notInPnl.length > 0 && (
          <Callout tone="warn" icon={Info} title={`${countNoun(notInPnl.length, TRANSFER)} رواتب لم تُقيَّد مصروفاً، فلا تظهر في قائمة الدخل`} className="mb-3">
            <p>مجموعها {formatRiyalsDisplay(notInPnl.reduce((s, o) => s + o.amountMinor, 0))} ريال. قيّدها من صفحة المصروفات حتى يكتمل ربح أشهرها.</p>
            <LinkButton href="/money/expenses" variant="secondary" size="sm" className="mt-2">افتح المصروفات</LinkButton>
          </Callout>
        )}
        {salaryOpen.length === 0 ? (
          <EmptyState compact icon={Link2} title="كل حوالات الرواتب موزّعة." hint="حين تصل حوالة رواتب جديدة في الكشف تظهر هنا." />
        ) : (
          <ul className="space-y-2">
            {salaryOpen.map((o) => <TransferItem key={o.id} o={o} canEdit={canEdit} people={people} owed={owed} />)}
          </ul>
        )}
        {ownerOpen.length > 0 && (
          <details className="mt-4 rounded-xl border border-line bg-sunken/40">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold">
              تحويلاتك لحسابك منذ أول الشهر السابق ({ownerOpen.length})
              <span className="block text-[11px] font-normal text-muted">أغلبها شخصي ويبقى كما هو. افتح منها ما دفعت منه رواتب أو فواتير، ووزّع ذلك الجزء وحده.</span>
            </summary>
            <ul className="space-y-2 px-3 pb-3">
              {ownerOpen.map((o) => <TransferItem key={o.id} o={o} canEdit={canEdit} people={people} owed={owed} />)}
            </ul>
          </details>
        )}
      </Section>

      <Section title={`ما وُزّع عن ${formatMonth(month)}`} icon={Link2} count={allLinks.length} hint="كل حوالة وما نُسب منها لكل موظف بغرضه. فكّ أي جزء يعيده إلى «لم توزَّع».">
        {allLinks.length === 0 ? (
          <EmptyState icon={Link2} title="لم توزَّع حوالات على هذا الشهر بعد." />
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.txId} className="rounded-xl border border-line bg-raised shadow-raised">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 text-xs">
                  <span className="min-w-0 flex-1 font-bold">{g.viaOwner ? "تحويل لحسابك" : `حوالة إلى ${g.payee ?? "حساب غير معروف"}`} · {formatDay(g.day)}</span>
                  <span className="text-muted">الحوالة <Money minor={g.txAmountMinor} />{g.freeMinor > 0 && <> · غير موزّع منها <Money minor={g.freeMinor} /></>}</span>
                </p>
                <ul className="divide-y divide-line">
                  {g.parts.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1 basis-48 text-sm"><strong>{l.name}</strong> · {PURPOSE_LABEL[l.purpose]}{l.note && <span className="block text-[11px] text-muted">{l.note}</span>}</span>
                      <Money minor={l.amountMinor} />
                      {canEdit && <PostAction url="/api/payroll/link" body={{ action: "unlink", id: l.id }} variant="quiet" done="فُكّ الربط">فكّ</PostAction>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}

/** حوالةٌ لم تُوزَّع — تُفتح فيُختار صاحبُها وغرضُها، أو تُخفى إن لم تكن لموظّف. */
function TransferItem({ o, canEdit, people, owed }: { o: TransferView; canEdit: boolean; people: { id: string; name: string }[]; owed: OwedByMonth }) {
  return (
    <li className="rounded-xl border border-line bg-raised shadow-raised">
      <details>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <span className="min-w-0 flex-1 basis-56">
            <span className="text-sm font-bold">{o.viaOwner ? "تحويل لحسابك" : o.payeeName ?? "حوالة راتب"}</span>
            <span className="block text-[11px] text-muted">
              {formatDay(o.day)}
              {o.suggestion && <> · يبدو أنها لـ<strong className="text-ink-soft">{o.suggestion.employeeName}</strong> عن {formatMonth(o.suggestion.month)}</>}
              {!o.suggestion && o.beneficiaryId && !o.viaOwner && <> · مستفيد غير مسجّل موظفاً</>}
            </span>
          </span>
          <span className="text-end">
            <Money minor={o.amountMinor} currency />
            {o.freeMinor < o.amountMinor && <span className="block text-[11px] text-warn">باقٍ {formatRiyalsDisplay(o.freeMinor)}</span>}
          </span>
          {o.viaOwner ? <Badge tone="muted">من حسابك</Badge> : <Badge tone="accent">راتب</Badge>}
        </summary>
        {canEdit && (
          <div className="space-y-3 border-t border-line px-4 py-4">
            {people.length === 0 ? (
              <p className="text-xs text-muted">أضف الموظف أولاً من <Link className="underline" href="/payroll/employees">صفحة الموظفين</Link>.</p>
            ) : (
              <LinkTransferForm
                tx={{ id: o.id, freeMinor: o.freeMinor, freeText: formatRiyalsDisplay(o.freeMinor), viaOwner: o.viaOwner }}
                employees={people}
                owed={o.viaOwner ? owed : undefined}
                defaults={{ employeeId: o.suggestion?.employeeId ?? "", month: o.suggestion?.month ?? suggestedPayMonth(o.day), purpose: "SALARY" }}
              />
            )}
            {!o.viaOwner && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[11px] text-muted">
                {!o.suggestion && o.beneficiaryId && <Link className="font-bold text-accent underline" href="/payroll/employees">أضف المستفيد موظفاً</Link>}
                <NotPayrollButton txId={o.id} />
              </div>
            )}
          </div>
        )}
      </details>
    </li>
  );
}
