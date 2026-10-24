/**
 * كم صفّاً من سجلّ البنك يُرسَم، ومن أين.
 *
 * - **بلا شهر:** أحدثُ ستّين وحدها — مئةٌ وعشرون بطاقةً على الجوّال صفحةٌ طولُها
 *   ثمانيةٌ وعشرون ألفَ بكسل (قيس)، ومن يبحث عن حركةٍ قديمة يعرف شهرها.
 * - **بشهر:** صفحاتٌ من مئة. كان الشهرُ يُرسَم حتى أربعمئة صفٍّ دفعةً، والجدولُ
 *   يرسم كلَّ صفٍّ مرّتين (جدولاً للحاسوب وبطاقةً للجوّال، `DataTable`) — فشهرٌ
 *   مزدحم ثمانُمئة صفٍّ في الصفحة. وما بعد المئة «الأقدم» بصفحته، لا قصٌّ صامت.
 * - **بحث:** حتى ثلاثمئة نتيجة في الحركات كلِّها، ويُقال إن زادت.
 */
export const LEDGER_RECENT = 60;
export const LEDGER_MONTH_PAGE = 100;
/** حدُّ نتائج البحث — يبحث في الحركات كلِّها، ويُقال إن زادت المطابِقاتُ عليه. */
export const SEARCH_LIMIT = 300;

export interface LedgerWindow {
  limit: number;
  offset: number;
  /** الصفحةُ المعروضة فعلاً — ١ لما لا صفحات فيه. */
  page: number;
}

/** صفحةُ العنوان كما وصلت (`?page=`) — وما لا يُفهم منها الأولى. */
export function parseLedgerPage(raw: string | undefined): number {
  const n = raw && /^\d{1,4}$/.test(raw) ? Number(raw) : 1;
  return n >= 1 ? n : 1;
}

export function ledgerWindow(month: string | null, searching: boolean, page: number): LedgerWindow {
  if (searching) return { limit: SEARCH_LIMIT, offset: 0, page: 1 };
  if (!month) return { limit: LEDGER_RECENT, offset: 0, page: 1 };
  const p = Math.max(1, Math.trunc(page));
  return { limit: LEDGER_MONTH_PAGE, offset: (p - 1) * LEDGER_MONTH_PAGE, page: p };
}

/** كم صفحةً في الشهر — ولا صفحات بلا شهر أو مع البحث. */
export function ledgerPages(total: number, month: string | null, searching: boolean): number {
  if (!month || searching) return 1;
  return Math.max(1, Math.ceil(total / LEDGER_MONTH_PAGE));
}
