import localFont from "next/font/local";

/** خط ثمانية سانس — الخط الأساسي للواجهة كلها. */
export const thmanyahSans = localFont({
  src: [
    { path: "../fonts/thmanyahsans-Light.woff2", weight: "300", style: "normal" },
    { path: "../fonts/thmanyahsans-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/thmanyahsans-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/thmanyahsans-Bold.woff2", weight: "700", style: "normal" },
    { path: "../fonts/thmanyahsans-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-thmanyah",
  display: "swap",
});

/** ثمانية سيرف ديسبلاي — للعناوين الكبيرة وحدها. */
export const thmanyahDisplay = localFont({
  src: [
    { path: "../fonts/thmanyahserifdisplay-Bold.woff2", weight: "700", style: "normal" },
    { path: "../fonts/thmanyahserifdisplay-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-thmanyah-display",
  display: "swap",
});
