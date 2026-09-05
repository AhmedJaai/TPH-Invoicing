import { describe, expect, it } from "vitest";
import {
  DATE_WINDOW_DAYS, MAX_GROUP_SIZE,
  amountScore, dateScore, findSubsets, generateCandidates, referenceScore,
  type MatchInput, type OpenInvoice,
} from "./candidates";

const day = (d: string) => new Date(`${d}T00:00:00Z`);

function inv(over: Partial<OpenInvoice> & { id: string }): OpenInvoice {
  const total = over.totalMinor ?? over.outstandingMinor ?? 1_000_00;
  return {
    supplierId: "S1",
    invoiceNumber: null,
    invoiceDate: day("2026-08-10"),
    periodMonth: "2026-08",
    totalMinor: total,
    outstandingMinor: over.outstandingMinor ?? total,
    ...over,
  };
}

function tx(over: Partial<MatchInput> = {}): MatchInput {
  return {
    transactionId: "T1",
    valueDate: day("2026-08-12"),
    amountMinor: 1_000_00,
    supplierId: "S1",
    supplierScore: 0.9,
    references: [],
    ...over,
  };
}

describe("amountScore", () => {
  it("التطابق تامّ، والهللة تُغتفَر", () => {
    expect(amountScore(1_000_00, 1_000_00)).toBe(1);
    expect(amountScore(1_000_01, 1_000_00)).toBe(1);
  });

  it("ينهار بعد عُشر القيمة", () => {
    expect(amountScore(1_100_00, 1_000_00)).toBe(0);
    expect(amountScore(1_050_00, 1_000_00)).toBeCloseTo(0.5, 2);
  });

  it("لا درجة لمبلغ مستحقّ صفر", () => {
    expect(amountScore(100, 0)).toBe(0);
  });
});

describe("dateScore", () => {
  it("اليوم نفسه تامّ", () => {
    expect(dateScore(day("2026-08-10"), day("2026-08-10"))).toBe(1);
  });

  it("خارج النافذة صفر", () => {
    const far = new Date(day("2026-08-10").getTime() + (DATE_WINDOW_DAYS + 1) * 86400000);
    expect(dateScore(far, day("2026-08-10"))).toBe(0);
  });

  it("قبل الفاتورة كبعدها", () => {
    expect(dateScore(day("2026-08-05"), day("2026-08-10")))
      .toBe(dateScore(day("2026-08-15"), day("2026-08-10")));
  });
});

describe("referenceScore", () => {
  it("المطابقة التامّة", () => {
    expect(referenceScore(["260342"], "260342")).toBe(1);
  });

  it("الاحتواء أضعف من التطابق", () => {
    expect(referenceScore(["99260342"], "260342")).toBe(0.7);
  });

  it("الرقم القصير لا يُطابَق به — يقع بالمصادفة", () => {
    expect(referenceScore(["123"], "123")).toBe(0);
  });

  it("بلا رقم فاتورة لا درجة", () => {
    expect(referenceScore(["260342"], null)).toBe(0);
  });
});

describe("findSubsets", () => {
  it("تجد مجموعةً من ستّ فواتير — وهو ما عجز عنه السقف القديم", () => {
    const six = [650, 940, 1230, 480, 770, 1100].map((v, i) =>
      inv({ id: `i${i}`, outstandingMinor: v * 100 }));
    const target = six.reduce((s, i) => s + i.outstandingMinor, 0);
    const found = findSubsets(six, target);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toHaveLength(6);
  });

  it("تجد المجموعة داخل بركة أكبر من أربع عشرة فاتورة", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      inv({ id: `i${i}`, outstandingMinor: (i + 1) * 100_00 }));
    // ٢٠٠ + ٥٠٠ + ٩٠٠ = ١٦٠٠
    const found = findSubsets(many, 1_600_00);
    expect(found.length).toBeGreaterThan(0);
    for (const s of found) {
      const sum = s.reduce((a, i) => a + i.outstandingMinor, 0);
      expect(Math.abs(sum - 1_600_00)).toBeLessThanOrEqual(100);
    }
  });

  it("لا تتجاوز حدّ حجم المجموعة", () => {
    const many = Array.from({ length: 20 }, (_, i) => inv({ id: `i${i}`, outstandingMinor: 100 }));
    for (const s of findSubsets(many, 2_000)) {
      expect(s.length).toBeLessThanOrEqual(MAX_GROUP_SIZE);
    }
  });

  it("تتجاهل الفواتير المسدَّدة", () => {
    const rows = [inv({ id: "paid", outstandingMinor: 0 }), inv({ id: "open", outstandingMinor: 500_00 })];
    const found = findSubsets(rows, 500_00);
    expect(found.every((s) => s.every((i) => i.id !== "paid"))).toBe(true);
  });

  it("لا شيء يطابق فلا مجموعة", () => {
    expect(findSubsets([inv({ id: "a", outstandingMinor: 100_00 })], 999_999_00)).toEqual([]);
  });
});

