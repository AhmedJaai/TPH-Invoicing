import { describe, expect, it } from "vitest";
import { parseStatementExtras } from "./statement-extras";

describe("parseStatementExtras", () => {
  it("يقرأ الأسطر والرصيدين من مخرَج النموذج", () => {
    const r = parseStatementExtras({
      openingBalance: "1,200.00",
      closingBalance: "3,450.75",
      statementLines: [
        { date: "2026-05-03", ref: "INV-1", description: "بضاعة", debit: "500.00", credit: "" },
        { date: "2026-05-19", ref: "", description: "سداد", debit: "", credit: "250.25" },
      ],
    });

    expect(r.openingBalanceMinor).toBe(120_000);
    expect(r.closingBalanceMinor).toBe(345_075);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ ref: "INV-1", debitMinor: 50_000, creditMinor: 0 });
    expect(r.lines[1]).toMatchObject({ ref: null, debitMinor: 0, creditMinor: 25_025 });
  });

  it("الرصيد الذي لم يُقرأ يبقى null ولا يصير صفراً", () => {
    const r = parseStatementExtras({ closingBalance: "800.00", statementLines: [] });
    expect(r.openingBalanceMinor).toBeNull();
    expect(r.closingBalanceMinor).toBe(80_000);
  });

  it("يُسقط سطراً بلا تاريخ صالح — ولا يعطيه تاريخ اليوم", () => {
    const r = parseStatementExtras({
      statementLines: [
        { date: "", debit: "100.00", credit: "" },
        { date: "غير معروف", debit: "100.00", credit: "" },
        { date: "2026-06-01", debit: "100.00", credit: "" },
      ],
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].date.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("يُسقط سطر الرصيد والترويسة — ما لا مدين له ولا دائن", () => {
    const r = parseStatementExtras({
      statementLines: [
        { date: "2026-06-01", description: "رصيد مُدوَّر", debit: "", credit: "" },
        { date: "2026-06-02", description: "بضاعة", debit: "75.50", credit: "" },
      ],
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].description).toBe("بضاعة");
  });

  it("المدخل الغائب أو المشوَّه لا يرمي — يُرجع مجهولاً وفارغاً", () => {
    for (const bad of [undefined, null, "نصّ", 7, []]) {
      const r = parseStatementExtras(bad);
      expect(r.openingBalanceMinor).toBeNull();
      expect(r.closingBalanceMinor).toBeNull();
      expect(r.lines).toEqual([]);
    }
  });

  it("السالب يُقرأ بقيمته المطلقة — الاتجاه في العمود لا في الإشارة", () => {
    const r = parseStatementExtras({
      statementLines: [{ date: "2026-07-01", debit: "", credit: "-300.00" }],
    });
    expect(r.lines[0].creditMinor).toBe(30_000);
  });
});
