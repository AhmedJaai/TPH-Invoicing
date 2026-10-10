import { describe, expect, it } from "vitest";
import { parseLedgerSearch } from "./ledger-search";

describe("بحثُ سجلّ البنك", () => {
  it("الفارغُ والحرفُ الواحد ليسا بحثاً", () => {
    expect(parseLedgerSearch(undefined)).toBeNull();
    expect(parseLedgerSearch("  ")).toBeNull();
    expect(parseLedgerSearch("م")).toBeNull();
  });

  it("الاسمُ نصٌّ لا مبلغ", () => {
    const s = parseLedgerSearch("  المراعي  ");
    expect(s).toEqual({ text: "المراعي", like: "%المراعي%", amount: null });
  });

  it("المبلغُ بلا كسر يجد الريالَ كلَّه بهللاته", () => {
    expect(parseLedgerSearch("2,450")?.amount).toEqual({ fromMinor: 245_000, toMinor: 245_099 });
  });

  it("المبلغُ بكسره يجد نفسَه وحده", () => {
    expect(parseLedgerSearch("2450.50")?.amount).toEqual({ fromMinor: 245_050, toMinor: 245_050 });
  });

  it("الأرقامُ العربيّة تُقرأ مبلغاً كذلك", () => {
    expect(parseLedgerSearch("١٢٥٠")?.amount).toEqual({ fromMinor: 125_000, toMinor: 125_099 });
  });

  it("محارفُ النمط تُهرَّب — لا يصير البحثُ «كلّ شيء»", () => {
    expect(parseLedgerSearch("50%_x")?.like).toBe("%50\\%\\_x%");
  });

  it("نصٌّ فيه حروفٌ وأرقام ليس مبلغاً", () => {
    expect(parseLedgerSearch("INV-2450")?.amount).toBeNull();
  });
});
