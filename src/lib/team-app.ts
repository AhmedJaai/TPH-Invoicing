/**
 * «TPH Team» — تطبيقُ الموظّف: رابطٌ شخصيّ واحد (`/a/<رمز>`) فيه ثلاثُ صفحات — الحضور،
 * وتصويرُ الفواتير، ورسائلُه للإدارة. يُثبَّت على شاشة الجوال باسمه هذا (`manifest.webmanifest`).
 */

export const TEAM_APP_NAME = "TPH Team";

export type TeamTab = "attend" | "invoices" | "message";

export const TEAM_TABS: readonly { id: TeamTab; label: string }[] = [
  { id: "attend", label: "الحضور" },
  { id: "invoices", label: "الفواتير" },
  { id: "message", label: "رسالة للإدارة" },
];

export function asTeamTab(v: unknown): TeamTab {
  return v === "invoices" || v === "message" ? v : "attend";
}

/** مسارُ التطبيق لرمز — هو `start_url` و`scope` في بيان تثبيته. */
export function teamAppPath(token: string): string {
  return `/a/${encodeURIComponent(token)}`;
}

/** رسالةُ إرسال الرابط للموظّف — ما فيه، وكيف يثبّته على شاشته. */
export function teamInvite(name: string, url: string): string {
  return [
    `أهلاً ${name}، هذا رابط تطبيق ${TEAM_APP_NAME} الخاص بك في ذا بوبليك هاوس.`,
    "منه تسجّل حضورك وانصرافك، وتصوّر الفواتير حين تستلمها، وترسل اقتراحاتك أو شكواك للإدارة.",
    "افتحه من سفاري، ثم اضغط زر المشاركة واختر «إضافة إلى الشاشة الرئيسية». ولا يحتاج تسجيل دخول.",
    "واسمح له بقراءة الموقع عند تسجيل الحضور.",
    url,
  ].join("\n");
}
