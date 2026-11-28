import { describe, expect, it } from "vitest";
import { latestPriceChange, spendMonths, supplierExceptions, timelineCounts, type SupplierFacts } from "./supplier-overview";
import { priceHistory } from "./supplier-intel";

const facts = (over: Partial<SupplierFacts> = {}): SupplierFacts => ({
  supplierId: "sup-1",
  slug: "test-supplier",
  owedMinor: 0,
  pastDue: null,
  oldestOwedDays: null,
  statementStatus: "NO_STATEMENT",
  statementDifferenceMinor: null,
  risingItems: 0,
  alertMinor: null,
  issuesStatements: false,
  statementCount: 0,
  invoiceCount: 0,
  canPay: true,
  ...over,
});

describe("استثناءات المورّد — كلٌّ بفعله", () => {
  it("حسابٌ متوازن بلا شيء لا استثناء له", () => {
    expect(supplierExceptions(facts())).toEqual([]);
  });

  it("ما تجاوز أجله للعلم، وبابُه «جهّز سداده» بمعرّف المورّد", () => {
    const [e] = supplierExceptions(facts({ owedMinor: 50_000, pastDue: { count: 2, totalMinor: 30_000, oldestDays: 12 } }));
    expect(e.id).toBe("PAST_DUE");
    expect(e.tone).toBe("info");
    expect(e.amountMinor).toBe(30_000);
    expect(e.action).toEqual({ label: "جهّز سداده", href: "/payments?supplier=sup-1" });
    expect(e.title).toContain("12");
  });

  it("بلا أجلٍ معروف لا يُقال «تجاوز أجله» — يُقال العمرُ إن جاوز ستّين", () => {
    expect(supplierExceptions(facts({ owedMinor: 1, oldestOwedDays: 45 }))).toEqual([]);
    const [e] = supplierExceptions(facts({ owedMinor: 1, oldestOwedDays: 95 }));
    expect(e).toMatchObject({ id: "OLD_DEBT", tone: "danger" });
  });

  it("من لا يعتمد السداد يرى الاستثناء بلا زرٍّ يفتح عليه «خارج صلاحيتك»", () => {
    const [e] = supplierExceptions(facts({ owedMinor: 1, oldestOwedDays: 70, canPay: false }));
    expect(e.action).toBeNull();
  });

  it("الأجلُ المعروف وما فيه متأخّر لا يعود «عمراً» ثانياً", () => {
    const list = supplierExceptions(facts({ owedMinor: 1, oldestOwedDays: 120, pastDue: { count: 0, totalMinor: 0, oldestDays: 0 } }));
    expect(list).toEqual([]);
  });

  it("الترتيب: المالُ ثمّ الكشفُ ثمّ الأسعار", () => {
    const list = supplierExceptions(facts({
      owedMinor: 20_000, alertMinor: 10_000, pastDue: { count: 1, totalMinor: 20_000, oldestDays: 3 },
      statementStatus: "DIFFERS", statementDifferenceMinor: -1_500, risingItems: 2,
      issuesStatements: true, statementCount: 0, invoiceCount: 5,
    }));
    expect(list.map((e) => e.id)).toEqual(["PAST_DUE", "OVER_ALERT", "STATEMENT_DIFFERS", "NO_STATEMENT", "PRICE_RISE"]);
    /* الفرقُ يُعرض بقدره لا بإشارته */
    expect(list.find((e) => e.id === "STATEMENT_DIFFERS")?.amountMinor).toBe(1_500);
  });

  it("كشفٌ لا يُنتظر ممّن لا يصدر كشوفاً، ولا ممّن لا فاتورة منه", () => {
    expect(supplierExceptions(facts({ issuesStatements: false, invoiceCount: 9 }))).toEqual([]);
    expect(supplierExceptions(facts({ issuesStatements: true, invoiceCount: 0 }))).toEqual([]);
  });
});

const line = (day: string, unitMinor: number, invoiceId = day) => ({
  supplierId: "s", normalized: "حليب", description: "حليب", invoiceId, invoiceNumber: invoiceId, day, unitMinor, qtyMilli: 1000, basis: null,
});

