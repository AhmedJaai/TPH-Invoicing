import { describe, expect, it } from "vitest";
import {
  ageBucket, buildAging, findPriceGaps, paymentStatus,
  spendByMonth, summarizeItems, vatAtRisk, type LineRow,
} from "./analytics";
import { normalizeItem } from "./items";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const line = (
  o: Omit<Partial<LineRow>, "invoiceDate"> & { description: string; invoiceDate: string },
): LineRow => ({
  normalizedDescription: normalizeItem(o.description),
  description: o.description,
  supplierId: o.supplierId ?? "s1",
  supplierName: o.supplierName ?? "أوراق الزيتون",
  invoiceDate: d(o.invoiceDate),
  quantity: o.quantity ?? 1,
  unitPriceMinor: o.unitPriceMinor ?? 1000,
  lineTotalMinor: o.lineTotalMinor ?? (o.quantity ?? 1) * (o.unitPriceMinor ?? 1000),
});

describe("حالة السداد", () => {
  it("غير مسددة حين لا تخصيص", () => {
    const s = paymentStatus({ invoiceId: "i", totalMinor: 13_000, allocatedMinor: 0 });
    expect(s.state).toBe("UNPAID");
    expect(s.remainingMinor).toBe(13_000);
  });

  it("مسددة بالكامل", () => {
    expect(paymentStatus({ invoiceId: "i", totalMinor: 13_000, allocatedMinor: 13_000 }).state).toBe("PAID");
  });

  it("مسددة جزئياً", () => {
    const s = paymentStatus({ invoiceId: "i", totalMinor: 13_000, allocatedMinor: 5_000 });
    expect(s.state).toBe("PARTIAL");
    expect(s.remainingMinor).toBe(8_000);
  });

  it("تتسامح بهللة تقريب فلا تُظهر المسددة ناقصة", () => {
    expect(paymentStatus({ invoiceId: "i", totalMinor: 13_000, allocatedMinor: 12_999 }).state).toBe("PAID");
    expect(paymentStatus({ invoiceId: "i", totalMinor: 13_000, allocatedMinor: 13_001 }).state).toBe("PAID");
  });

  it("تكشف الدفع الزائد — نمط الدفع المكرر", () => {
    expect(paymentStatus({ invoiceId: "i", totalMinor: 13_000, allocatedMinor: 26_000 }).state).toBe("OVERPAID");
  });
});

describe("أعمار الذمم", () => {
  const asOf = d("2026-09-03");

  it("تصنّف الأعمار في شرائحها", () => {
    expect(ageBucket(d("2026-08-20"), asOf)).toBe("current");
    expect(ageBucket(d("2026-07-20"), asOf)).toBe("d30");
    expect(ageBucket(d("2026-06-20"), asOf)).toBe("d60");
    expect(ageBucket(d("2026-05-20"), asOf)).toBe("d90");
    expect(ageBucket(d("2026-01-20"), asOf)).toBe("older");
  });

  it("تجمع لكل مورّد وترتّب بالأكبر", () => {
    const rows = buildAging([
      { supplierId: "s1", supplierName: "أ", invoiceDate: d("2026-08-20"), outstandingMinor: 10_000 },
      { supplierId: "s1", supplierName: "أ", invoiceDate: d("2026-06-20"), outstandingMinor: 5_000 },
      { supplierId: "s2", supplierName: "ب", invoiceDate: d("2026-08-25"), outstandingMinor: 30_000 },
    ], asOf);

    expect(rows[0].supplierId).toBe("s2");
    expect(rows[1].totalMinor).toBe(15_000);
    expect(rows[1].buckets.current).toBe(10_000);
    expect(rows[1].buckets.d60).toBe(5_000);
    expect(rows[1].oldestDays).toBeGreaterThan(70);
  });

  it("تتجاهل المسدَّد", () => {
    expect(buildAging([
      { supplierId: "s1", supplierName: "أ", invoiceDate: d("2026-08-20"), outstandingMinor: 0 },
    ], asOf)).toHaveLength(0);
  });
});

