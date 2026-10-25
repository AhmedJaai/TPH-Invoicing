import { DAY, countNoun } from "@/lib/arabic";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, CalendarClock, FileBadge, HandCoins, History, Link2, Pencil, Printer, ReceiptText, Scale, TriangleAlert, Wallet } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney, MonthTabs } from "@/components/finance-bits";
import { PostAction } from "@/components/post-action";
import { ObligationForm } from "@/components/obligation-form";
import {
  AdjustmentForm, CheckinLinkPanel, DayForm, DeleteEmployeeButton, EmployeeForm, LinkTransferForm, RateForm, ViolationForm, WeekForm,
} from "@/components/payroll/forms";
import { Badge, Callout, Card, EmptyState, LinkButton, NoAccess, Section } from "@/components/ui";
import { monthsBetween } from "@/lib/finance/pnl";
import { formatRiyalsDisplay } from "@/lib/money";
import { ADJUSTMENT_LABEL, endOfService, formatMinutes, PURPOSE_LABEL, rateFor, suggestedPayMonth } from "@/lib/payroll/calc";
import { WEEKDAY_LABEL, workedMinutes } from "@/lib/payroll/attendance";
import { ORDINAL, penaltyLabel } from "@/lib/payroll/saudi-rules";
import { addDays, daysBetween, currentMonthRiyadh, formatDay, formatMonth, monthEndDay, todayInRiyadh } from "@/lib/riyadh-time";
import { OBLIGATION_KIND_LABEL, isObligationKind } from "@/lib/obligations";
import {
  loadCheckins, loadEmployee, loadEmployeeDocuments, loadEmployeeHistory, loadEmployeeLinks, loadOpenTransfers, loadPayrollMonth, transfersSince,
} from "@/services/payroll.service";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ATT_LABEL = { LATE: "تأخر", EARLY: "انصرف مبكراً", ABSENT: "غاب", LEAVE: "إجازة" } as const;