describe("آخر تغيّرٍ في السعر جملةً", () => {
  it("«ارتفع 10٪ منذ» شهرِ أوّل فاتورةٍ بالسعر الجديد", () => {
    const [h] = priceHistory([line("2026-06-01", 1_000), line("2026-07-01", 1_000), line("2026-08-03", 1_100), line("2026-09-01", 1_100)], "2026-11-09");
    const c = latestPriceChange(h.state);
    expect(c).toMatchObject({ direction: "UP", pct: 10, sinceMonth: "2026-08" });
    expect(c?.text).toMatch(/^ارتفع 10٪ منذ أغسطس/);
    /* أرقامٌ لاتينيّة — كما يكتب كلُّ رقمٍ محسوب */
    expect(c?.text).not.toMatch(/[٠-٩]/);
  });

  it("الانخفاض يُقال انخفاضاً", () => {
    const [h] = priceHistory([line("2026-06-01", 1_000), line("2026-07-01", 900), line("2026-08-01", 900)], "2026-11-09");
    expect(latestPriceChange(h.state)).toMatchObject({ direction: "DOWN", pct: 10 });
  });

  it("ما لم يؤكَّد، وما يفسّره الضريبة، لا يُقال تغيّراً", () => {
    const [once] = priceHistory([line("2026-06-01", 1_000), line("2026-07-01", 1_000), line("2026-08-01", 1_200)], "2026-11-09");
    expect(once.state.kind).toBe("UNCONFIRMED");
    expect(latestPriceChange(once.state)).toBeNull();
    const [vat] = priceHistory([line("2026-06-01", 1_000), line("2026-07-01", 1_000), line("2026-08-01", 1_150), line("2026-09-01", 1_150)], "2026-11-09");
    expect(latestPriceChange(vat.state)).toBeNull();
  });

  it("التاريخُ يحمل يومَ كلّ سعرٍ وفاتورتَه بلا الشاذّ", () => {
    const [h] = priceHistory([line("2026-06-01", 1_000), line("2026-07-01", 3_000), line("2026-08-01", 1_000)], "2026-11-09");
    expect(h.history.map((p) => p.day)).toEqual(["2026-06-01", "2026-08-01"]);
    expect(h.history.map((p) => p.unitMinor)).toEqual(h.points);
  });
});

describe("المصروف بالشهر يُرصف ولا يخترع", () => {
  const row = (month: string, billedMinor: number, invoiceCount: number, paidMinor = 0, paymentCount = 0) =>
    ({ month, billedMinor, invoiceCount, paidMinor, paymentCount });

  it("لا تعامل: لا أشهر — لا اثنا عشر صفراً", () => {
    expect(spendMonths([], "2026-11")).toEqual([]);
  });

  it("يبدأ من أوّل شهر تعامل، الأحدثُ أوّلاً، والجاري جزئيّ", () => {
    const m = spendMonths([row("2026-09", 10_000, 1), row("2026-11", 5_000, 2)], "2026-11");
    expect(m.map((x) => x.month)).toEqual(["2026-11", "2026-10", "2026-09"]);
    expect(m[0].partial).toBe(true);
    /* الشهرُ الفارغ بين شهرين عددُه صفر — والشاشةُ تقوله «لا فاتورة مسجّلة» */
    expect(m[1]).toMatchObject({ invoiceCount: 0, paymentCount: 0, partial: false });
  });

  it("لا يتجاوز النافذة، ويعبر السنة", () => {
    const m = spendMonths([row("2025-01", 1, 1), row("2026-02", 1, 1)], "2026-02", 12);
    expect(m).toHaveLength(12);
    expect(m[m.length - 1].month).toBe("2025-03");
  });

  it("الدفعةُ وحدها تفتح الشهر لمن لا يصدر فواتير", () => {
    const m = spendMonths([row("2026-10", 0, 0, 7_000, 1)], "2026-11");
    expect(m.map((x) => x.month)).toEqual(["2026-11", "2026-10"]);
  });
});

describe("عدُّ أنواع الخطّ الزمنيّ", () => {
  it("يعدّ كلَّ نوعٍ والكلّ", () => {
    expect(timelineCounts(["INVOICE", "INVOICE", "PAYMENT"])).toEqual({ ALL: 3, INVOICE: 2, PAYMENT: 1, STATEMENT: 0, AUDIT: 0 });
  });
});
