/**
 * بيانُ تثبيت رابط الباريستا — يفتح صفحتَه برمزها من الشاشة الرئيسيّة،
 * لا صفحةَ الدخول التي يفتحها بيانُ التطبيق العامّ.
 */
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const start = `/c/${encodeURIComponent(token)}`;
  return NextResponse.json(
    {
      name: "صوّر الفاتورة — ذا بوبليك هاوس",
      short_name: "صوّر الفاتورة",
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
