import type { Metadata, Viewport } from "next";
import { thmanyahDisplay, thmanyahSans } from "./fonts";
import "./globals.css";
import { ThemePrimer } from "@/components/view-controls";

export const metadata: Metadata = {
  title: "ذا بوبليك هاوس — المال والتشغيل",
  description: "ماذا تحتاج أن تعرف أو تفعل اليوم — من وصول الفاتورة حتى قيدها وسدادها وإقفال الشهر",
  appleWebApp: { capable: true, title: "ذا بوبليك هاوس", statusBarStyle: "black-translucent" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0d0b" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* يكتب الوضعَ وإخفاءَ الأرقام قبل أوّل رسم — فلا ومضةَ أبيضَ ولا مبلغٌ يظهر لحظةً */}
        <ThemePrimer />
      </head>
      <body className={`${thmanyahSans.variable} ${thmanyahDisplay.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
