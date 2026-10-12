import { describe, expect, it } from "vitest";
import { buildBalanceItem, chooseSource, totalBalance, type BalanceItemInput, type RangeFigures } from "./stock-balance";

const r = (over: Partial<RangeFigures> = {}): RangeFigures => ({
  invoicesMilli: null, invoicesMinor: 0, foodicsMilli: 100_000_000, foodicsMinor: 1_000_000,
  soldMilli: 80_000_000, staffMilli: 1_000_000, wasteMilli: 0, ...over,
});
/** بنٌّ بالجرام: ١٠٠ ريالٍ للكيلو. */
const base: BalanceItemInput = {
  productId: "p", name: "بنّ", baseUnit: "G", rateMilliMinor: 10_000,
  period: r({ foodicsMilli: 30_000_000, foodicsMinor: 300_000, soldMilli: 25_000_000 }),
  /* شهرٌ: سبعون كيلو اشتُريت قبله، ومئةٌ حتى آخره */
  before: r({ foodicsMilli: 70_000_000, foodicsMinor: 700_000 }), toDate: r(), toCount: null, count: null,
};

describe("المشترى والمباع والمتوقَّع — بلا اشتراط جرد", () => {
  it("بلا جرد: كم اشتريتُ وكم بعتُ وكم يُتوقَّع أنّه بقي — ولا يُقال «ضاع»", () => {
    const b = buildBalanceItem(base);
    expect(b.source).toBe("FOODICS");
    expect(b.purchasedMilli).toBe(30_000_000);
    expect(b.soldMilli).toBe(25_000_000);
    /* ١٠٠ كيلو اشتُريت منذ البداية − ٨٠ بِيعت = ٢٠ */
    expect(b.expectedMilli).toBe(20_000_000);
    expect(b.expectedMinor).toBe(200_000);
    expect(b.lostMilli).toBeNull();
    expect(b.notes).toEqual([]);
  });
  it("بجرد: الضائعُ = المتوقَّع يومَ العدّ − المعدود", () => {
    const b = buildBalanceItem({ ...base, toCount: r({ foodicsMilli: 90_000_000, soldMilli: 75_000_000 }), count: { day: "2026-10-10", milli: 12_000_000, source: "FOODICS" } });
    expect(b.lostMilli).toBe(3_000_000);
    expect(b.lostMinor).toBe(30_000);
  });
  it("بِيع أكثر ممّا اشتُري: شراءٌ لم يُسجَّل — يُقال ولا يُخفى", () => {
    const b = buildBalanceItem({ ...base, toDate: r({ foodicsMilli: 50_000_000 }) });
    expect(b.expectedMilli).toBe(-30_000_000);
    expect(b.notes).toEqual(["SOLD_MORE_THAN_BOUGHT"]);
  });
  it("ومتوقَّعٌ سالبٌ يومَ العدّ لا يُقاس عليه ضياع", () => {
    const b = buildBalanceItem({ ...base, toCount: r({ foodicsMilli: 50_000_000 }), count: { day: "d", milli: 5_000_000, source: "FOODICS" } });
    expect(b.lostMilli).toBeNull();
  });
  it("لا شراءَ ولا وصفة: غير معروف لا صفر", () => {
    const b = buildBalanceItem({ ...base, before: null, period: r({ foodicsMilli: null, soldMilli: null }), toDate: r({ foodicsMilli: null, soldMilli: null }) });
    expect(b.purchasedMilli).toBeNull();
    expect(b.expectedMilli).toBeNull();
    expect(b.notes).toEqual(["NO_PURCHASES", "NO_RECIPE"]);
  });
  it("ضائعٌ فوق عشرة أضعاف ما بِيع رقمٌ مشكوك — يُخرَج ويُسمّى", () => {
    const b = buildBalanceItem({ ...base, toCount: r({ foodicsMilli: 600_000_000, soldMilli: 1_000_000 }), count: { day: "2026-10-10", milli: 500_000, source: "FOODICS" } });
    expect(b.lostMilli).toBeNull();
    expect(b.notes).toContain("SUSPECT_ENTRY");
  });
});

describe("المشترى من المصدرين: الأكملُ هو الأدقّ", () => {
  it("يُقال أيُّهما أكمل، ومتى اتّفقا", () => {
    expect(chooseSource(r({ invoicesMilli: 145_000_000 }))).toBe("INVOICES");
    expect(chooseSource(r({ invoicesMilli: 21_000_000 }))).toBe("FOODICS");
    expect(chooseSource(r({ invoicesMilli: 99_000_000 }))).toBe("SAME");
    expect(chooseSource(r({ invoicesMilli: 21_000_000, foodicsMilli: null }))).toBe("INVOICES");
    expect(chooseSource(r({ foodicsMilli: null }))).toBeNull();
  });
  it("فواتيرُنا أكمل: يُحسَب بها المتوقَّع ولو أُدخل في فودكس أقلّ", () => {
    const b = buildBalanceItem({ ...base, toDate: r({ invoicesMilli: 145_000_000, invoicesMinor: 1_450_000 }) });
    expect(b.source).toBe("INVOICES");
    expect(b.expectedMilli).toBe(65_000_000);
    expect(b.invoicesToDateMilli).toBe(145_000_000);
    expect(b.foodicsToDateMilli).toBe(100_000_000);
  });
  it("مشترى الشهر تراكميّ: فاتورةُ آخر يونيو المدخَلةُ في فودكس أوّلَ يوليو لا تُحسَب مرّتين", () => {
    /* حتى آخر يونيو: فواتيرُنا ٥٠ وفودكس ٤٥. حتى آخر يوليو: كلاهما ٦٠ */
    const b = buildBalanceItem({
      ...base,
      before: r({ invoicesMilli: 50_000_000, invoicesMinor: 500_000, foodicsMilli: 45_000_000, foodicsMinor: 450_000 }),
      toDate: r({ invoicesMilli: 60_000_000, invoicesMinor: 600_000, foodicsMilli: 60_000_000, foodicsMinor: 600_000, soldMilli: 40_000_000 }),
    });
    expect(b.purchasedMilli).toBe(10_000_000);
    expect(b.purchasedMinor).toBe(100_000);
  });
});

it("الضائعُ والزائدُ لا يتقاصّان", () => {
  const lost = buildBalanceItem({ ...base, toCount: r(), count: { day: "d", milli: 15_000_000, source: "OURS" } });
  const found = buildBalanceItem({ ...base, productId: "q", toCount: r(), count: { day: "d", milli: 25_000_000, source: "OURS" } });
  const t = totalBalance([lost, found]);
  expect(t.lostMinor).toBe(50_000);
  expect(t.foundMinor).toBe(-50_000);
  expect(totalBalance([buildBalanceItem(base)]).lostMinor).toBeNull();
});