describe("تحليل الاستهلاك", () => {
  it("يجمع الصيغ المختلفة للصنف الواحد", () => {
    const items = summarizeItems([
      line({ description: "حليب طازج ٢ لتر", invoiceDate: "2026-07-01", quantity: 10, unitPriceMinor: 800 }),
      line({ description: "حليب طازج 2ل", invoiceDate: "2026-08-01", quantity: 12, unitPriceMinor: 800 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].orderCount).toBe(2);
    expect(items[0].totalQuantity).toBe(22);
    expect(items[0].totalSpentMinor).toBe(17_600);
  });

  it("يختار أوفى صيغة للاسم بين صيغ الصنف الواحد", () => {
    const items = summarizeItems([
      line({ description: "حليب طازج 2ل", invoiceDate: "2026-07-01" }),
      line({ description: "حليب طازج ٢ لتر", invoiceDate: "2026-08-01" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].displayName).toBe("حليب طازج ٢ لتر");
  });

  it("لا يدمج صنفين مختلفين ولو تشابه أول اسمهما", () => {
    const items = summarizeItems([
      line({ description: "حليب", invoiceDate: "2026-07-01" }),
      line({ description: "حليب طازج كامل الدسم", invoiceDate: "2026-08-01" }),
    ]);
    expect(items).toHaveLength(2);
  });

  it("يحسب متوسط الفترة بين الطلبات", () => {
    const items = summarizeItems([
      line({ description: "بن", invoiceDate: "2026-06-01" }),
      line({ description: "بن", invoiceDate: "2026-07-01" }),
      line({ description: "بن", invoiceDate: "2026-08-01" }),
    ]);
    expect(items[0].averageDaysBetweenOrders).toBeGreaterThan(28);
    expect(items[0].averageDaysBetweenOrders).toBeLessThan(32);
  });

  it("لا يحسب فترة من طلب واحد", () => {
    const items = summarizeItems([line({ description: "بن", invoiceDate: "2026-08-01" })]);
    expect(items[0].averageDaysBetweenOrders).toBeNull();
  });

  it("يكشف تغيّر السعر داخل الصنف", () => {
    const items = summarizeItems([
      line({ description: "بن اثيوبي", invoiceDate: "2026-06-01", unitPriceMinor: 5000 }),
      line({ description: "بن اثيوبي", invoiceDate: "2026-08-01", unitPriceMinor: 6000 }),
    ]);
    expect(items[0].priceChange?.direction).toBe("up");
    expect(items[0].priceChange?.deltaRatio).toBeCloseTo(0.2);
  });

  it("يرتّب بالأكثر إنفاقاً", () => {
    const items = summarizeItems([
      line({ description: "سكر", invoiceDate: "2026-08-01", quantity: 1, unitPriceMinor: 500 }),
      line({ description: "بن", invoiceDate: "2026-08-01", quantity: 10, unitPriceMinor: 5000 }),
    ]);
    expect(items[0].displayName).toBe("بن");
  });

  it("يفصل المورّدين ويرتّبهم بالأرخص", () => {
    const items = summarizeItems([
      line({ description: "حليب 2 لتر", invoiceDate: "2026-08-01", supplierId: "s1", supplierName: "أ", unitPriceMinor: 900 }),
      line({ description: "حليب 2 لتر", invoiceDate: "2026-08-02", supplierId: "s2", supplierName: "ب", unitPriceMinor: 750 }),
    ]);
    expect(items[0].suppliers[0].supplierName).toBe("ب");
    expect(items[0].suppliers[0].lastUnitPriceMinor).toBe(750);
  });
});

describe("فجوة السعر بين المورّدين", () => {
  const items = summarizeItems([
    line({ description: "حليب 2 لتر", invoiceDate: "2026-08-01", supplierId: "s1", supplierName: "أ", quantity: 100, unitPriceMinor: 1000 }),
    line({ description: "حليب 2 لتر", invoiceDate: "2026-08-02", supplierId: "s2", supplierName: "ب", quantity: 100, unitPriceMinor: 800 }),
  ]);

  it("تكشف الصنف المشترى بسعرين وتقدّر التوفير", () => {
    const gaps = findPriceGaps(items);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].cheapest.supplierName).toBe("ب");
    expect(gaps[0].dearest.supplierName).toBe("أ");
    expect(gaps[0].gapMinor).toBe(200);
    expect(gaps[0].potentialSavingMinor).toBe(40_000); // ٢٠٠ هللة × ٢٠٠ وحدة
  });

  it("تتجاهل الفروق التافهة", () => {
    const tiny = summarizeItems([
      line({ description: "سكر", invoiceDate: "2026-08-01", supplierId: "s1", supplierName: "أ", unitPriceMinor: 1000 }),
      line({ description: "سكر", invoiceDate: "2026-08-02", supplierId: "s2", supplierName: "ب", unitPriceMinor: 990 }),
    ]);
    expect(findPriceGaps(tiny)).toHaveLength(0);
  });

  it("تتجاهل ما يُشترى من مورّد واحد", () => {
    const single = summarizeItems([line({ description: "شاي", invoiceDate: "2026-08-01" })]);
    expect(findPriceGaps(single)).toHaveLength(0);
  });
});

describe("ضريبة المدخلات المعرّضة", () => {
  const rows = [
    { invoiceId: "1", supplierName: "أ", invoiceNumber: "1", invoiceDate: d("2026-08-01"), vatMinor: 1_500, inputVatEligible: true },
    { invoiceId: "2", supplierName: "ب", invoiceNumber: "2", invoiceDate: d("2026-08-02"), vatMinor: 3_000, inputVatEligible: false },
    { invoiceId: "3", supplierName: "ج", invoiceNumber: "3", invoiceDate: d("2026-08-03"), vatMinor: 900, inputVatEligible: false },
  ];

  it("تحسب المعرّض والقابل للاسترداد", () => {
    const r = vatAtRisk(rows);
    expect(r.atRiskMinor).toBe(3_900);
    expect(r.recoverableMinor).toBe(1_500);
    expect(r.atRiskCount).toBe(2);
  });

  it("ترتّب المعرّض بالأكبر ليُعالَج أولاً", () => {
    expect(vatAtRisk(rows).rows[0].vatMinor).toBe(3_000);
  });

  it("تتجاهل ما لا ضريبة فيه", () => {
    expect(vatAtRisk([
      { invoiceId: "4", supplierName: "د", invoiceNumber: "4", invoiceDate: d("2026-08-01"), vatMinor: 0, inputVatEligible: false },
    ]).atRiskCount).toBe(0);
  });
});

describe("المصروف الشهري", () => {
  it("يجمع ويرتّب زمنياً", () => {
    const s = spendByMonth([
      { periodMonth: "2026-08", totalMinor: 10_000 },
      { periodMonth: "2026-07", totalMinor: 5_000 },
      { periodMonth: "2026-08", totalMinor: 3_000 },
    ]);
    expect(s.map((x) => x.month)).toEqual(["2026-07", "2026-08"]);
    expect(s[1].totalMinor).toBe(13_000);
    expect(s[1].invoiceCount).toBe(2);
  });
});

describe("تغيّر السعر يُقارَن داخل المورّد الواحد", () => {
  it("لا يعدّ الانتقال إلى مورّد أرخص انخفاضاً في السعر", () => {
    const items = summarizeItems([
      line({ description: "حليب 2 لتر", invoiceDate: "2026-07-01", supplierId: "s1", supplierName: "الغالي", unitPriceMinor: 1000 }),
      line({ description: "حليب 2 لتر", invoiceDate: "2026-08-01", supplierId: "s2", supplierName: "الرخيص", unitPriceMinor: 800 }),
    ]);
    // مورّدان، لكل منهما سعر واحد ← لا تغيّر سعر حقيقي عند أيّهما
    expect(items[0].priceChange).toBeNull();
  });

  it("يكشف الارتفاع الحقيقي عند المورّد نفسه", () => {
    const items = summarizeItems([
      line({ description: "بن", invoiceDate: "2026-06-01", supplierId: "s1", supplierName: "أفال", unitPriceMinor: 5000 }),
      line({ description: "بن", invoiceDate: "2026-08-01", supplierId: "s1", supplierName: "أفال", unitPriceMinor: 6000 }),
    ]);
    expect(items[0].priceChange?.direction).toBe("up");
    expect(items[0].priceChangeSupplierName).toBe("أفال");
  });

  it("يتجاهل تاريخ مورّد آخر عند حساب تغيّر المورّد الحالي", () => {
    const items = summarizeItems([
      line({ description: "حليب", invoiceDate: "2026-05-01", supplierId: "s1", supplierName: "أ", unitPriceMinor: 2000 }),
      line({ description: "حليب", invoiceDate: "2026-07-01", supplierId: "s2", supplierName: "ب", unitPriceMinor: 900 }),
      line({ description: "حليب", invoiceDate: "2026-08-01", supplierId: "s2", supplierName: "ب", unitPriceMinor: 1000 }),
    ]);
    // آخر شراء من «ب»: ارتفع من ٩ إلى ١٠، لا انخفض من ٢٠
    expect(items[0].priceChangeSupplierName).toBe("ب");
    expect(items[0].priceChange?.direction).toBe("up");
    expect(items[0].priceChange?.previousMinor).toBe(900);
  });
});