describe("generateCandidates", () => {
  it("بلا مورّد مرجَّح لا مرشّح — لا تُخمَّن الفاتورة", () => {
    expect(generateCandidates(tx({ supplierId: null }), [inv({ id: "a" })])).toEqual([]);
  });

  it("لا يُرشَّح ما ليس لهذا المورّد", () => {
    const c = generateCandidates(tx(), [inv({ id: "other", supplierId: "S2" })]);
    expect(c).toEqual([]);
  });

  it("الفاتورة بمبلغها تُسمّى فاتورةً بعينها", () => {
    const [c] = generateCandidates(tx(), [inv({ id: "a", outstandingMinor: 1_000_00 })]);
    expect(c.outcome).toBe("EXACT_INVOICE");
    expect(c.parts.amount).toBe(1);
  });

  it("السداد الجزئي يُعرَف ويُسمّى — وكان يضيع", () => {
    const [c] = generateCandidates(
      tx({ amountMinor: 2_000_00 }),
      [inv({ id: "a", outstandingMinor: 5_000_00 })],
    );
    expect(c).toBeUndefined(); // الفرق أكبر من عُشر القيمة فلا يُرشَّح بلا مرجع

    const [withRef] = generateCandidates(
      tx({ amountMinor: 2_000_00, references: ["260342"] }),
      [inv({ id: "a", outstandingMinor: 5_000_00, invoiceNumber: "260342" })],
    );
    expect(withRef.outcome).toBe("PARTIAL_PAYMENT");
    expect(withRef.allocatedMinor).toBe(2_000_00);
  });

  it("الزيادة تُسمّى زيادةً لا مطابقة", () => {
    // خمسون ريالاً على فاتورة بألف: فوق حدّ الرسم (اثنان في المئة) فهي زيادة
    const [c] = generateCandidates(
      tx({ amountMinor: 1_050_00 }),
      [inv({ id: "a", outstandingMinor: 1_000_00 })],
    );
    expect(c.outcome).toBe("OVERPAYMENT");
    expect(c.allocatedMinor).toBe(1_000_00);
  });

  /*
    والزيادةُ التي في حدّ رسم التحويل ليست زيادة.

    كانت تُسمّى `OVERPAYMENT` فتُرفَع إلى المراجعة عمداً لأنّها «تغيّر
    الرصيد» — فيُراجَع يدوياً ما يعرفه النظام يقيناً: خمسة آلاف وعشرون
    على فاتورة بخمسة آلاف هي الفاتورة ورسمُ تحويلها.
  */
  it("الزيادة في حدّ رسم التحويل مطابقةٌ تامّة", () => {
    const [c] = generateCandidates(
      tx({ amountMinor: 1_020_00 }),
      [inv({ id: "a", outstandingMinor: 1_000_00 })],
    );
    expect(c.outcome).toBe("EXACT_INVOICE");
    expect(c.parts.amount).toBe(1);
    expect(c.allocatedMinor).toBe(1_000_00);
    expect(c.evidence.some((e) => e.includes("رسم تحويل"))).toBe(true);
  });

  it("وما جاوز الحدّ لا يُفترَض رسماً", () => {
    // التسامح الذي يبتلع كل فرق يُخفي أخطاءً بدل أن يُصلحها
    const [c] = generateCandidates(
      tx({ amountMinor: 1_500_00 }),
      [inv({ id: "a", outstandingMinor: 1_000_00 })],
    );
    expect(c?.outcome ?? "OVERPAYMENT").toBe("OVERPAYMENT");
  });

  it("المجموعة تُرشَّح ويُذكر عددها", () => {
    const rows = [
      inv({ id: "a", outstandingMinor: 1_200_00 }),
      inv({ id: "b", outstandingMinor: 800_00 }),
    ];
    const c = generateCandidates(tx({ amountMinor: 2_000_00 }), rows)
      .find((x) => x.outcome === "MULTI_INVOICE")!;
    expect(c.invoiceIds).toHaveLength(2);
    expect(c.evidence.join(" ")).toContain("2 فواتير");
  });

  it("الفاتورة الواحدة تسبق المجموعة عند تساوي المبلغ", () => {
    const rows = [
      inv({ id: "single", outstandingMinor: 2_000_00 }),
      inv({ id: "a", outstandingMinor: 1_200_00 }),
      inv({ id: "b", outstandingMinor: 800_00 }),
    ];
    const [top] = generateCandidates(tx({ amountMinor: 2_000_00 }), rows);
    expect(top.invoiceIds).toEqual(["single"]);
  });

  it("لكل مرشّح دليلٌ مكتوب يُعرَض للمستخدم", () => {
    const all = generateCandidates(tx(), [inv({ id: "a", outstandingMinor: 1_000_00 })]);
    for (const c of all) expect(c.evidence.length).toBeGreaterThan(0);
  });

  it("النتيجة مرتّبة تنازلياً بالدرجة", () => {
    const rows = [
      inv({ id: "near", outstandingMinor: 1_000_00 }),
      inv({ id: "far", outstandingMinor: 1_040_00 }),
    ];
    const all = generateCandidates(tx(), rows);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].score).toBeGreaterThanOrEqual(all[i].score);
    }
  });
});

