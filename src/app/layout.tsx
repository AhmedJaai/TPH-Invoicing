import type { Metadata, Viewport } from "next";
import { thmanyahDisplay, thmanyahSans } from "./fonts";
import "./globals.css";
import { cookies } from "next/headers";
import { ThemePrimer } from "@/components/view-controls";
import { EnglishRuntime } from "@/components/i18n/english-runtime";
import { asLocale, DICTIONARY_URL, LOCALE_COOKIE } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: "ذا بوبليك هاوس — المال والتشغيل",
  description: "ماذا تحتاج أن تعرف أو تفعل اليوم، من وصول الفاتورة إلى تسجيلها وسدادها وإقفال الشهر",
  /*
    `default` لا `black-translucent`: الشفّافُ يكتب الساعةَ أبيضَ فوق ورق الشريط
    العلويّ فلا تُقرأ، ويمدّ الصفحةَ تحتها. والشريطُ العلويّ يحسب الحافّةَ الآمنة
    (`--safe-top`) على أيّ حال — لسفاري حين يطوي شريطه.
  */
  appleWebApp: { capable: true, title: "ذا بوبليك هاوس", statusBarStyle: "default" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0d0b" },
  ],
  width: "device-width",
  initialScale: 1,
  /* الصفحةُ تمتدّ تحت الساعة وشريط المنزل، وكلُّ لاصقٍ بحافّةٍ يحسبها من `--safe-*` في `globals.css` */
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = asLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const en = locale === "en";
  return (
    <html lang={locale} dir={en ? "ltr" : "rtl"} className={en ? "i18n-pending" : undefined} suppressHydrationWarning>
      <head>
        {/* الإنجليزيّة: تُخفى الصفحةُ حتّى تُترجَم فلا يومض العربيّ، والقاموسُ يُطلَب مع الصفحة لا بعدها */}
        {en && <style>{`html.i18n-pending body{visibility:hidden}`}</style>}
        {en && <link rel="preload" href={DICTIONARY_URL} as="fetch" crossOrigin="anonymous" />}
        {/* يكتب الوضعَ وإخفاءَ الأرقام قبل أوّل رسم — فلا ومضةَ أبيضَ ولا مبلغٌ يظهر لحظةً */}
        <ThemePrimer />
      </head>
      <body className={`${thmanyahSans.variable} ${thmanyahDisplay.variable} font-sans antialiased`}>
        {children}
        {en && <EnglishRuntime />}
      </body>
    </html>
  );
}
