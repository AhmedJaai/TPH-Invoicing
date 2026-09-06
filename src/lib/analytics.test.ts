import { describe, expect, it } from "vitest";
import {
  ageBucket, buildAging, findSameNameCandidates, paymentStatus,
  spendByMonth, spendTrend, summarizeItems, vatAtRisk, type LineRow,
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

  it("الاسم الواحد عند مورّدين صنفان لا صنف — درس «العنب»", () => {
    const items = summarizeItems([
      line({ description: "عنب", invoiceDate: "2026-07-25", supplierId: "s1", supplierName: "المحمصة الغربية", quantity: 5, unitPriceMinor: 15_500 }),
      line({ description: "عنب", invoiceDate: "2026-07-13", supplierId: "s2", supplierName: "لافا كمبوتشا", quantity: 10, unitPriceMinor: 1_350 }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.supplierName).sort()).toEqual(["المحمصة الغربية", "لافا كمبوتشا"]);
    // ولا يُحسب لأيّهما «تغيّر سعر» من سعر الآخر
    expect(items.every((i) => i.priceChange === null)).toBe(true);
  });

  it("مفتاح الصنف يحمل المورّد", () => {
    const items = summarizeItems([
      line({ description: "بن", invoiceDate: "2026-08-01", supplierId: "s1", supplierName: "أ" }),
    ]);
    expect(items[0].key.startsWith("s1::")).toBe(true);
    expect(items[0].supplierId).toBe("s1");
  });
});

describe("أسماء تتكرّر عند مورّدين", () => {
  const items = summarizeItems([
    line({ description: "حليب 2 لتر", invoiceDate: "2026-08-01", supplierId: "s1", supplierName: "أ", quantity: 100, unitPriceMinor: 1000 }),
    line({ description: "حليب 2 لتر", invoiceDate: "2026-08-02", supplierId: "s2", supplierName: "ب", quantity: 100, unitPriceMinor: 800 }),
  ]);

  it("تُعرض مرشّحةً بالأرخص والأغلى", () => {
    const c = findSameNameCandidates(items);
    expect(c).toHaveLength(1);
    expect(c[0].cheaper.supplierName).toBe("ب");
    expect(c[0].dearer.supplierName).toBe("أ");
    expect(c[0].gapMinor).toBe(200);
    expect(c[0].gapRatio).toBeCloseTo(0.25);
  });

  it("لا تُقدَّر وفورات — تطابق الاسم لا يعني تطابق الصنف", () => {
    const c = findSameNameCandidates(items)[0] as unknown as Record<string, unknown>;
    expect(c.potentialSavingMinor).toBeUndefined();
  });

  it("الفارق الطفيف لا يُعرض", () => {
    const near = summarizeItems([
      line({ description: "سكر", invoiceDate: "2026-08-01", supplierId: "s1", supplierName: "أ", unitPriceMinor: 1000 }),
      line({ description: "سكر", invoiceDate: "2026-08-02", supplierId: "s2", supplierName: "ب", unitPriceMinor: 980 }),
    ]);
    expect(findSameNameCandidates(near)).toHaveLength(0);
  });

  it("الصنف عند مورّد واحد ليس مرشّحاً", () => {
    const one = summarizeItems([
      line({ description: "شاي", invoiceDate: "2026-08-01", supplierId: "s1", supplierName: "أ", unitPriceMinor: 1000 }),
    ]);
    expect(findSameNameCandidates(one)).toHaveLength(0);
  });
});

describe("ضريبة المدخلات المعرّضة", () => {
  const rows = [
    { invoiceId: "1", supplierName: "أ", invoiceNumber: "1", invoiceDate: d("2026-08-01"), vatMinor: 1_500, inputVatStatus: "ELIGIBLE" as const },
    { invoiceId: "2", supplierName: "ب", invoiceNumber: "2", invoiceDate: d("2026-08-02"), vatMinor: 3_000, inputVatStatus: "NOT_ELIGIBLE" as const },
    { invoiceId: "3", supplierName: "ج", invoiceNumber: "3", invoiceDate: d("2026-08-03"), vatMinor: 900, inputVatStatus: "NOT_ELIGIBLE" as const },
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
      { invoiceId: "4", supplierName: "د", invoiceNumber: "4", invoiceDate: d("2026-08-01"), vatMinor: 0, inputVatStatus: "NOT_ELIGIBLE" as const },
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
    expect(items[0].supplierName).toBe("أفال");
  });

  it("يتجاهل تاريخ مورّد آخر عند حساب تغيّر المورّد الحالي", () => {
    const items = summarizeItems([
      line({ description: "حليب", invoiceDate: "2026-05-01", supplierId: "s1", supplierName: "أ", unitPriceMinor: 2000 }),
      line({ description: "حليب", invoiceDate: "2026-07-01", supplierId: "s2", supplierName: "ب", unitPriceMinor: 900 }),
      line({ description: "حليب", invoiceDate: "2026-08-01", supplierId: "s2", supplierName: "ب", unitPriceMinor: 1000 }),
    ]);
    // «ب» صنف مستقلّ: ارتفع من ٩ إلى ١٠، ولا يُقارن بسعر «أ» إطلاقاً
    const b = items.find((i) => i.supplierName === "ب")!;
    expect(b.priceChange?.direction).toBe("up");
    expect(b.priceChange?.previousMinor).toBe(900);
    const a = items.find((i) => i.supplierName === "أ")!;
    expect(a.priceChange).toBeNull();
  });
});