function Line({ label, minor, sign, strong, note }: { label: string; minor: number | null; sign?: "+" | "−"; strong?: boolean; note?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "border-t border-line font-bold" : ""}`}>
      <span className="min-w-0 text-sm">{label}{note && <span className="block text-[11px] font-normal text-muted">{note}</span>}</span>
      <span className="shrink-0">{minor === null ? <MaybeMoney minor={null} /> : <>{sign && minor !== 0 && <span className="text-muted">{sign} </span>}<Money minor={minor} /></>}</span>
    </div>
  );
}

/** الموظّفُ في شهر: قسيمتُه وبنودُها، وما حُوِّل له، وحضورُه — ثمّ ملفُّه كلُّه. */
export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/payroll/employees");
  if (!can(user.role, "payroll:view")) {
    return <PageShell user={user} title="الموظف"><NoAccess what="الرواتب" /></PageShell>;
  }
  const canEdit = can(user.role, "payroll:edit");
  const { id } = await params;
  const q = await searchParams;
  const employee = await loadEmployee(id);
  if (!employee) notFound();
  const today = todayInRiyadh();
  const current = currentMonthRiyadh();
  const month = q.month && MONTH_RE.test(q.month) ? q.month : current;
  const endMonth = employee.leftOn && employee.leftOn.slice(0, 7) < current ? employee.leftOn.slice(0, 7) : current;
  const workMonths = monthsBetween(employee.hiredOn.slice(0, 7), endMonth).reverse();

  const [sheet, links, docs, open, checkins, history] = await Promise.all([
    loadPayrollMonth(month),
    loadEmployeeLinks(id),
    loadEmployeeDocuments(id),
    loadOpenTransfers(transfersSince(month)),
    loadCheckins(`${month}-01`, monthEndDay(month)),
    loadEmployeeHistory(id, workMonths.slice(0, 24)),
  ]);
  const row = sheet.rows.find((r) => r.employee.id === id);
  const slip = row?.slip;
  const rate = rateFor(employee.rates, month);
  /* حوالاتُه هو (برقم المستفيد) في كلّ الأشهر، وتحويلاتُك لحسابك حول هذا الشهر وحده */
  const windowEnd = addDays(monthEndDay(month), 10);
  const mine = open.filter((o) => o.suggestion?.employeeId === id || (o.viaOwner && o.day >= `${month}-01` && o.day <= windowEnd));
  const myCheckins = checkins.filter((c) => c.employeeId === id);
  const worked = workedMinutes(myCheckins.map((c) => ({ kind: c.kind, at: c.at, rejected: c.review === "REJECTED" })));
  const loanLinks = links.filter((l) => l.purpose === "LOAN");
  const otherLinks = links.filter((l) => l.purpose === "INVOICE" || l.purpose === "EXPENSE" || l.purpose === "PERSONAL");
  const latestRate = rateFor(employee.rates, endMonth);
  const serviceDays = daysBetween(employee.hiredOn, employee.leftOn ?? today) + 1;
  const eos = latestRate !== null && employee.kind === "MONTHLY" ? endOfService(latestRate, serviceDays) : null;
  const defaultDay = month === current ? today : `${month}-01`;
  /*
    الرصيدُ منذ المباشرة: ما استحقّه كلَّ شهرٍ مقابل ما وصله — زيادةُ شهرٍ لا تُنسى في الذي بعده.
    والشهرُ الجاري خارجه حتى ينتهي، وشهرٌ مستحقُّه مجهول يُقال ولا يُعدّ صفراً.
  */
  const closedMonths = history.filter((h) => h.month < current);
  const unknownMonths = closedMonths.filter((h) => h.slip.dueMinor === null).length;
  const balanceMinor = closedMonths.reduce((sum, h) => sum + (h.slip.dueMinor ?? 0) - h.slip.paidMinor, 0);
  const gaps = closedMonths.filter((h) => h.slip.dueMinor !== null && h.slip.dueMinor !== h.slip.paidMinor)
    .map((h) => ({ month: h.month, diff: (h.slip.dueMinor ?? 0) - h.slip.paidMinor }));
  const pendingMinor = open.filter((o) => o.suggestion?.employeeId === id).reduce((sum, o) => sum + o.freeMinor, 0);

  return (
    <PageShell
      user={user}
      title={employee.name}
      eyebrow={<>{employee.jobTitle ?? (employee.kind === "PART_TIME" ? "موظف جزئي" : "دوام كامل")} · منذ {formatDay(employee.hiredOn)}{employee.leftOn && <> · ترك العمل {formatDay(employee.leftOn)}</>}</>}
      actions={
        <>
          <LinkButton href={`/payroll?month=${month}`} variant="quiet" size="sm" icon={ArrowRight}>المسيّر</LinkButton>
          <LinkButton href={`/payroll/slip/${id}?month=${month}`} variant="secondary" size="sm" icon={Printer}>قسيمة الراتب</LinkButton>
        </>
      }
    >
      <MonthTabs base={`/payroll/employee/${id}`} months={workMonths.slice(0, 12)} active={month} />
      <nav aria-label="أقسام الصفحة" className="sticky top-(--app-header) z-10 -mx-1 mt-3 flex gap-1 overflow-x-auto bg-surface/90 px-1 py-2 backdrop-blur">
        {[["#month", "الشهر"], ["#violations", "المخالفات"], ["#transfers", "الحوالات"], ["#salary", "الراتب"], ["#checkin", "الحضور"], ["#docs", "الوثائق"], ["#history", "السجل"], ["#edit", "البيانات"]]
          .filter(([href]) => employee.kind === "MONTHLY" || href !== "#violations")
          .map(([href, label]) => <a key={href} href={href} className="shrink-0 rounded-full border border-line bg-raised px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-hover">{label}</a>)}
      </nav>
      {closedMonths.length > 0 && (
        <Callout tone={balanceMinor > 0 ? "warn" : balanceMinor < 0 ? "info" : "ok"} icon={Wallet} className="mt-3"
          title={balanceMinor > 0 ? `باقٍ له ${formatRiyalsDisplay(balanceMinor)} ريال من الأشهر الماضية` : balanceMinor < 0 ? `حُوّل له ${formatRiyalsDisplay(-balanceMinor)} ريال فوق مستحقه في الأشهر الماضية` : "حسابه مع المقهى متساوٍ حتى آخر شهر انتهى"}>
          منذ {formatMonth(closedMonths[closedMonths.length - 1].month)}، كل شهر بما استحقه وما وصله.
          {gaps.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {gaps.map((g) => (
                <a key={g.month} href={`/payroll/employee/${id}?month=${g.month}`} className="rounded-full border border-line bg-raised px-2 py-0.5 text-[11px] font-bold hover:bg-hover">
                  {formatMonth(g.month)}: {g.diff > 0 ? `باقٍ ${formatRiyalsDisplay(g.diff)}` : `زيادة ${formatRiyalsDisplay(-g.diff)}`}
                </a>
              ))}
            </span>
          )}
          {pendingMinor > 0 && <span className="mt-1 block font-bold">وفي الكشف حوالات له بـ{formatRiyalsDisplay(pendingMinor)} ريال لم توزَّع بعد. <a className="underline" href="#transfers">وزّعها</a></span>}
          {balanceMinor < 0 && " إن كانت سلفة فسجّلها قسطاً، وإن كان راتبه أعلى مما كتبت فعدّل الراتب."}
          {unknownMonths > 0 && ` (${unknownMonths} شهر بلا راتب مكتوب لم يدخل الحساب)`}
        </Callout>
      )}

      {!row ? (
        <div className="mt-6"><EmptyState icon={ReceiptText} title={`لم يكن يعمل في ${formatMonth(month)}.`} /></div>
      ) : (
        <div id="month" className="mt-5 grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <Card>
            <h2 className="flex items-center gap-2 text-sm font-bold"><ReceiptText className="h-4 w-4 text-muted" aria-hidden />{formatMonth(month)}</h2>
            <div className="mt-2 divide-y divide-line/60">
              <Line
                label={employee.kind === "PART_TIME" ? `أجر الأسابيع (${row.weeks.length})` : "الراتب"}
                minor={slip!.baseMinor}
                note={employee.kind === "MONTHLY" && slip!.days && slip!.days.worked < slip!.days.of
                  ? `${countNoun(slip!.days.worked, DAY)} من ${slip!.days.of} من راتب ${rate !== null ? formatRiyalsDisplay(rate) : "غير معروف"}`
                  : employee.kind === "PART_TIME" && rate !== null ? `أجر الساعة ${formatRiyalsDisplay(rate)}` : undefined}
              />
              {row.adjustments.filter((a) => a.kind === "BONUS" || a.kind === "OVERTIME" || a.kind === "ALLOWANCE").map((a) => (
                <Line key={a.id} label={ADJUSTMENT_LABEL[a.kind]} note={a.note ?? undefined} minor={a.amountMinor} sign="+" />
              ))}
              {row.adjustments.filter((a) => a.kind === "DEDUCTION" || a.kind === "FINE" || a.kind === "LOAN_REPAYMENT").map((a) => (
                <Line key={a.id} label={ADJUSTMENT_LABEL[a.kind]} note={a.note ?? undefined} minor={a.amountMinor} sign="−" />
              ))}
              {slip!.lateMinutes + slip!.earlyMinutes > 0 && (
                <Line label="أجر دقائق التأخير والانصراف المبكر" note={`${slip!.lateMinutes + slip!.earlyMinutes} دقيقة لم يعملها${employee.lateGraceMinutes > 0 ? ` · ما كان في حدود سماح ${employee.lateGraceMinutes} دقيقة لم يُحسب` : ""}`} minor={slip!.lateMinor} sign="−" />
              )}
              {slip!.absentDays > 0 && <Line label="أجر أيام الغياب" note={`${slip!.absentDays} يوم`} minor={slip!.absenceMinor} sign="−" />}
              {(slip!.penaltiesMinor > 0 || slip!.warnings > 0) && (
                <Line label="جزاءات المخالفات (لائحة تنظيم العمل)"
                  note={[slip!.warnings > 0 ? `${slip!.warnings} إنذار كتابي بلا خصم` : null, slip!.penaltiesDroppedMinor > 0 ? `وزاد ${formatRiyalsDisplay(slip!.penaltiesDroppedMinor)} على حد أجر خمسة أيام فلا يُحسم` : null].filter(Boolean).join(" · ") || undefined}
                  minor={slip!.penaltiesMinor} sign="−" />
              )}
              {slip!.overHalfMinor > 0 && <p className="py-2 text-[11px] font-bold text-warn">زادت الخصومات على نصف الراتب، فلم يُحسم {formatRiyalsDisplay(slip!.overHalfMinor)} ريال (نظام العمل، م 92)</p>}
              <Line label="المستحق عن الشهر" minor={slip!.earnedMinor} strong />
              {slip!.advancesMinor > 0 && <Line label="سلف نقداً على الراتب" minor={slip!.advancesMinor} sign="−" />}
              <Line label="حُوّل له" minor={slip!.paidMinor} sign="−" note={slip!.paidOutsideMinor > 0 ? `منها ${formatRiyalsDisplay(slip!.paidOutsideMinor)} خارج كشف البنك` : undefined} />
              <Line label={slip!.remainingMinor !== null && slip!.remainingMinor < 0 ? "حُوّل له زيادة" : "الباقي للتحويل"} minor={slip!.remainingMinor === null ? null : Math.abs(slip!.remainingMinor)} strong />
            </div>
            {slip!.leaveDays > 0 && <p className="mt-2 text-[11px] text-muted">وأخذ {slip!.leaveDays} يوم إجازة لا يُخصم عليها.</p>}
            {row.loanMinor > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-warn"><HandCoins className="h-3.5 w-3.5" aria-hidden />عليه سلف متبقية بـ{formatRiyalsDisplay(row.loanMinor)} ريال</p>}
            {rate === null && employee.kind === "MONTHLY" && <Callout tone="warn" className="mt-3" title="لم يُكتب راتبه لهذا الشهر">اكتبه من «الراتب» أدناه ليُحسب مستحقه.</Callout>}
          </Card>

          {canEdit && (
            <div className="space-y-5">
              <Card>
                <h2 className="mb-3 text-sm font-bold">سلفة، مكافأة، بدل، تعويض ضرر…</h2>
                <AdjustmentForm employeeId={id} month={month} loanMinor={row.loanMinor} />
              </Card>
              {employee.kind === "MONTHLY" ? (
                <Card>
                  <h2 className="mb-3 text-sm font-bold">تأخير، انصراف مبكر، غياب، إجازة</h2>
                  <DayForm employeeId={id} salaryMinor={rate} shiftMinutes={employee.shiftMinutes} graceMinutes={employee.lateGraceMinutes} defaultDay={defaultDay} />
                </Card>
              ) : (
                <Card>
                  <h2 className="mb-3 text-sm font-bold">أسبوع عمل</h2>
                  <WeekForm employeeId={id} defaultDay={defaultDay} suggestedHours={worked.minutes > 0 ? formatMinutes(worked.minutes) : undefined} />
                  {worked.minutes > 0 && <p className="mt-2 text-[11px] text-muted">من تسجيل الحضور هذا الشهر: {formatMinutes(worked.minutes)} ساعة{worked.open > 0 ? `، و${worked.open} حضور بلا انصراف لم يُحسب` : ""}.</p>}
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {row && (row.adjustments.length > 0 || row.attendance.length > 0 || row.weeks.length > 0) && (
        <Section title="بنود الشهر" icon={CalendarClock} count={row.adjustments.length + row.attendance.length + row.weeks.length}>
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
            {row.adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 basis-48 text-sm">{ADJUSTMENT_LABEL[a.kind]}{a.note && <span className="block text-[11px] text-muted">{a.note}</span>}</span>
                <Money minor={a.amountMinor} />
                {canEdit && <PostAction url="/api/payroll/entry" body={{ action: "adjust-void", id: a.id }} variant="quiet" done="سُحب">اسحب</PostAction>}
              </li>
            ))}
            {row.attendance.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 basis-48 text-sm">
                  {ATT_LABEL[a.kind]} {a.minutes !== null && <span className="nums">{a.minutes} دقيقة</span>} · {formatDay(a.day)}
                  <span className="block text-[11px] text-muted">{a.source === "CHECKIN" ? "من تسجيل الحضور" : "سجّلته بيدك"}{a.disrupted ? " · عطّل زملاءه" : ""}{a.note && a.source === "MANUAL" ? ` · ${a.note}` : ""}</span>
                </span>
                {canEdit && <PostAction url="/api/payroll/entry" body={{ action: "day-clear", id: a.id }} variant="quiet" done="مُسح">امسح</PostAction>}
              </li>
            ))}
            {row.weeks.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 basis-48 text-sm">أسبوع {formatDay(w.weekStart)}{w.minutes !== null && <span className="block text-[11px] text-muted">{formatMinutes(w.minutes)} ساعة</span>}</span>
                <Money minor={w.amountMinor} />
                {canEdit && <PostAction url="/api/payroll/entry" body={{ action: "week-clear", id: w.id }} variant="quiet" done="مُسح">امسح</PostAction>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {row && employee.kind === "MONTHLY" && (
        <Section id="violations" title="المخالفات والجزاءات" icon={Scale} count={row.violations.length}
          hint="من جدول المخالفات في لائحة تنظيم العمل النموذجية: الجزاء بنوع المخالفة ومرتها خلال 180 يوماً، نسبةً من أجر اليوم، ولا يزيد جزاء المخالفة ولا مجموع الشهر على أجر خمسة أيام. لك أن تعفو عن أي جزاء.">
          {row.article80.map((a) => (
            <Callout key={a.start} tone="danger" icon={TriangleAlert} className="mb-3" title={`غاب ${countNoun(a.days, DAY)} متصلة من ${formatDay(a.start)}`}>
              الغياب أكثر من عشرة أيام متصلة يجيز الفصل دون مكافأة بشرط إنذاره كتابةً بعد خمسة أيام غياب (نظام العمل، م 80). هذا قرارك، ولا يُحسم له مبلغ هنا غير أجر أيام الغياب.
            </Callout>
          ))}
          {row.violations.length === 0 ? <EmptyState compact icon={Scale} title="لا مخالفات هذا الشهر." /> : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
              {row.violations.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 basis-56 text-sm">
                    {v.detail} · {formatDay(v.day)}
                    <span className="block text-[11px] text-muted">البند {v.code}: {v.label} · المرة {ORDINAL[Math.min(v.occurrence, 4) - 1]} ← {penaltyLabel(v.penalty)}</span>
                  </span>
                  {v.waived ? <Badge tone="muted">معفى</Badge> : v.penalty.kind === "WARNING" ? <Badge tone="warn">إنذار</Badge> : v.amountMinor === null ? <Badge tone="danger">يجيز الفصل</Badge> : <Money minor={v.amountMinor} />}
                  {canEdit && (
                    <span className="flex gap-1">
                      <PostAction url="/api/payroll/entry" body={{ action: "waive", id: v.id, waived: !v.waived }} variant="quiet" done={v.waived ? "أُعيد الجزاء" : "عُفي عنه"}>{v.waived ? "أعد الجزاء" : "اعفُ عنه"}</PostAction>
                      {v.source === "MANUAL" && <PostAction url="/api/payroll/entry" body={{ action: "violation-void", id: v.id }} variant="quiet" done="سُحبت">اسحب</PostAction>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            النظام يشترط قبل توقيع الجزاء أن يُبلَّغ العامل كتابةً بما نُسب إليه ويُسمع دفاعه، وأن يُبلَّغ بالجزاء كتابةً. قسيمة الراتب تذكر كل جزاء ببنده ومرته.
          </p>
          {canEdit && (
            <details className="mt-3 rounded-xl border border-line bg-raised">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold">سجّل مخالفة أخرى من اللائحة</summary>
              <div className="border-t border-line p-4"><ViolationForm employeeId={id} defaultDay={defaultDay} /></div>
            </details>
          )}
        </Section>
      )}

      <Section id="transfers" title="الحوالات له" icon={Link2} count={row?.links.length ?? 0} hint="ما وُزّع له عن هذا الشهر، بغرضه. ما حُوّل ليسدد فاتورة أو كمصروف لا يُحسب من راتبه.">
        {row && row.links.length > 0 ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
            {row.links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 basis-48 text-sm">{PURPOSE_LABEL[l.purpose]}<span className="block text-[11px] text-muted">{l.viaOwner ? "من تحويلك لحسابك" : `حوالة إلى ${l.txPayee ?? "حساب غير معروف"}`} {formatDay(l.txDay)}{l.note ? ` · ${l.note}` : ""}</span></span>
                <Money minor={l.amountMinor} />
                {canEdit && <PostAction url="/api/payroll/link" body={{ action: "unlink", id: l.id }} variant="quiet" done="فُكّ الربط">فكّ</PostAction>}
              </li>
            ))}
          </ul>
        ) : <EmptyState compact icon={Link2} title="لم يُوزَّع له شيء عن هذا الشهر." />}
        {canEdit && mine.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-bold text-ink-soft">حوالات يمكن توزيعها له</p>
            {mine.map((o) => (
              <details key={o.id} className="rounded-xl border border-line bg-raised shadow-raised">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">{o.viaOwner ? "تحويل لحسابك" : o.payeeName} · {formatDay(o.day)}</span>
                  <span>باقٍ <Money minor={o.freeMinor} /></span>
                </summary>
                <div className="border-t border-line p-4">
                  <LinkTransferForm tx={{ id: o.id, freeMinor: o.freeMinor, freeText: formatRiyalsDisplay(o.freeMinor), viaOwner: o.viaOwner }} employees={[{ id, name: employee.name }]}
                    defaults={{ employeeId: id, month: o.suggestion?.month ?? (o.viaOwner ? month : suggestedPayMonth(o.day)), purpose: "SALARY" }} />
                </div>
              </details>
            ))}
          </div>
        )}
      </Section>

      {(loanLinks.length > 0 || (row?.loanMinor ?? 0) > 0 || otherLinks.length > 0) && (
        <Section title="سلف ومبالغ أخرى" icon={HandCoins} hint="السلف التي تُسدَّد أقساطاً، وما حوّلته له لغير الراتب (سداد فواتير، مصروفات، شخصي) — في كل الأشهر.">
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
            {[...loanLinks, ...otherLinks].map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">{PURPOSE_LABEL[l.purpose]} · {formatDay(l.txDay)}{l.note && <span className="block text-[11px] text-muted">{l.note}</span>}</span>
                <Money minor={l.amountMinor} />
              </li>
            ))}
            <li className="flex items-center justify-between px-4 py-2.5 text-sm font-bold"><span>رصيد السلف الآن</span><Money minor={row?.loanMinor ?? 0} /></li>
          </ul>
        </Section>
      )}

      <Section id="salary" title="الراتب" icon={Wallet} count={employee.rates.length} hint={employee.kind === "MONTHLY" ? "كل تغيير يسري من شهره حتى التغيير التالي: مثلاً من مايو 3000، ومن سبتمبر 3500." : "أجر الساعة، يسري من شهره."}>
        {employee.rates.length > 0 && (
          <ul className="mb-3 divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
            {[...employee.rates].reverse().map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">من {formatMonth(r.fromMonth)}</span>
                <Money minor={r.amountMinor} currency />
                {canEdit && <PostAction url="/api/payroll/employee" body={{ action: "rate-remove", rateId: r.id }} variant="quiet" done="حُذف">احذف</PostAction>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && <RateForm employeeId={id} kind={employee.kind} month={month} />}
      </Section>

      <Section id="checkin" title="رابط الحضور" icon={CalendarClock} hint="رابط خاص به يفتحه من جواله عند وصوله وانصرافه. يُقرأ موقعه ليُعرف أنه في المقهى، ويُحسب التأخير وحده من بداية دوامه.">
        <p className="mb-3 text-xs text-ink-soft">
          {employee.shiftStart ? <>دوامه يبدأ <span className="nums font-bold" dir="ltr">{employee.shiftStart}</span> لمدة {formatMinutes(employee.shiftMinutes)} ساعة</> : "لم تُحدَّد بداية دوامه، فلا يُحسب التأخير من الحضور. حدّدها من «تعديل البيانات»."}
          {employee.daysOff && <> · راحته {employee.daysOff.split("").map((d) => WEEKDAY_LABEL[Number(d)]).join(" و")}</>}
        </p>
        {canEdit ? <CheckinLinkPanel employeeId={id} name={employee.name} phone={employee.phone} hasLink={employee.hasCheckinLink} /> : <Badge tone={employee.hasCheckinLink ? "ok" : "muted"}>{employee.hasCheckinLink ? "مفعّل" : "لا رابط"}</Badge>}
      </Section>

      <Section id="docs" title="الوثائق" icon={FileBadge} count={docs.length} hint="الإقامة والشهادة الصحية وغيرها، ويُذكّرك النظام قبل انتهائها." action={canEdit ? <ObligationForm preset={{ kind: "HEALTH_CERTIFICATE", holder: employee.name, employeeId: id }} /> : undefined}>
        {docs.length === 0 ? <EmptyState compact icon={FileBadge} title="لا وثائق مسجّلة له." /> : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
            {docs.map((d) => {
              const left = daysBetween(today, d.expiresOn);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">{d.title}<span className="block text-[11px] text-muted">{isObligationKind(d.kind) ? OBLIGATION_KIND_LABEL[d.kind] : d.kind}{d.reference ? ` · ${d.reference}` : ""}</span></span>
                  <span className="text-xs">تنتهي {formatDay(d.expiresOn)}</span>
                  {d.closedAt ? <Badge tone="muted">مؤرشفة</Badge> : left < 0 ? <Badge tone="danger">منتهية</Badge> : left <= d.remindDays ? <Badge tone="warn">باقي {left} يوم</Badge> : <Badge tone="ok">سارية</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {history.length > 0 && (
        <Section id="history" title="الأشهر" icon={History}>
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
            {history.map((h) => (
              <li key={h.month}>
                <Link href={`/payroll/employee/${id}?month=${h.month}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-hover">
                  <span className="min-w-0 flex-1 font-bold">{formatMonth(h.month)}</span>
                  <span className="text-xs text-muted">المستحق <MaybeMoney minor={h.slip.dueMinor} /></span>
                  <span className="text-xs text-muted">حُوّل <Money minor={h.slip.paidMinor} /></span>
                  {h.slip.remainingMinor === null ? <Badge tone="muted">غير معروف</Badge> : h.slip.remainingMinor > 0 ? <Badge tone="warn">باقٍ {formatRiyalsDisplay(h.slip.remainingMinor)}</Badge> : h.slip.remainingMinor < 0 ? <Badge tone="danger">زيادة {formatRiyalsDisplay(-h.slip.remainingMinor)}</Badge> : <Badge tone="ok">اكتمل</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {eos && (
        <Section title="مكافأة نهاية الخدمة (تقدير)" icon={HandCoins} hint="بنظام العمل: نصف راتب عن كل سنة من الخمس الأولى، وراتب كامل عن كل سنة بعدها. وفي الاستقالة: لا شيء قبل سنتين، وثلثها حتى خمس، وثلثاها حتى عشر. تقدير على آخر راتب، لا حكم نظامي.">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <Card><p className="text-xs text-muted">مدة الخدمة</p><p className="mt-1 text-lg font-bold">{serviceDays} يوماً</p></Card>
            <Card><p className="text-xs text-muted">إن انتهى العقد من جهتك</p><p className="mt-1 text-lg font-bold"><Money minor={eos.fullMinor} currency /></p></Card>
            <Card><p className="text-xs text-muted">إن استقال هو</p><p className="mt-1 text-lg font-bold"><Money minor={eos.resignationMinor} currency /></p></Card>
          </div>
        </Section>
      )}

      {canEdit && (
        <Section id="edit" title="تعديل البيانات" icon={Pencil} hint="الاسم والنوع ورقم المستفيد والدوام وأيام الراحة، ويوم الخروج إن ترك العمل.">
          <details className="rounded-xl border border-line bg-raised">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold">افتح البيانات</summary>
            <div className="border-t border-line p-3">
              <EmployeeForm initial={{
                id, name: employee.name, kind: employee.kind, jobTitle: employee.jobTitle ?? "", phone: employee.phone ?? "",
                nationalId: employee.nationalId ?? "", bankBeneficiaryId: employee.bankBeneficiaryId ?? "", iban: employee.iban ?? "",
                hiredOn: employee.hiredOn, leftOn: employee.leftOn ?? "", shiftStart: employee.shiftStart ?? "",
                shiftHours: formatMinutes(employee.shiftMinutes), lateGraceMinutes: String(employee.lateGraceMinutes), daysOff: employee.daysOff, note: employee.note ?? "",
              }} />
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[11px] text-muted">
                أضفته خطأً؟ <DeleteEmployeeButton employeeId={id} name={employee.name} />
              </div>
            </div>
          </details>
        </Section>
      )}
    </PageShell>
  );
}
