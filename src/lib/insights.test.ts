import { describe, expect, it } from "vitest";
import { buildInsights, type InsightInput } from "./insights";
import { summarizeItems, findPriceGaps, buildAging, type LineRow } from "./analytics";
import { normalizeItem } from "./items";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const empty: InsightInput = {
  items: [], priceGaps: [], aging: [], monthlySpend: [],
  vatAtRiskMinor: 0, vatAtRiskCount: 0, notTaxValidCount: 0,
  unpaidTotalMinor: 0, unpaidCount: 0, unpostedCount: 0, fixedAssetCount: 0,
  suppliersWithoutContract: [], suppliersMissingStatement: [],
  duplicatePaymentCount: 0, asOf: d("2026-09-03"),
};

const ids = (i: ReturnType<typeof buildInsights>) => i.map((x) => x.id);

const line = (o: { description: string; date: string; supplierId?: string; supplierName?: string; qty?: number; unit?: number }): LineRow => ({
  normalizedDescription: normalizeItem(o.description),
  description: o.description,
  supplierId: o.supplierId ?? "s1",
  supplierName: o.supplierName ?? "أ",
  invoiceDate: d(o.date),
  quantity: o.qty ?? 1,
  unitPriceMinor: o.unit ?? 1000,
  lineTotalMinor: (o.qty ?? 1) * (o.unit ?? 1000),
});

describe("مولّد التوصيات", () => {
  it("لا يخترع توصيات من بيانات نظيفة", () => {
    expect(buildInsights(empty)).toHaveLength(0);
  });

  it("يرفع ضريبة المدخلات المعرّضة كأمر حرج بأثرها المالي", () => {
    const r = buildInsights({ ...empty, vatAtRiskMinor: 390_000, vatAtRiskCount: 12 });
    expect(r[0].id).toBe("vat-at-risk");
    expect(r[0].severity).toBe("critical");
    expect(r[0].impactMinor).toBe(390_000);
    expect(r[0].title).toContain("3,900.00");
  });

  it("يرتّب الحرج قبل التنبيه قبل الفرصة قبل المعلومة", () => {
    const r = buildInsights({
      ...empty,
      vatAtRiskMinor: 1_000, vatAtRiskCount: 1,
      unpostedCount: 3,
      unpaidCount: 2, unpaidTotalMinor: 5_000,
    });
    expect(ids(r)).toEqual(["vat-at-risk", "unposted", "unpaid"]);
  });

  it("يرتّب داخل الدرجة الواحدة بالأثر المالي", () => {
    const items = summarizeItems([
      line({ description: "بن", date: "2026-06-01", unit: 5000, qty: 10 }),
      line({ description: "بن", date: "2026-08-01", unit: 7000, qty: 10 }),
    ]);
    const r = buildInsights({
      ...empty,
      items,
      vatAtRiskMinor: 100, vatAtRiskCount: 1,
    });
    // كلاهما حرج؛ الأكبر أثراً أوّلاً
    expect(r[0].impactMinor).toBeGreaterThanOrEqual(r[1].impactMinor);
  });
});

describe("توصية فروق الأسعار بين المورّدين", () => {
  const items = summarizeItems([
    line({ description: "حليب 2 لتر", date: "2026-08-01", supplierId: "s1", supplierName: "أوراق الزيتون", qty: 100, unit: 1000 }),
    line({ description: "حليب 2 لتر", date: "2026-08-02", supplierId: "s2", supplierName: "بيكوف", qty: 100, unit: 800 }),
  ]);

  it("تحسب التوفير وتسمّي الأرخص والأغلى", () => {
    const r = buildInsights({ ...empty, items, priceGaps: findPriceGaps(items) });
    const gap = r.find((x) => x.id === "price-gaps")!;
    expect(gap.severity).toBe("opportunity");
    expect(gap.impactMinor).toBe(40_000);
    expect(gap.detail).toContain("بيكوف");
    expect(gap.detail).toContain("أوراق الزيتون");
  });

  it("تحذّر قبل التوحيد بدل أن تأمر به", () => {
    const r = buildInsights({ ...empty, items, priceGaps: findPriceGaps(items) });
    expect(r.find((x) => x.id === "price-gaps")!.action).toContain("جودة");
  });
});

