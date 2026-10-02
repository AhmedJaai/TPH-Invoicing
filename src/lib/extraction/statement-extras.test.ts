import { describe, expect, it } from "vitest";
import { parseStatementExtras, repairRunningBalance } from "./statement-extras";

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

describe("الرصيدُ الجاري المقروء مديناً — كشفُ أفال", () => {
  /* كما قرأه النموذج: «مدين» هو الرصيد الجاري و«دائن» هو مبلغُ الفاتورة */
  const aval = {
    openingBalance: "",
    closingBalance: "SR 8,399.60",
    statementLines: [
      { date: "2026-08-29", ref: "INV/2026/00110", description: "", debit: "SR 506.00", credit: "SR 506.00" },
      { date: "2026-09-02", ref: "INV/2026/00124", description: "", debit: "SR 1,657.15", credit: "SR 1,151.15" },
      { date: "2026-09-06", ref: "INV/2026/00130", description: "", debit: "SR 2,653.34", credit: "SR 996.19" },
      { date: "2026-09-13", ref: "INV/2026/00142", description: "", debit: "SR 4,310.49", credit: "SR 1,657.15" },
      { date: "2026-09-20", ref: "INV/2026/00154", description: "", debit: "SR 6,944.85", credit: "SR 2,634.36" },
      { date: "2026-09-27", ref: "INV/2026/00167", description: "", debit: "SR 8,399.60", credit: "SR 1,454.75" },
    ],
  };

  it("يُعاد العمودان إلى موضعهما: الفواتيرُ مدينة بمبالغها، ولا دائن", () => {
    const out = parseStatementExtras(aval);
    expect(out.columnsRepaired).toBe(true);
    expect(out.lines.map((l) => [l.debitMinor, l.creditMinor])).toEqual([
      [506_00, 0], [1151_15, 0], [996_19, 0], [1657_15, 0], [2634_36, 0], [1454_75, 0],
    ]);
  });

  it("ونقصُ الرصيد سدادٌ دائن", () => {
    expect(repairRunningBalance([
      { date: new Date(), ref: null, description: null, debitMinor: 1000_00, creditMinor: 1000_00 },
      { date: new Date(), ref: null, description: null, debitMinor: 400_00, creditMinor: 600_00 },
    ], null, null)?.map((l) => [l.debitMinor, l.creditMinor])).toEqual([[1000_00, 0], [0, 600_00]]);
  });

  it("وسدادٌ صفّى الحساب رصيدُه صفر — أوراق الزيتون", () => {
    const out = parseStatementExtras({ statementLines: [
      { date: "2026-05-14", ref: "260137", description: "فاتورة", debit: "420.00", credit: "420.00" },
      { date: "2026-05-15", ref: "260138", description: "فاتورة", debit: "585.00", credit: "165.00" },
      { date: "2026-06-01", ref: "51", description: "تحويل بنكي وارد", debit: "0.00", credit: "585.00" },
      { date: "2026-06-02", ref: "260164", description: "فاتورة", debit: "280.00", credit: "280.00" },
    ] });
    expect(out.columnsRepaired).toBe(true);
    expect(out.lines.map((l) => [l.debitMinor, l.creditMinor])).toEqual([[420_00, 0], [165_00, 0], [0, 585_00], [280_00, 0]]);
  });

  it("وما لا يصدق في سطرٍ واحد لا يُمسّ", () => {
    const broken = { ...aval, statementLines: aval.statementLines.map((l, i) => (i === 3 ? { ...l, credit: "SR 1,600.00" } : l)) };
    expect(parseStatementExtras(broken).columnsRepaired).toBe(false);
  });

  it("ولا كشفٌ سليمٌ مدينُه ودائنُه في سطورٍ منفصلة", () => {
    expect(parseStatementExtras({ statementLines: [
      { date: "2026-08-03", ref: "1", description: "فاتورة", debit: "150.00", credit: "" },
      { date: "2026-08-26", ref: "2", description: "دفع", debit: "", credit: "150.00" },
    ] }).columnsRepaired).toBe(false);
  });

  it("والرصيدُ وحده بلا مبلغ — يُشتقّ المبلغ من فرق الرصيدين إن طابق الختاميّ (أوراق الزيتون يوليو)", () => {
    const out = parseStatementExtras({ closingBalance: "280.00", statementLines: [
      { date: "2026-05-14", ref: "260137", description: "فاتورة", debit: "420.00", credit: "" },
      { date: "2026-05-15", ref: "260138", description: "فاتورة", debit: "585.00", credit: "" },
      { date: "2026-06-01", ref: "51", description: "تحويل", debit: "0.00", credit: "585.00" },
      { date: "2026-06-02", ref: "260164", description: "فاتورة", debit: "280.00", credit: "" },
    ] });
    expect(out.columnsRepaired).toBe(true);
    expect(out.lines.map((l) => [l.debitMinor, l.creditMinor])).toEqual([[420_00, 0], [165_00, 0], [0, 585_00], [280_00, 0]]);
  });

  it("ولا يُشتقّ بلا ختاميٍّ يشهد له", () => {
    expect(parseStatementExtras({ statementLines: [
      { date: "2026-05-14", ref: "1", description: "", debit: "420.00", credit: "" },
      { date: "2026-05-15", ref: "2", description: "", debit: "585.00", credit: "" },
    ] }).columnsRepaired).toBe(false);
  });
});
