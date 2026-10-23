import type { Metadata } from "next";
import { BrandMark } from "@/components/icons";
import { CheckinPad } from "@/components/payroll/checkin-pad";
import { nextKind } from "@/lib/payroll/attendance";
import { recentCheckins, resolveCheckinToken } from "@/services/payroll.service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "الحضور · ذا بوبليك هاوس",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    appleWebApp: { capable: true, title: "الحضور", statusBarStyle: "default" },
  };
}

/**
 * صفحةُ حضور الموظّف — بلا دخول: الرابطُ الشخصيّ إذنُه، ولا يملك إلّا تسجيلَ حضور صاحبه
 * وانصرافه. لا يرى راتباً ولا خصماً.
 */
export default async function AttendPage({ params }: { params: Promise<{ token: string }> }) {
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
  const recent = await recentCheckins(employee.id, 6);
  const suggested = nextKind(recent[0] ?? null, new Date());
  return (
    <CheckinPad
      token={token}
      name={employee.name}
      shiftStart={employee.shiftStart}
      recent={recent.map((r) => ({ id: r.id, kind: r.kind, at: r.at.toISOString(), verdict: r.verdict }))}
      suggested={suggested}
    />
  );
}