describe("توصية ارتفاع الأسعار", () => {
  it("تقدّر الأثر السنوي من دورة الطلب الفعلية", () => {
    const items = summarizeItems([
      line({ description: "بن اثيوبي", date: "2026-06-01", qty: 10, unit: 5000 }),
      line({ description: "بن اثيوبي", date: "2026-07-01", qty: 10, unit: 5000 }),
      line({ description: "بن اثيوبي", date: "2026-08-01", qty: 10, unit: 6000 }),
    ]);
    const r = buildInsights({ ...empty, items });
    const rise = r.find((x) => x.id === "price-rises")!;
    expect(rise).toBeDefined();
    expect(rise.impactMinor).toBeGreaterThan(0);
    expect(rise.detail).toContain("بن اثيوبي");
  });

  it("تتجاهل الارتفاع التافه", () => {
    const items = summarizeItems([
      line({ description: "سكر", date: "2026-07-01", unit: 1000 }),
      line({ description: "سكر", date: "2026-08-01", unit: 1020 }),
    ]);
    expect(ids(buildInsights({ ...empty, items }))).not.toContain("price-rises");
  });

  it("تتجاهل الانخفاض — ليس مشكلة", () => {
    const items = summarizeItems([
      line({ description: "سكر", date: "2026-07-01", unit: 2000 }),
      line({ description: "سكر", date: "2026-08-01", unit: 1000 }),
    ]);
    expect(ids(buildInsights({ ...empty, items }))).not.toContain("price-rises");
  });
});

describe("توصية الذمم المتقادمة", () => {
  it("تُحسب من ٦٠ يوماً فأكثر فقط", () => {
    const asOf = d("2026-09-03");
    const aging = buildAging([
      { supplierId: "s1", supplierName: "أ", invoiceDate: d("2026-08-25"), outstandingMinor: 50_000 },
    ], asOf);
    expect(ids(buildInsights({ ...empty, aging, asOf }))).not.toContain("aged-payables");

    const old = buildAging([
      { supplierId: "s2", supplierName: "ب", invoiceDate: d("2026-05-01"), outstandingMinor: 70_000 },
    ], asOf);
    const r = buildInsights({ ...empty, aging: old, asOf });
    const aged = r.find((x) => x.id === "aged-payables")!;
    expect(aged.impactMinor).toBe(70_000);
    expect(aged.detail).toContain("ب");
  });
});

describe("توصيات التشغيل", () => {
  it("تنبّه على المدفوعات المكرّرة كأمر حرج", () => {
    const r = buildInsights({ ...empty, duplicatePaymentCount: 2 });
    expect(r[0].id).toBe("duplicate-payments");
    expect(r[0].severity).toBe("critical");
  });

  it("تسمّي المورّدين بلا عقد", () => {
    const r = buildInsights({ ...empty, suppliersWithoutContract: ["أوسكا", "مريم"] });
    expect(r[0].detail).toContain("أوسكا");
    expect(r[0].detail).toContain("مريم");
  });

  it("تسمّي من لم يرسل كشفه", () => {
    const r = buildInsights({ ...empty, suppliersMissingStatement: ["غاناش"] });
    expect(r.find((x) => x.id === "missing-statements")!.detail).toContain("غاناش");
  });
});

describe("اتجاه المصروف", () => {
  it("ينبّه على القفزة ويسأل عن سببها", () => {
    const r = buildInsights({
      ...empty,
      monthlySpend: [
        { month: "2026-07", totalMinor: 100_000, invoiceCount: 10 },
        { month: "2026-08", totalMinor: 150_000, invoiceCount: 12 },
      ],
    });
    const t = r.find((x) => x.id === "spend-trend")!;
    expect(t.title).toContain("ارتفعت");
    expect(t.title).toContain("50٪");
    expect(t.action).toContain("كميّات");
  });

  it("يشكّ في الانخفاض بدل أن يفرح به", () => {
    const r = buildInsights({
      ...empty,
      monthlySpend: [
        { month: "2026-07", totalMinor: 150_000, invoiceCount: 12 },
        { month: "2026-08", totalMinor: 100_000, invoiceCount: 8 },
      ],
    });
    expect(r.find((x) => x.id === "spend-trend")!.action).toContain("لم تصل");
  });

  it("يتجاهل التذبذب الطبيعي", () => {
    const r = buildInsights({
      ...empty,
      monthlySpend: [
        { month: "2026-07", totalMinor: 100_000, invoiceCount: 10 },
        { month: "2026-08", totalMinor: 105_000, invoiceCount: 10 },
      ],
    });
    expect(ids(r)).not.toContain("spend-trend");
  });

  it("لا يقارن بشهر واحد ولا يقسم على صفر", () => {
    expect(ids(buildInsights({ ...empty, monthlySpend: [{ month: "2026-08", totalMinor: 100_000, invoiceCount: 5 }] }))).not.toContain("spend-trend");
    expect(ids(buildInsights({ ...empty, monthlySpend: [
      { month: "2026-07", totalMinor: 0, invoiceCount: 0 },
      { month: "2026-08", totalMinor: 100_000, invoiceCount: 5 },
    ] }))).not.toContain("spend-trend");
  });
});
