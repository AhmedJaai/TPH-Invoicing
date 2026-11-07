/**
 * بيانُ تثبيت «TPH Team» — تطبيقُ الموظّف على شاشة جواله: يفتح رابطَه برمزه.
 *
 * بلا هذا البيان ترث الصفحةُ بيانَ التطبيق العامّ (`start_url: "/"`)، فيفتح الأيقونةَ المثبَّتة
 * على صفحة الدخول بجوجل — وهذا ما وقع للموظّفين: «أضف إلى الشاشة الرئيسيّة» ثمّ طلبُ دخولٍ لا
 * شأن لهم به. فلكلّ رابطٍ بيانُه، و`start_url` و`scope` رابطُه هو.
 */
import { NextResponse } from "next/server";
import { TEAM_APP_NAME, teamAppPath } from "@/lib/team-app";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const start = teamAppPath(token);
  return NextResponse.json(
    {
      name: TEAM_APP_NAME,
      short_name: TEAM_APP_NAME,
      description: "حضورك وانصرافك، وتصوير الفواتير، ورسائلك للإدارة — ذا بوبليك هاوس",
      id: start,
      start_url: start,
      scope: start,
      display: "standalone",
      orientation: "portrait",
      dir: "rtl",
      lang: "ar",
      background_color: "#f6f4ef",
      theme_color: "#5a5444",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "content-type": "application/manifest+json", "cache-control": "private, no-store", "referrer-policy": "no-referrer" } },
  );
}
