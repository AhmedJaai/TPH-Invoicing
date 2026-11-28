import Link from "next/link";
import { DownloadButton } from "@/components/download-button";
import { deductionPeriod, PAYDAY } from "@/lib/payroll/period";
import { redirect } from "next/navigation";
import { ArrowLeftRight, CircleCheck, Info, Link2, ReceiptText, UserPlus, Users } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MonthTabs } from "@/components/finance-bits";
import { PayPeople, STATUS_UI, statusCounts } from "@/components/payroll/pay-people";
import { daysToPayday, PAY_STATUS_ORDER } from "@/lib/payroll/pay-status";
import { PostAction } from "@/components/post-action";
import { LinkSuggestedButton, LinkTransferForm, NotPayrollButton, type OwedByMonth } from "@/components/payroll/forms";
import { Badge, Callout, EmptyState, LinkButton, Meter, NoAccess, Section } from "@/components/ui";
import { monthsBetween } from "@/lib/finance/pnl";
import { formatRiyalsDisplay } from "@/lib/money";
import { countNoun, countNounGen, DAY, EMPLOYEE, TRANSFER } from "@/lib/arabic";
import { payrollTotals, PURPOSE_LABEL, suggestedPayMonth } from "@/lib/payroll/calc";
import { currentMonthRiyadh, formatDay, formatMonth, todayInRiyadh } from "@/lib/riyadh-time";
import { loadStartState } from "@/services/start.service";
import { loadBankPayees, loadEmployees, loadPayrollMonth, loadPayrollMonths, loadOpenTransfers, transfersSince, type TransferView } from "@/services/payroll.service";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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
  /*
    بلا اختيار: في الأيّام العشرة الأولى يُحوَّل راتبُ الشهر الماضي (`suggestedPayMonth`) — فإن بقي فيه
    شيءٌ فُتح هو. كانت تفتح في ٣ ديسمبر على ديسمبر كلِّه «باقياً» وحوالاتُ نوفمبر خلف لسانٍ آخر.
  */
  const chosen = q.month && MONTH_RE.test(q.month) ? q.month : null;
  const payMonth = suggestedPayMonth(todayInRiyadh());
  const month = chosen
    ?? (payMonth !== current && payrollTotals((await loadPayrollMonth(payMonth)).rows.map((r) => r.slip)).remainingMinor > 0 ? payMonth : current);

  const [sheet, open, payees, staff, start] = await Promise.all([
    loadPayrollMonth(month),
    loadOpenTransfers(transfersSince(month)),
    loadBankPayees(),
    loadEmployees(),
    loadStartState(),
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

  /* تأخيرٌ يُخصم في فترة الشهر، وما أُعفي منه جماعيّاً (120) */
  const latesOpen = sheet.rows.reduce((n, r) => n + r.attendance.filter((a) => a.kind === "LATE" && !a.waivedAt && (a.minutes ?? 0) > r.employee.lateGraceMinutes).length, 0);
  const latesWaived = sheet.rows.reduce((n, r) => n + r.attendance.filter((a) => a.kind === "LATE" && a.waivedAt).length, 0);

  const counts = statusCounts(sheet.rows);
  const owedCount = counts.NONE + counts.PARTIAL;
  const toPayday = daysToPayday(month, todayInRiyadh(), PAYDAY);
  const paydayText = toPayday === null ? null : toPayday === 0 ? "يُصرف الراتب اليوم" : toPayday === 1 ? "يُصرف الراتب غداً" : `يُصرف الراتب بعد ${countNoun(toPayday, DAY)}`;

  return (
    <PageShell
      user={user}
      title="مسيّر الرواتب"
      intro={`كم يستحق كل موظف عن ${formatMonth(month)} بعد الخصومات والسلف، وكم حوّلت له، وكم بقي. الراتب يُصرف يوم ${PAYDAY}، والخصومات عمّا وقع من ${formatDay(deductionPeriod(month).from)} إلى ${formatDay(deductionPeriod(month).to)}.`}
      actions={
        <>
          {canEdit && latesOpen > 0 && (
            <PostAction url="/api/payroll/entry" body={{ action: "lates-waive", month }} variant="secondary" done="أُعفي الجميع"
              undo={{ body: { action: "lates-unwaive", month } }}>
              اعفُ الجميع من تأخيرات الشهر ({latesOpen})
            </PostAction>
          )}
          {canEdit && latesWaived > 0 && latesOpen === 0 && (
            <PostAction url="/api/payroll/entry" body={{ action: "lates-unwaive", month }} variant="quiet" done="سُحب الإعفاء">
              اسحب الإعفاء عن التأخيرات ({latesWaived})
            </PostAction>
          )}
          <DownloadButton href={`/api/payroll/export?month=${month}`} fallbackName={`payroll-${month}.csv`} variant="quiet" size="sm">تنزيل المسيّر</DownloadButton>
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
          {/* ── الجواب: كم بقي ولمن، ومتى يُصرف ── */}
          <section aria-label={`حال رواتب ${formatMonth(month)}`} className={`mt-5 overflow-hidden rounded-2xl border shadow-raised ${owedCount === 0 && counts.UNKNOWN === 0 ? "border-ok/25 bg-ok-bg" : "border-line bg-raised"}`}>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-4 p-5 sm:p-6">
              <div className="min-w-0 flex-1 basis-72">
                <p className="text-xs font-bold text-muted">
                  رواتب {formatMonth(month)}{paydayText && <> · <span className="text-ink-soft">{paydayText} ({formatDay(`${month}-${PAYDAY}`)})</span></>}
                </p>
                {totals.remainingMinor > 0 ? (
                  <>
                    <p className="mt-1.5 text-[clamp(1.5rem,6vw,2.25rem)] font-bold leading-tight tracking-tight">
                      باقٍ عليك <Money minor={totals.remainingMinor} tone="warn" currency />
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">لـ{countNoun(owedCount, EMPLOYEE)}{counts.UNKNOWN > 0 && <>، و<a href="#pay-unknown" className="font-bold text-danger underline-offset-2 hover:underline">{countNoun(counts.UNKNOWN, EMPLOYEE)} مستحقهم غير معروف</a> فالمبلغ ناقص</>}.</p>
                  </>
                ) : counts.UNKNOWN > 0 ? (
                  <p className="mt-1.5 text-2xl font-bold leading-tight text-danger">
                    <a href="#pay-unknown" className="hover:underline">{countNoun(counts.UNKNOWN, EMPLOYEE)} مستحقهم غير معروف</a>
                  </p>
                ) : (
                  <p className="mt-1.5 flex items-center gap-2 text-2xl font-bold leading-tight text-ok">
                    <CircleCheck className="h-7 w-7" strokeWidth={2} aria-hidden /> وصل كل موظف مستحقه
                  </p>
                )}
                {/* الحالُ بعددها — كلُّ واحدةٍ تنزل إلى مجموعتها */}
                <ul className="mt-4 flex flex-wrap gap-2">
                  {PAY_STATUS_ORDER.filter((st) => counts[st] > 0).map((st) => (
                    <li key={st}>
                      <a href={`#pay-${st.toLowerCase()}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-raised px-3 text-xs font-bold text-ink-soft transition-colors hover:border-accent-line hover:text-ink sm:min-h-9">
                        {(() => { const I = STATUS_UI[st].icon; return <I className={`h-3.5 w-3.5 ${st === "DONE" ? "text-ok" : st === "UNKNOWN" || st === "OVER" ? "text-danger" : "text-warn"}`} strokeWidth={2} aria-hidden />; })()}
                        {STATUS_UI[st].title}
                        <span className="nums nums-count text-muted">{counts[st]}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <dl className="grid w-full grid-cols-3 gap-3 text-xs sm:w-auto sm:min-w-80">
                <div>
                  <dt className="text-muted">المستحق</dt>
                  <dd className="mt-1 text-[15px] font-bold"><Money minor={totals.dueMinor} /></dd>
                </div>
                <div>
                  <dt className="text-muted">حُوّل</dt>
                  <dd className="mt-1 text-[15px] font-bold"><Money minor={totals.paidMinor} /></dd>
                </div>
                <div>
                  <dt className="text-muted">الباقي</dt>
                  <dd className="mt-1 text-[15px] font-bold"><Money minor={totals.remainingMinor} tone={totals.remainingMinor > 0 ? "warn" : "ok"} /></dd>
                </div>
                {totals.dueMinor > 0 && (
                  <div className="col-span-3">
                    <Meter value={Math.min(totals.paidMinor, totals.dueMinor)} max={totals.dueMinor} tone={settled === sheet.rows.length ? "ok" : "accent"} label="ما حُوّل مما يستحقه الموظفون" />
                    <p className="mt-1.5 text-[11px] text-muted">
                      اكتمل <span className="nums nums-count">{settled}</span> من {countNounGen(sheet.rows.length, EMPLOYEE)}
                      {totals.overpaidMinor > 0 && <> · حُوّل زيادةً <Money minor={totals.overpaidMinor} /></>}
                    </p>
                  </div>
                )}
              </dl>
            </div>
            {/* «٠٫٠٠ حُوّل» فوق حوالاتٍ لم توزَّع يُقرأ «لم أحوّل شيئاً» — فيُقال ما ينتظر التوزيع بجانب الرقم ويُفتح */}
            {salaryOpen.length > 0 && (
              <a href="#transfers" className="flex min-h-11 items-center gap-2 border-t border-warn/25 bg-warn-bg px-5 py-2.5 text-xs font-bold text-warn hover:underline sm:px-6">
                <ArrowLeftRight className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                {countNoun(salaryOpen.length, TRANSFER)} رواتب في الكشف لم توزَّع بعد، فما «حُوّل» هنا ما وُزّع منها فقط. وزّعها الآن
              </a>
            )}
          </section>

          <Section title="الموظفون هذا الشهر" icon={ReceiptText} count={sheet.rows.length} hint="افتح أي موظف لترى قسيمته، أو لتضيف خصماً أو سلفة أو مخالفة أو تأخيراً." className="mt-8">
            <PayPeople rows={sheet.rows} month={month} monthLabel={formatMonth(month)} />
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
          start.has.bank
            ? <EmptyState compact icon={Link2} title="كل حوالات الرواتب موزّعة." hint="حين تصل حوالة رواتب جديدة في الكشف تظهر هنا." />
            /* «كلُّها موزّعة» عن كشفٍ لم يُستورد صدقٌ على المجموعة الفارغة */
            : <EmptyState compact icon={Link2} title="لم يُستورد كشف بنك بعد." hint="منه تُقرأ حوالات الرواتب لتوزَّع على أصحابها." action={<LinkButton href="/bank#import" size="sm">استورد الكشف</LinkButton>} />
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
          <EmptyState icon={Link2} title="لم توزَّع حوالات على هذا الشهر بعد." hint="وزّعها من «لم توزَّع» أعلاه، أو اختر شهراً آخر." />
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
