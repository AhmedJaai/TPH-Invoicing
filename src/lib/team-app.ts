/**
 * «TPH Team» — تطبيقُ الموظّف: رابطٌ شخصيّ واحد (`/a/<رمز>`) فيه ثلاثُ صفحات — الحضور،
 * وتصويرُ الفواتير، ورسائلُه للإدارة. يُثبَّت على شاشة الجوال باسمه هذا (`manifest.webmanifest`).
 */

export const TEAM_APP_NAME = "TPH Team";

export type TeamTab = "attend" | "board" | "count" | "invoices" | "requests";

export const TEAM_TABS: readonly { id: TeamTab; label: string }[] = [
  { id: "attend", label: "الحضور" },
  { id: "board", label: "المرجع" },
  /* لمن أذن له المالك وحده (`employees.can_count_inventory`) */
  { id: "count", label: "الجرد" },
  { id: "invoices", label: "الفواتير" },
  { id: "requests", label: "طلباتي" },
];

/** و«message» اسمُها القديم — رابطٌ محفوظ يفتح «طلباتي». و«الجرد» لا يُفتح لمن لا إذنَ له. */
export function asTeamTab(v: unknown, canCount = false): TeamTab {
  if (v === "message") return "requests";
  if (v === "count") return canCount ? "count" : "attend";
  return v === "invoices" || v === "board" || v === "requests" ? v : "attend";
}

/** صفحاتُ هذا الموظّف — «الجرد» لمن أذن له المالك. */
export function teamTabsFor(canCount: boolean): readonly { id: TeamTab; label: string }[] {
  return TEAM_TABS.filter((t) => t.id !== "count" || canCount);
}

/** مسارُ التطبيق لرمز — هو `start_url` و`scope` في بيان تثبيته. */
export function teamAppPath(token: string): string {
  return `/a/${encodeURIComponent(token)}`;
}

/** رسالةُ إرسال الرابط للموظّف — ما فيه، وكيف يثبّته على شاشته. */
export function teamInvite(name: string, url: string): string {
  return [
    `أهلاً ${name}، هذا رابط تطبيق ${TEAM_APP_NAME} الخاص بك في ذا بوبليك هاوس.`,
    "منه تسجّل حضورك وانصرافك، وترجع للوصفات والطحنات، وتصوّر الفواتير، وتطلب إجازة أو تبديلاً، وترسل اقتراحاتك للإدارة.",
    "افتحه من سفاري، ثم اضغط زر المشاركة واختر «إضافة إلى الشاشة الرئيسية». ولا يحتاج تسجيل دخول.",
    "واسمح له بقراءة الموقع عند تسجيل الحضور.",
    url,
  ].join("\n");
}