describe("المعايرة — المرجع مؤيِّد لا نافٍ", () => {
  /**
   * أوصاف الأهلي تحمل مراجع البنك — رقم سداد أو حوالة أو هوية — لا
   * أرقام فواتير المورّدين. فكان عدم تطابقها يُحسَب حجّةً ضدّ المطابقة،
   * فسقفُ أي مطابقة ٠٫٨٣ ولو تطابق المبلغ تماماً وأكّد إنسانٌ المورّد —
   * أي أنّ التلقائية كانت مستحيلة بحكم المعايرة لا بحكم الشكّ.
   */
  it("مرجعٌ بنكيّ لا يطابق رقم الفاتورة لا يخفض الدرجة", () => {
    const rows = [inv({ id: "a", outstandingMinor: 1_000_00, invoiceNumber: "260342" })];
    const withBankRef = generateCandidates(tx({ references: ["6959405833"] }), rows)[0];
    const withNoRef = generateCandidates(tx({ references: [] }), rows)[0];
    expect(withBankRef.score).toBeCloseTo(withNoRef.score, 6);
  });

  it("والمطابق يرفعها", () => {
    const rows = [inv({ id: "a", outstandingMinor: 1_000_00, invoiceNumber: "260342" })];
    const matched = generateCandidates(tx({ references: ["260342"] }), rows)[0];
    const plain = generateCandidates(tx({ references: [] }), rows)[0];
    expect(matched.score).toBeGreaterThan(plain.score);
  });

  it("مورّد مؤكَّد ومبلغ مطابق وتاريخ قريب يبلغ حدّ التلقائية", () => {
    const rows = [inv({ id: "a", outstandingMinor: 1_000_00, invoiceDate: day("2026-08-11") })];
    const [c] = generateCandidates(tx({ supplierScore: 0.95 }), rows);
    expect(c.score).toBeGreaterThanOrEqual(0.85);
  });
});
