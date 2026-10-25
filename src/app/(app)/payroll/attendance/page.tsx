import { EMPLOYEE, countNoun } from "@/lib/arabic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Link2, MapPin, ShieldCheck, Users, Wifi } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { PostAction } from "@/components/post-action";
import { AttendancePlaceForm, CheckinLinkPanel } from "@/components/payroll/forms";
import { Badge, Callout, Card, DataTable, EmptyState, LinkTabs, NoAccess, Section, type Column } from "@/components/ui";
import { activeIn } from "@/lib/payroll/calc";
import { isWorkday, riyadhClock, trusted, VERDICT_LABEL, WEEKDAY_LABEL } from "@/lib/payroll/attendance";
import { addDays, formatDay, todayInRiyadh } from "@/lib/riyadh-time";
import {
  loadAttendanceSettings, loadCheckins, loadEmployees, loadPayrollMonth, loadUnreviewedCheckins, type CheckinView, type EmployeeView,
} from "@/services/payroll.service";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface BoardRow {
  employee: EmployeeView;
  ins: CheckinView[];
  outs: CheckinView[];
  status: { kind: "LATE" | "EARLY" | "ABSENT" | "LEAVE"; minutes: number | null; source: string }[];
  workday: boolean;
}

/**
 * الحضور — من حضر اليوم ومتى، ومن لم يسجّل، وما سُجّل من خارج المقهى. بلا بصمة ولا كاميرات:
 * الموظّفُ يسجّل من رابطه، والموقعُ والشبكةُ يشهدان، وصاحبُ المقهى يحكم فيما لا شاهدَ له.
 */
