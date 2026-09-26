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
 * ثمانية سيرف ديسبلاي — عنوانُ كلّ صفحة (سبتمبر ٢٠٢٦).
 *
 * العنوانُ بخطٍّ تحريريّ كما تفعل المنتجاتُ الماليّة التي تُقرأ كبيانٍ مرتَّب
 * (Mercury)، والمتنُ والأرقامُ بخطّ الواجهة. وزنٌ واحد (٨٢ ك.ب) **يُحمَّل
 * مسبقاً** لأنّه في كلّ صفحة: بلا ذلك يُرسم العنوانُ بخطّ الواجهة ثمّ يتبدّل
 * فيقفز ما تحته. وكان يُحمَّل وزنان (١٦٠ ك.ب) لعنوانين في صفحتين.
 */
export const thmanyahDisplay = localFont({
  src: [{ path: "../fonts/thmanyahserifdisplay-Bold.woff2", weight: "700", style: "normal" }],
  variable: "--font-thmanyah-display",
  display: "swap",
});
