import type { Metadata, Viewport } from "next";
import { BrandMark } from "@/components/icons";
import { TeamApp } from "@/components/team/team-app";
import { dayShiftRange, daysOffLabel, shiftOn } from "@/lib/payroll/attendance";
import { asTeamTab, TEAM_APP_NAME, teamAppPath } from "@/lib/team-app";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { recentForEmployee } from "@/services/capture.service";
import { loadEmployees, myPeriod, mySlip, recentCheckins, resolveCheckinToken, weekAhead } from "@/services/payroll.service";
import { myMessages } from "@/services/team.service";
import { loadBoard, myRequests } from "@/services/team-board.service";
import { loadStockOptions } from "@/services/team-stock.service";
import { hasTeamSubscription, invoiceInbox } from "@/services/team-invoices.service";
import { loadTeamCount } from "@/services/team-count.service";
import { activeIn } from "@/lib/payroll/calc";
import { formatQuantity } from "@/lib/team-units";

export const dynamic = "force-dynamic";

/*
  بيانُ تثبيتٍ لكلّ رابطٍ برمزه — بلاه ترث الصفحةُ بيانَ التطبيق العامّ فتفتح الأيقونةُ المثبَّتة
  صفحةَ الدخول بجوجل. واسمُه على الشاشة «TPH Team». ولا يُفهرَس — الرابطُ إذن.
*/
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: TEAM_APP_NAME,
    applicationName: TEAM_APP_NAME,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    manifest: `${teamAppPath(token)}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: TEAM_APP_NAME, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0d0b" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * «TPH Team» — تطبيقُ الموظّف بلا دخول: الرابطُ الشخصيّ إذنُه، ولا يملك إلّا تسجيلَ حضور صاحبه
 * وانصرافه، ووضعَ صورة فاتورةٍ في الانتظار، وإرسالَ رسالةٍ للإدارة. لا يرى راتباً ولا خصماً بمال.
 */
export default async function TeamPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { token } = await params;
  const employee = await resolveCheckinToken(token);
  if (!employee) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6 text-center">
        <BrandMark className="h-10 w-auto text-accent" />
        <h1 className="mt-6 text-xl font-bold">هذا الرابط لم يعد يعمل</h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">ربما أُلغي أو نُسخ ناقصاً. اطلب من المدير رابطاً جديداً.</p>
      </main>
    );
  }
  const today = todayInRiyadh();
  /* دوامُ اليوم نفسه — يومُ الأسبوع أو اليومُ بعينه يغلب المعتاد */
  const todayShift = shiftOn(today, employee, employee.shiftRules);
  const counted = employee.kind === "MONTHLY" && employee.shiftStart !== null;
  const [recent, captures, messages, period, { tab }, board, requests, everyone, stock, slip, count] = await Promise.all([
    recentCheckins(employee.id, 6),
    recentForEmployee(employee.id),
    myMessages(employee.id),
    counted ? myPeriod(employee, today) : Promise.resolve(null),
    searchParams,
    loadBoard(),
    myRequests(employee.id),
    loadEmployees(),
    loadStockOptions(),
    mySlip(employee.id),
    employee.canCountInventory ? loadTeamCount(today) : Promise.resolve(null),
  ]);
  const mates = everyone.filter((e) => e.id !== employee.id && activeIn(e, today.slice(0, 7)) && (!e.leftOn || e.leftOn >= today)).map((e) => ({ id: e.id, name: e.name, daysOff: e.daysOff }));
  const [inbox, pushOn] = employee.invoicesSince ? await Promise.all([invoiceInbox(employee.invoicesSince, today), hasTeamSubscription(employee.id)]) : [null, false];
  return (
    <TeamApp
      token={token}
      name={employee.name}
      initialTab={asTeamTab(tab, employee.canCountInventory)}
      attend={{
        recent: recent.map((r) => ({ id: r.id, kind: r.kind, at: r.at.toISOString(), day: r.day, verdict: r.verdict })),
        today,
        shiftRange: dayShiftRange(todayShift),
        shiftStart: todayShift.off ? null : todayShift.start,
        dayOff: employee.kind === "MONTHLY" && todayShift.off,
        daysOffLabel: daysOffLabel(employee.daysOff),
        period,
        week: employee.kind === "MONTHLY" ? weekAhead(employee, today).map((d) => ({ day: d.day, range: d.shift.off ? null : dayShiftRange(d.shift), off: d.shift.off })) : [],
        slip,
      }}
      board={board.map((c) => ({ id: c.id, kind: c.kind, title: c.title, body: c.body, weekday: c.weekday }))}
      pendingBoardIds={requests.filter((r) => r.kind === "BOARD_EDIT" && r.status === "PENDING" && r.boardId).map((r) => r.boardId!)}
      todayWeekday={new Date(`${today}T00:00:00Z`).getUTCDay()}
      requests={requests.map((r) => ({
        id: r.id, kind: r.kind, status: r.status, boardTitle: r.boardTitle, fromDay: r.fromDay, toDay: r.toDay, withEmployeeName: r.withEmployeeName,
        productName: r.productName, quantity: r.quantityMilli !== null && r.unit ? formatQuantity(r.quantityMilli, r.unit) : null,
        decisionNote: r.decisionNote, createdAt: r.createdAt.toISOString(), permanent: r.permanent,
      }))}
      inbox={inbox ? inbox.map((i) => ({
        id: i.id, sender: i.sender, createdAt: i.createdAt.toISOString(), note: i.note, isPdf: i.mimeType === "application/pdf", viewable: i.viewable,
        read: i.read, enteredAt: i.enteredAt?.toISOString() ?? null, enteredBy: i.enteredBy,
      })) : null}
      pushOn={pushOn}
      mates={mates}
      myDaysOff={employee.daysOff}
      stock={stock}
      count={count}
      captures={captures.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
      messages={messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString(), repliedAt: m.repliedAt?.toISOString() ?? null }))}
    />
  );
}