describe("ضريبة معرّضة: المجهول لا يُحسب صفراً", () => {
  const row = (
    id: string,
    vatMinor: number | null,
    inputVatStatus: "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN",
  ) => ({
    invoiceId: id, supplierName: "أ", invoiceNumber: id,
    invoiceDate: new Date("2026-08-01T00:00:00Z"), vatMinor, inputVatStatus,
  });

  it("المجهول يُعدّ على حدة ولا يدخل المعرّض", () => {
    const v = vatAtRisk([
      row("a", 1_500, "NOT_ELIGIBLE"),
      row("b", null, "UNKNOWN"),
      row("c", null, "UNKNOWN"),
      row("d", 2_000, "ELIGIBLE"),
    ]);
    expect(v.atRiskMinor).toBe(1_500);
    expect(v.atRiskCount).toBe(1);
    expect(v.unknownCount).toBe(2);
    expect(v.recoverableMinor).toBe(2_000);
  });

  it("كل الفواتير مجهولة ← معرّض صفر، لكن المجهول معلَن لا مخفيّ", () => {
    const v = vatAtRisk([row("a", null, "UNKNOWN"), row("b", null, "UNKNOWN")]);
    expect(v.atRiskMinor).toBe(0);
    expect(v.unknownCount).toBe(2);
  });

  it("الضريبة الصفرية على فاتورة غير صالحة لا تُعدّ معرّضة — لا شيء يُخسر", () => {
    const v = vatAtRisk([row("a", 0, "NOT_ELIGIBLE")]);
    expect(v.atRiskCount).toBe(0);
  });

  it("يرتّب المعرّض بالأكبر ليُعالَج أوّلاً", () => {
    const v = vatAtRisk([row("a", 500, "NOT_ELIGIBLE"), row("b", 9_000, "NOT_ELIGIBLE")]);
    expect(v.rows[0].invoiceNumber).toBe("b");
  });
});

describe("spendTrend — الشهر الجاري يُقارَن بمثله", () => {
  const row = (periodMonth: string, day: number, totalMinor: number) => ({
    periodMonth,
    invoiceDate: new Date(Date.UTC(+periodMonth.slice(0, 4), +periodMonth.slice(5, 7) - 1, day)),
    totalMinor,
  });

  /*
    ستّة أيّامٍ من سبتمبر مقابل أغسطس كاملاً كانت تعطي «▼ ٩٨٪».
    والمقارنة الصادقة: أوّل ستّة أيّامٍ بأوّل ستّة.
  */
  it("يقصّ الشهر السابق عند يوم اليوم حين يكون الجاري ناقصاً", () => {
    const rows = [
      row("2026-08", 3, 500_00), row("2026-08", 20, 4000_00),
      row("2026-09", 2, 400_00),
    ];
    const t = spendTrend(rows, new Date(Date.UTC(2026, 8, 6)));
    expect(t.basisDays).toBe(6);
    // 400 مقابل 500 — لا 400 مقابل 4500
    expect(t.pct).toBeCloseTo(-0.2, 5);
  });

  it("الشهر التامّ يُقارَن بالشهر كلّه", () => {
    const rows = [
      row("2026-07", 3, 1000_00), row("2026-07", 25, 1000_00),
      row("2026-08", 5, 1000_00),
    ];
    const t = spendTrend(rows, new Date(Date.UTC(2026, 8, 6)));
    expect(t.basisDays).toBeNull();
    expect(t.pct).toBeCloseTo(-0.5, 5);
  });

  it("بلا أساس لا نسبة — ولا يُخترَع صفر", () => {
    const rows = [row("2026-09", 2, 400_00)];
    expect(spendTrend(rows, new Date(Date.UTC(2026, 8, 6))).pct).toBeNull();
  });
});
