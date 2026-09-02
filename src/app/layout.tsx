import type { Metadata, Viewport } from "next";
import { thmanyahDisplay, thmanyahSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "فواتير ذا بوبليك هاوس",
  description: "نظام إدارة دورة الفواتير — من وصول الفاتورة حتى قيدها وسدادها",
  appleWebApp: { capable: true, title: "الفواتير", statusBarStyle: "black-translucent" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${thmanyahSans.variable} ${thmanyahDisplay.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
