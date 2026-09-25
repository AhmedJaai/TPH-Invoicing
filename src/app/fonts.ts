import localFont from "next/font/local";

/**
 * خطّ ثمانية سانس — الخطّ الأساسيّ للواجهة كلّها.
 *
 * الأوزانُ المستعملة وحدها: كانت الخفيفةُ (٣٠٠) تُحمَّل في كلّ صفحة ولا
 * يستعملها صنفٌ واحد — ٧٢ ك.ب بلا أثر.
 */
export const thmanyahSans = localFont({
  src: [
    { path: "../fonts/thmanyahsans-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/thmanyahsans-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/thmanyahsans-Bold.woff2", weight: "700", style: "normal" },
    { path: "../fonts/thmanyahsans-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-thmanyah",
  display: "swap",
});

/**
 * ثمانية سيرف ديسبلاي — لتحيّة «اليوم» وشاشة الدخول وحدهما.
 *
 * لا يُحمَّل مسبقاً (`preload: false`): كان يُسبِق ١٦٠ ك.ب إلى كلّ صفحة
 * لعنوانٍ في صفحتين. يُطلَب حين يُرسَم، و`swap` يُظهر العنوانَ بخطّ الواجهة
 * لحظةً ثمّ يبدّله.
 */
export const thmanyahDisplay = localFont({
  src: [
    { path: "../fonts/thmanyahserifdisplay-Bold.woff2", weight: "700", style: "normal" },
    { path: "../fonts/thmanyahserifdisplay-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-thmanyah-display",
  display: "swap",
  preload: false,
});
