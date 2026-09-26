/**
 * لوحُ الفحص — أيُّ الروابط تُفتح فوق القائمة بدل أن تنقل الصفحة.
 *
 * ملفُّ المورّد والفاتورة والصنف وحركة البنك يُفتح من القائمة لوحاً جانبيّاً
 * (مسارٌ معترِض في `(app)/@drawer`) فتبقى القائمةُ بتمريرها وتصفيتها. والرابطُ
 * نفسُه يُحمَّل مباشرةً (تحديثٌ، أو رابطٌ مشارَك) صفحةً كاملة.
 *
 * دالّةٌ خالصة — يقرؤها اللوحُ (يستبدل ولا يكدّس) والاختصاراتُ (J/K) والاختبار.
 */
const INSPECTOR_PATHS: readonly RegExp[] = [
  /^\/suppliers\/[^/]+$/,
  /^\/purchases\/invoices\/[^/]+$/,
  /^\/inventory\/items\/[^/]+$/,
  /^\/bank\/tx\/[^/]+$/,
];

/** المسارُ وحده، بلا استعلامٍ ولا مرساة. */
export function pathOf(href: string): string {
  const i = href.search(/[?#]/);
  return i === -1 ? href : href.slice(0, i);
}

export function isInspectorPath(href: string): boolean {
  const p = pathOf(href);
  return INSPECTOR_PATHS.some((re) => re.test(p));
}

/** رابطُ حركة البنك — ملفُّها لوحاً فوق ما أنت فيه، أو صفحةً إن فُتح مباشرة. */
export function txHref(id: string): string {
  return `/bank/tx/${id}`;
}