export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/payroll/attendance");
  if (!can(user.role, "payroll:view")) {
    return <PageShell user={user} title="الحضور"><NoAccess what="الحضور" /></PageShell>;
  }
  const canEdit = can(user.role, "payroll:edit");
  const q = await searchParams;
  const today = todayInRiyadh();
  const day = q.day && DAY_RE.test(q.day) && q.day <= today ? q.day : today;
  const month = day.slice(0, 7);

  const [list, settings, checkins, unreviewed, sheet] = await Promise.all([
    loadEmployees(),
    loadAttendanceSettings(),
    loadCheckins(day, day),
    loadUnreviewedCheckins(),
    loadPayrollMonth(month),
  ]);
  const working = list.filter((e) => activeIn(e, month) && e.hiredOn <= day && (!e.leftOn || e.leftOn >= day));
  const names = new Map(list.map((e) => [e.id, e.name]));
  const board: BoardRow[] = working.map((employee) => {
    const mine = checkins.filter((c) => c.employeeId === employee.id && c.review !== "REJECTED");
    const row = sheet.rows.find((r) => r.employee.id === employee.id);
    return {
      employee,
      ins: mine.filter((c) => c.kind === "IN"),
      outs: mine.filter((c) => c.kind === "OUT"),
      status: (row?.attendance ?? []).filter((a) => a.day === day).map((a) => ({ kind: a.kind, minutes: a.minutes, source: a.source })),
      /* الجزئيُّ بلا جدولٍ ثابت: غيابُه عن يومٍ ليس غياباً */
      workday: employee.kind === "MONTHLY" && isWorkday(day, employee.daysOff),
    };
  });
  /* اليومَ لا يُعدّ غائباً من لم يبدأ دوامُه بعد */
  const clock = day === today ? riyadhClock(new Date()) : "24:00";
  const started = (b: BoardRow) => !b.employee.shiftStart || b.employee.shiftStart <= clock;
  /* «لم يسجّل» لمن معه رابطُ حضور — ومن لا رابطَ له لم يُطلب منه التسجيل، فغيابُ تسجيله ليس غياباً */
  const missing = board.filter((b) => b.workday && started(b) && b.employee.hasCheckinLink && b.ins.length === 0 && !b.status.some((s) => s.kind === "ABSENT" || s.kind === "LEAVE"));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));

  const columns: Column<BoardRow>[] = [
    { key: "name", header: "الموظف", primary: true, cell: (b) => <span><span className="font-bold">{b.employee.name}</span><span className="block text-[11px] text-muted">{b.employee.kind === "PART_TIME" ? "جزئي" : b.employee.shiftStart ? <>يبدأ <span className="nums" dir="ltr">{b.employee.shiftStart}</span></> : "بلا وقت دوام"}{!b.workday && b.employee.kind === "MONTHLY" && " · يوم راحته"}</span></span> },
    {
      key: "in", header: "الحضور",
      cell: (b) => b.ins.length === 0 ? <span className="text-muted">—</span> : (
        <span className="flex flex-wrap gap-1">{b.ins.map((c) => <Badge key={c.id} tone={trusted(c.verdict) || c.review === "ACCEPTED" ? "ok" : "warn"}><span className="nums" dir="ltr">{riyadhClock(c.at)}</span> · {VERDICT_LABEL[c.verdict]}</Badge>)}</span>
      ),
    },
    {
      key: "out", header: "الانصراف",
      cell: (b) => b.outs.length === 0 ? <span className="text-muted">—</span> : (
        <span className="flex flex-wrap gap-1">{b.outs.map((c) => <Badge key={c.id} tone={trusted(c.verdict) || c.review === "ACCEPTED" ? "ok" : "warn"}><span className="nums" dir="ltr">{riyadhClock(c.at)}</span></Badge>)}</span>
      ),
    },
    {
      key: "status", header: "الحال",
      cell: (b) => b.status.length === 0 ? (b.workday && b.ins.length === 0
        ? (!b.employee.hasCheckinLink ? <Badge tone="muted">بلا رابط حضور</Badge> : started(b) ? <Badge tone="warn">لم يسجّل</Badge> : <Badge tone="muted">لم يبدأ دوامه</Badge>)
        : <span className="text-muted">—</span>) : (
        <span className="flex flex-wrap gap-1">{b.status.map((s, i) => (
          <Badge key={i} tone={s.kind === "LEAVE" ? "muted" : "danger"}>
            {s.kind === "LATE" ? `تأخر ${s.minutes} د` : s.kind === "EARLY" ? `خرج مبكراً ${s.minutes} د` : s.kind === "ABSENT" ? "غائب" : "إجازة"}
          </Badge>
        ))}</span>
      ),
    },
    ...(canEdit ? [{
      key: "act", header: "", wrap: true,
      cell: (b: BoardRow) => b.ins.length > 0 || !b.workday || b.status.some((s) => s.kind === "ABSENT" || s.kind === "LEAVE") ? null : (
        <span className="flex flex-wrap gap-1">
          <PostAction url="/api/payroll/entry" body={{ action: "day", employeeId: b.employee.id, day, kind: "ABSENT" }} variant="quiet" done="سُجّل غائباً">غائب</PostAction>
          <PostAction url="/api/payroll/entry" body={{ action: "day", employeeId: b.employee.id, day, kind: "LEAVE" }} variant="quiet" done="سُجّلت إجازة">إجازة</PostAction>
        </span>
      ),
    } satisfies Column<BoardRow>] : []),
  ];

  const monthRows = sheet.rows.filter((r) => r.employee.kind === "MONTHLY");

  return (
    <PageShell user={user} title="الحضور" intro="يسجّل كل موظف حضوره وانصرافه من رابطه على جواله. يُتحقق من موقعه عند المقهى أو من شبكته، ويُحسب التأخير وحده.">
      {!settings.place && !settings.networkIp && (
        <Callout tone="warn" icon={MapPin} title="لم يُضبط موقع المقهى ولا شبكته بعد">
          بدونهما تُسجَّل كل الحضورات «بعيدة عن المقهى» وتنتظر مراجعتك. اضبطهما من الأسفل وأنت في المقهى.
        </Callout>
      )}

      <div className="mt-4">
        <LinkTabs label="اليوم" items={days.map((d) => ({ href: `/payroll/attendance?day=${d}`, label: d === today ? "اليوم" : `${WEEKDAY_LABEL[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8))}`, active: d === day }))} />
        <form method="get" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <label htmlFor="att-day">يوم آخر</label>
          <input id="att-day" type="date" name="day" dir="ltr" max={today} defaultValue={day} className="min-h-11 sm:min-h-10 rounded-lg border border-line-input bg-raised px-2" />
          <button type="submit" className="min-h-11 sm:min-h-10 rounded-lg border border-line px-3 font-bold hover:bg-hover">اعرض</button>
        </form>
      </div>

      <Section title={day === today ? "اليوم" : formatDay(day)} icon={CalendarDays} count={board.length} hint={missing.length > 0 ? `${countNoun(missing.length, EMPLOYEE)} ${missing.length === 1 ? "لم يسجّل" : missing.length === 2 ? "لم يسجّلا" : "لم يسجّلوا"} حضوراً في يوم عملهم. إن غاب أحدهم فاضغط «غائب» ليُخصم يومه، أو «إجازة» فلا يُخصم.` : undefined}>
        {board.length === 0 ? <EmptyState icon={Users} title="لا موظفين يعملون في هذا اليوم." /> : <DataTable columns={columns} rows={board} keyOf={(b) => b.employee.id} hrefOf={(b) => `/payroll/employee/${b.employee.id}?month=${month}`} />}
      </Section>

      <Section id="review" title="تسجيلات تحتاج حكمك" icon={ShieldCheck} count={unreviewed.length} hint="سُجّلت والجوال بعيد عن المقهى، أو بلا موقع، ولم يكن على شبكة المقهى. اقبلها إن كان في المقهى فعلاً، أو ردّها فلا تُحسب ويسقط ما حُسب منها. وإن سجّل وهو خارج المقهى عمداً فهي مخالفة «التلاعب في إثبات الحضور» (البند 2/7).">
        {unreviewed.length === 0 ? <EmptyState compact icon={ShieldCheck} title="لا شيء ينتظر." /> : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
            {unreviewed.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 basis-56">
                  <strong>{names.get(c.employeeId) ?? "موظف"}</strong> · {c.kind === "IN" ? "حضور" : "انصراف"} {formatDay(c.day)} <span className="nums" dir="ltr">{riyadhClock(c.at)}</span>
                  <span className="block text-[11px] text-muted">{VERDICT_LABEL[c.verdict]}{c.distanceM !== null && ` · على بعد ${c.distanceM >= 1000 ? `${Math.round(c.distanceM / 100) / 10} كم` : `${c.distanceM} م`}`}{c.accuracyM !== null && ` · دقة القراءة ${c.accuracyM} م`}</span>
                </span>
                {canEdit && (
                  <span className="flex flex-wrap gap-1">
                    <PostAction url="/api/payroll/attendance" body={{ action: "review", id: c.id, decision: "ACCEPTED" }} variant="secondary" done="قُبل">اقبل</PostAction>
                    <PostAction url="/api/payroll/attendance" body={{ action: "review", id: c.id, decision: "REJECTED" }} variant="danger" done="رُدّ">ردّ</PostAction>
                    <PostAction url="/api/payroll/attendance" body={{ action: "review", id: c.id, decision: "REJECTED", manipulation: true }} variant="quiet" done="رُدّ وسُجّلت المخالفة">ردّ وسجّل تلاعباً</PostAction>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {monthRows.length > 0 && (
        <Section title="الشهر حتى الآن" icon={CalendarDays} hint="ما يتراكم على كل موظف ويُخصم في المسيّر.">
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
            {monthRows.map((r) => (
              <li key={r.employee.id}>
                <Link href={`/payroll/employee/${r.employee.id}?month=${month}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-hover">
                  <span className="min-w-0 flex-1 font-bold">{r.employee.name}</span>
                  <span className="text-xs text-ink-soft">تأخير <span className="nums">{r.slip.lateMinutes + r.slip.earlyMinutes}</span> د · غياب <span className="nums">{r.slip.absentDays}</span> · إجازة <span className="nums">{r.slip.leaveDays}</span>{r.slip.warnings > 0 && <> · <span className="nums">{r.slip.warnings}</span> إنذار</>}{r.slip.penaltiesMinor > 0 && <> · جزاءات <Money minor={r.slip.penaltiesMinor} /></>}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="روابط الموظفين" icon={Link2} hint="لكل موظف رابط خاص. أرسله له مرة واحدة، ويحفظه على شاشة جواله. إن ضاع جواله فأنشئ رابطاً جديداً فيبطل القديم.">
        {working.length === 0 ? <EmptyState compact icon={Users} title="أضف الموظفين أولاً." /> : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
            {working.map((e) => (
              <Card key={e.id}>
                <p className="mb-2 flex items-center justify-between gap-2 text-sm font-bold">{e.name}{e.hasCheckinLink ? <Badge tone="ok">مفعّل</Badge> : <Badge tone="muted">لا رابط</Badge>}</p>
                {canEdit ? <CheckinLinkPanel employeeId={e.id} name={e.name} phone={e.phone} hasLink={e.hasCheckinLink} /> : null}
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="كيف يُعرف أنه في المقهى" icon={MapPin} hint="شاهدان، ويكفي أحدهما: موقع الجوال داخل دائرة حول المقهى، أو اتصاله بشبكة واي فاي المقهى. ما لا شاهد له يُسجَّل ويُعرض عليك.">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-bold"><MapPin className="h-4 w-4 text-muted" aria-hidden />موقع المقهى</h3>
            <p className="mb-3 text-xs text-muted">{settings.place ? `محفوظ، بنصف قطر ${settings.place.radiusM} متر.` : "غير محفوظ."}</p>
            {canEdit && (
              <>
                <AttendancePlaceForm current={settings.place ? { lat: (settings.place.latMicro / 1_000_000).toFixed(6), lng: (settings.place.lngMicro / 1_000_000).toFixed(6), radiusM: settings.place.radiusM } : null} />
                {settings.place && <div className="mt-2"><PostAction url="/api/payroll/attendance" body={{ action: "place-clear" }} variant="quiet" done="أُزيل">أزل الموقع</PostAction></div>}
              </>
            )}
          </Card>
          <Card>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-bold"><Wifi className="h-4 w-4 text-muted" aria-hidden />شبكة المقهى</h3>
            <p className="mb-3 text-xs leading-relaxed text-muted">
              {settings.networkIp ? <>محفوظة (<span className="nums" dir="ltr">{settings.networkIp}</span>). من يسجّل وهو على واي فاي المقهى يُعدّ في المقهى ولو ضعف موقعه.</> : "غير محفوظة. افتح هذه الصفحة من جوالك وهو متصل بواي فاي المقهى، واضغط الزر."}
            </p>
            {canEdit && (
              <span className="flex flex-wrap gap-2">
                <PostAction url="/api/payroll/attendance" body={{ action: "network" }} variant="secondary" done="حُفظت الشبكة">احفظ الشبكة التي أنا عليها الآن</PostAction>
                {settings.networkIp && <PostAction url="/api/payroll/attendance" body={{ action: "network-clear" }} variant="quiet" done="أُزيلت">أزلها</PostAction>}
              </span>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted">إن تغيّر عنوان الإنترنت عند شركة الاتصالات (يحدث أحياناً بعد إعادة تشغيل الراوتر) فاحفظها من جديد. الموقع يبقى الشاهد الأساسي.</p>
          </Card>
        </div>
      </Section>
    </PageShell>
  );
}
