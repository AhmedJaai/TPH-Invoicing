import { describe, expect, it } from "vitest";
import { buildMonthClose, type MonthFacts } from "./month-close";

const clean: MonthFacts = {
  month: "2026-08",
  invoiceCount: 43,
  notTaxValidCount: 0,
  unknownTaxCount: 0,
  unpaidCount: 0,
  unpaidTotalMinor: 0,
  unpostedCount: 0,
  fixedAssetCount: 0,
  openBlockerIssues: 0,
  documentsNeedingReview: 0,
  suppliersWithInvoices: 9,
  suppliersWithStatement: 9,
  bankImportCoversMonth: true,
  bankGapDays: 0,
  bankUnexplainedCount: 0,
  bankUnexplainedMinor: 0,
  bankBalanceStatus: "BALANCED",
  bankBalanceDifferenceMinor: 0,
};

const state = (r: ReturnType<typeof buildMonthClose>, id: string) =>
  r.items.find((i) => i.id === id)?.state;

describe("buildMonthClose", () => {
  it("الشهر النظيف يُقفل", () => {
    const r = buildMonthClose(clean);
    expect(r.canClose).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.items.every((i) => i.state === "PASS")).toBe(true);
  });

  it("الشهر بلا فواتير يُمنع إقفاله", () => {
    const r = buildMonthClose({ ...clean, invoiceCount: 0 });
    expect(state(r, "has-invoices")).toBe("BLOCK");
    expect(r.canClose).toBe(false);
  });

  it("التنبيه المانع المفتوح يمنع الإقفال", () => {
    const r = buildMonthClose({ ...clean, openBlockerIssues: 2 });
    expect(state(r, "no-blockers")).toBe("BLOCK");
    expect(r.canClose).toBe(false);
  });

  it("المستند المعلّق يمنع الإقفال", () => {
    const r = buildMonthClose({ ...clean, documentsNeedingReview: 1 });
    expect(state(r, "no-pending-review")).toBe("BLOCK");
    expect(r.canClose).toBe(false);
  });

  it("الفاتورة غير الضريبية تنبّه ولا تمنع — قد لا يملك المالك حيلة فيها", () => {
    const r = buildMonthClose({ ...clean, notTaxValidCount: 9 });
    expect(state(r, "tax-valid")).toBe("WARN");
    expect(r.canClose).toBe(true);
  });

  it("غير المسدَّد ينبّه بعدده ومبلغه", () => {
    const r = buildMonthClose({ ...clean, unpaidCount: 3, unpaidTotalMinor: 125_050 });
    expect(state(r, "paid")).toBe("WARN");
    expect(r.items.find((i) => i.id === "paid")!.detail).toContain("1,250.50");
  });

  it("الكشف الناقص يُحسب فرقاً لا عدداً مطلقاً", () => {
    const r = buildMonthClose({ ...clean, suppliersWithInvoices: 9, suppliersWithStatement: 4 });
    expect(state(r, "statements")).toBe("WARN");
    expect(r.items.find((i) => i.id === "statements")!.detail).toContain("5 من 9");
  });

  it("كشوف أكثر من المورّدين لا تُنتج عدداً سالباً", () => {
    const r = buildMonthClose({ ...clean, suppliersWithInvoices: 3, suppliersWithStatement: 5 });
    expect(state(r, "statements")).toBe("PASS");
  });

  it("غياب كشف البنك ينبّه", () => {
    const r = buildMonthClose({ ...clean, bankImportCoversMonth: false });
    expect(state(r, "bank")).toBe("WARN");
    expect(r.canClose).toBe(true);
  });

  it("بند الأصول الثابتة لا يظهر إلا حين توجد", () => {
    expect(buildMonthClose(clean).items.some((i) => i.id === "fixed-assets")).toBe(false);
    const r = buildMonthClose({ ...clean, fixedAssetCount: 2 });
    expect(state(r, "fixed-assets")).toBe("WARN");
  });

  it("كل بند فيه خلل يحمل خطوة تالية", () => {
    const r = buildMonthClose({
      ...clean, invoiceCount: 0, notTaxValidCount: 4, unpaidCount: 2,
      unpostedCount: 1, openBlockerIssues: 1, bankImportCoversMonth: false,
    });
    for (const i of r.items) {
      if (i.state !== "PASS") expect(i.action, `البند ${i.id}`).toBeTruthy();
    }
  });

  it("البند السليم لا يحمل خطوة", () => {
    for (const i of buildMonthClose(clean).items) expect(i.action).toBeUndefined();
  });
});

