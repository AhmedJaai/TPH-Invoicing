import { describe, expect, it } from "vitest";
import { LEDGER_MONTH_PAGE, LEDGER_RECENT, SEARCH_LIMIT, ledgerPages, ledgerWindow, parseLedgerPage } from "./ledger-window";

describe("ledgerWindow — كم صفّاً من سجلّ البنك يُرسَم", () => {
  it("بلا شهر: أحدثُ ستّين، ولا صفحات", () => {
    expect(ledgerWindow(null, false, 3)).toEqual({ limit: LEDGER_RECENT, offset: 0, page: 1 });
    expect(ledgerPages(500, null, false)).toBe(1);
  });

  it("بشهر: صفحاتٌ من مئة، والثالثةُ تبدأ بعد مئتين", () => {
    expect(ledgerWindow("2026-09", false, 3)).toEqual({ limit: LEDGER_MONTH_PAGE, offset: 200, page: 3 });
    expect(ledgerPages(250, "2026-09", false)).toBe(3);
    expect(ledgerPages(100, "2026-09", false)).toBe(2 - 1);
    /* شهرٌ فارغ صفحةٌ واحدة لا صفر */
    expect(ledgerPages(0, "2026-09", false)).toBe(1);
  });

  it("البحثُ يبحث في الكلّ بحدّه، ولا يأخذ صفحة", () => {
    expect(ledgerWindow("2026-09", true, 4)).toEqual({ limit: SEARCH_LIMIT, offset: 0, page: 1 });
    expect(ledgerPages(900, "2026-09", true)).toBe(1);
  });

  it("الصفحةُ الغريبة في العنوان هي الأولى", () => {
    for (const raw of [undefined, "", "0", "-2", "abc", "1.5", "99999"]) expect(parseLedgerPage(raw)).toBe(1);
    expect(parseLedgerPage("4")).toBe(4);
  });
});