describe("المجهول بند مستقلّ في قائمة الإقفال", () => {
  it("لا يظهر البند إلا حين توجد فواتير لم تُقرأ", () => {
    const r = buildMonthClose(clean);
    expect(r.items.some((i) => i.id === "tax-unknown")).toBe(false);
  });

  it("يظهر بعدده وبخطوة تخصّه: اقرأ المستند لا طالِب المورّد", () => {
    const r = buildMonthClose({ ...clean, unknownTaxCount: 5 });
    const item = r.items.find((i) => i.id === "tax-unknown")!;
    expect(item.state).toBe("WARN");
    expect(item.detail).toContain("5");
    expect(item.action).toContain("اقرأ محتواها");
  });

  it("المجهول ينبّه ولا يمنع الإقفال", () => {
    expect(buildMonthClose({ ...clean, unknownTaxCount: 9 }).canClose).toBe(true);
  });
});

describe("تغطية البنك ومعادلته", () => {
  /*
    الفجوة كانت تُحسب وتُعرض ولا تمنع — فيُقفَل شهرٌ ينقصه أسبوع من
    الحركات، ويصير الإقفال شهادةً على ما لم يُقرأ.
  */
  it("فجوةٌ في التغطية تمنع الإقفال", () => {
    const r = buildMonthClose({ ...clean, bankGapDays: 7 });
    expect(state(r, "bank-coverage")).toBe("BLOCK");
    expect(r.canClose).toBe(false);
  });

  it("لا فجوة → تمرّ", () => {
    expect(state(buildMonthClose(clean), "bank-coverage")).toBe("PASS");
  });

  /* «طوبقت كل الحركات» لا تعني «الحساب مضبوط» */
  it("فرقٌ غير مفسَّر في المعادلة يمنع الإقفال", () => {
    const r = buildMonthClose({
      ...clean, bankBalanceStatus: "UNEXPLAINED", bankBalanceDifferenceMinor: -11_600_00,
    });
    expect(state(r, "bank-balance")).toBe("BLOCK");
    expect(r.canClose).toBe(false);
    expect(r.blockers.some((b) => b.detail.includes("11,600.00"))).toBe(true);
  });

  it("رصيدٌ مجهول ينبّه ولا يمنع — الجهل غير الخطأ", () => {
    const r = buildMonthClose({
      ...clean, bankBalanceStatus: "UNKNOWN", bankBalanceDifferenceMinor: null,
    });
    expect(state(r, "bank-balance")).toBe("WARN");
    expect(r.canClose).toBe(true);
  });

  it("هللةٌ واحدة تمرّ", () => {
    expect(state(buildMonthClose({
      ...clean, bankBalanceStatus: "WITHIN_TOLERANCE", bankBalanceDifferenceMinor: 1,
    }), "bank-balance")).toBe("PASS");
  });

  it("حركاتٌ بلا تفسير تنبّه", () => {
    const r = buildMonthClose({
      ...clean, bankUnexplainedCount: 9, bankUnexplainedMinor: 42_000_00,
    });
    expect(state(r, "bank-unexplained")).toBe("WARN");
    expect(r.canClose).toBe(true);
  });

  /* بلا كشفٍ أصلاً لا يُسأل عن فجوةٍ ولا معادلة — السؤال سابقٌ لأوانه */
  it("بلا كشف: لا فحص تغطية ولا معادلة", () => {
    const r = buildMonthClose({ ...clean, bankImportCoversMonth: false, bankGapDays: 30 });
    expect(state(r, "bank-coverage")).toBeUndefined();
    expect(state(r, "bank-balance")).toBeUndefined();
    expect(r.canClose).toBe(true);
  });
});
