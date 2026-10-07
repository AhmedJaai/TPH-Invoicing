import { describe, expect, it } from "vitest";
import {
  DATE_WINDOW_DAYS, MAX_GROUP_SIZE,
  amountScore, dateScore, findSubsets, generateCandidates, instalmentPercent, rankPool, referenceScore,
  searchCandidates, searchSubsets,
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

  /*
    كان القياس بالقيمة المطلقة فيستوي ما قبل الفاتورة وما بعدها. وهذا
    خطأ في الواقع لا في الحساب: تصل الفاتورة ثمّ تُدفَع. فكانت تُرجَّح
    فاتورةٌ لم تكن قد صدرت يوم الدفع على فاتورةٍ صدرت قبله بشهر —
    ويُنسَب سدادٌ إلى ما لم يكن موجوداً حين وقع.
  */
  it("الفاتورة قبل الدفعة أرجح منها بعدها", () => {
    const before = dateScore(day("2026-08-15"), day("2026-08-10"));
    const after = dateScore(day("2026-08-05"), day("2026-08-10"));
    expect(before).toBeGreaterThan(after);
  });

  it("الفاتورة بعد الدفعة بأسبوعين مستحيلة", () => {
    expect(dateScore(day("2026-08-01"), day("2026-08-15"))).toBe(0);
  });

  it("وبعدها بيومٍ ممكنةٌ لا مرجَّحة — قد يُدفَع اليوم وتصدر غداً", () => {
    const d = dateScore(day("2026-08-10"), day("2026-08-11"));
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(0.5);
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
    /* المثنّى يحمل عدده، فلا يُكتب معه رقم: «فاتورتان» لا «٢ فواتير» */
    expect(c.evidence.join(" ")).toContain("فاتورتان مجموعها");
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

describe("ترتيب بركة البحث بالصلة", () => {
  const oi = (id: string, amount: number, date: string): OpenInvoice => ({
    id, supplierId: "S1", invoiceNumber: null,
    invoiceDate: day(date), periodMonth: date.slice(0, 7),
    totalMinor: amount, outstandingMinor: amount,
  });

  /*
    الفاتورة التي تجاوز متبقّيها الدفعةَ لا تدخل مجموعةً مجموعُها
    الدفعة — رياضةً لا ترجيحاً. وكانت تُرتَّب أوّلاً لأنّها الأكبر،
    فتزاحم الصغار على المواضع الأربعين.
  */
  it("ما جاوز الدفعة يخرج — حذفُ المستحيل لا تقريب", () => {
    const pool = rankPool(
      [oi("big", 50_000_00, "2026-08-01"), oi("fit", 500_00, "2026-08-01")],
      1_000_00, day("2026-08-05"),
    );
    expect(pool.map((i) => i.id)).toEqual(["fit"]);
  });

  it("الأقرب تاريخاً يسبق الأكبر مبلغاً", () => {
    const pool = rankPool(
      [oi("far", 900_00, "2026-06-01"), oi("near", 100_00, "2026-08-04")],
      1_000_00, day("2026-08-05"),
    );
    expect(pool[0].id).toBe("near");
  });

  it("بلا تاريخٍ للدفعة يُرتَّب بالحجم — كما كان", () => {
    const pool = rankPool(
      [oi("small", 100_00, "2026-08-04"), oi("large", 900_00, "2026-06-01")],
      1_000_00, null,
    );
    expect(pool[0].id).toBe("large");
  });

  it("مجموعةٌ صغيرة قريبة تُوجَد ولو زاحمها ستّون كبيرة", () => {
    const noise = Array.from({ length: 60 }, (_, i) =>
      oi(`n${i}`, 30_000_00 + i, "2026-05-01"));
    const wanted = [oi("a", 300_00, "2026-08-04"), oi("b", 700_00, "2026-08-03")];
    const subsets = findSubsets([...noise, ...wanted], 1_000_00, 100, 8, day("2026-08-05"));
    expect(subsets.some((s) => s.length === 2 && s.every((i) => ["a", "b"].includes(i.id))))
      .toBe(true);
  });
});


describe("searchSubsets — بحثٌ بحدٍّ معلَن", () => {
  it("بركةٌ صغيرةُ الفواتير لا مجموعةَ فيها تنتهي بالقطع لا بالعدّ", () => {
    /* أربعون فاتورةً بمئة ريال ودفعةٌ بمليون: أكبرُ ما يُبلَغ ٨٠٠ — يُقطَع من أوّل فرع */
    const many = Array.from({ length: 40 }, (_, i) => inv({ id: `i${i}`, outstandingMinor: 100_00 + i }));
    const started = Date.now();
    const r = searchSubsets(many, 3_999_00);
    expect(r.subsets).toEqual([]);
    expect(r.exhausted).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("وما لا يُقطَع يقف عند ميزانيّته ويُعلن", () => {
    /* مبالغُ متباعدةٌ لا تجتمع على الهدف، والهدفُ في وسط المدى فلا قطعَ مبكّراً */
    const many = Array.from({ length: 40 }, (_, i) =>
      inv({ id: `i${String(i).padStart(2, "0")}`, outstandingMinor: 1_000_00 + i * 7_919 + 211 }));
    const r = searchSubsets(many, 17_777_53, { toleranceMinor: 0, nodeBudget: 2_000 });
    expect(r.exhausted).toBe(true);
  });

  it("الأصغرُ عدداً يُعاد أوّلاً", () => {
    const rows = [
      inv({ id: "big", outstandingMinor: 900_00 }),
      inv({ id: "x", outstandingMinor: 600_00 }),
      inv({ id: "y", outstandingMinor: 300_00 }),
      inv({ id: "a", outstandingMinor: 500_00 }),
      inv({ id: "b", outstandingMinor: 250_00 }),
      inv({ id: "c", outstandingMinor: 150_00 }),
    ];
    const { subsets } = searchSubsets(rows, 900_00);
    expect(subsets[0].map((i) => i.id)).toEqual(["big"]);
    expect(subsets[1]).toHaveLength(2);
    for (let i = 1; i < subsets.length; i++) {
      expect(subsets[i].length).toBeGreaterThanOrEqual(subsets[i - 1].length);
    }
  });

  it("المتساوياتُ صنفٌ واحد يُؤخَذ بالأقدم — لا خمسٌ وأربعون مجموعةً متكافئة", () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      inv({ id: `d${i}`, outstandingMinor: 350_00, invoiceDate: day(`2026-08-${String(i + 1).padStart(2, "0")}`) }));
    const { subsets } = searchSubsets(ten, 700_00);
    expect(subsets).toHaveLength(1);
    expect(subsets[0].map((i) => i.id).sort()).toEqual(["d0", "d1"]);
  });
});

describe("فواتير متساوية المبلغ", () => {
  const ten = Array.from({ length: 10 }, (_, i) =>
    inv({
      id: `d${i}`, outstandingMinor: 350_00, invoiceNumber: `77${i}0${i}`,
      invoiceDate: day(`2026-08-${String(i + 1).padStart(2, "0")}`),
    }));

  it("دفعةٌ تسدّد واحدةً من عشر: مرشّحٌ واحد هو الأقدم، موسومٌ بالتباسه", () => {
    const all = generateCandidates(tx({ amountMinor: 350_00 }), ten);
    expect(all).toHaveLength(1);
    expect(all[0].invoiceIds).toEqual(["d0"]);
    expect(all[0].ambiguity).toContain("بالمبلغ نفسه");
  });

  it("والمرجعُ يعيّنها فلا التباس", () => {
    const all = generateCandidates(tx({ amountMinor: 350_00, references: ["77404"] }), ten);
    expect(all[0].invoiceIds).toEqual(["d4"]);
    expect(all[0].ambiguity).toBeUndefined();
  });

  it("ومن سدّد الصنفَ كلَّه لم يلتبس عليه شيء", () => {
    const two = ten.slice(0, 2);
    const group = generateCandidates(tx({ amountMinor: 700_00 }), two)
      .find((c) => c.invoiceIds.length === 2)!;
    expect(group.ambiguity).toBeUndefined();
  });
});

describe("المجموعة ورسمُ تحويلها", () => {
  const three = [
    inv({ id: "a", outstandingMinor: 1_800_00 }),
    inv({ id: "b", outstandingMinor: 1_450_00 }),
    inv({ id: "c", outstandingMinor: 1_250_00 }),
  ];

  it("ثلاث فواتير وعشرون ريالاً رسماً تُوجَد — وكانت «لا فاتورة تقابله»", () => {
    const all = generateCandidates(tx({ amountMinor: 4_520_00 }), three);
    const group = all.find((c) => c.invoiceIds.length === 3)!;
    expect(group.outcome).toBe("MULTI_INVOICE");
    expect(group.parts.amount).toBe(1);
    expect(group.allocatedMinor).toBe(4_500_00);
    expect(group.evidence.join(" ")).toContain("رسم تحويل 20.00");
  });

  it("وما جاوز حدّ الرسم لا يُفترَض", () => {
    const all = generateCandidates(tx({ amountMinor: 4_600_00 }), three);
    expect(all.find((c) => c.invoiceIds.length === 3)).toBeUndefined();
  });

  it("ولا يُبحَث عن رسمٍ حين توجد مطابقةٌ تامّة", () => {
    const rows = [...three, inv({ id: "exact", outstandingMinor: 4_520_00 })];
    const all = generateCandidates(tx({ amountMinor: 4_520_00 }), rows);
    expect(all.find((c) => c.invoiceIds.length === 3)).toBeUndefined();
    expect(all[0].invoiceIds).toEqual(["exact"]);
  });
});

describe("مجموعةٌ تنقص عنها الدفعة", () => {
  it("بستّين هللةً تُسمّى سداداً جزئيّاً — فلا تُحسَم وتترك فاتورةً مفتوحةً بهللات", () => {
    const rows = [
      inv({ id: "a", outstandingMinor: 1_200_00 }),
      inv({ id: "b", outstandingMinor: 800_60 }),
    ];
    const group = generateCandidates(tx({ amountMinor: 2_000_00 }), rows)
      .find((c) => c.invoiceIds.length === 2)!;
    expect(group.outcome).toBe("PARTIAL_PAYMENT");
    expect(group.evidence.join(" ")).toContain("تنقص عن المجموع 0.60");
  });

  it("وبهللةٍ واحدة تبقى مجموعةً بمبلغها", () => {
    const rows = [
      inv({ id: "a", outstandingMinor: 1_200_00 }),
      inv({ id: "b", outstandingMinor: 800_01 }),
    ];
    const group = generateCandidates(tx({ amountMinor: 2_000_00 }), rows)
      .find((c) => c.invoiceIds.length === 2)!;
    expect(group.outcome).toBe("MULTI_INVOICE");
  });
});

describe("القسط والعربون", () => {
  it("نصفُ الفاتورة تماماً يُرشَّح سداداً جزئيّاً — وكان لا يظهر أبداً", () => {
    const all = generateCandidates(
      tx({ amountMinor: 2_500_00, supplierScore: 1 }),
      [inv({ id: "a", totalMinor: 5_000_00, outstandingMinor: 5_000_00 })],
    );
    expect(all).toHaveLength(1);
    expect(all[0].outcome).toBe("PARTIAL_PAYMENT");
    expect(all[0].allocatedMinor).toBe(2_500_00);
    expect(all[0].score).toBeGreaterThanOrEqual(0.5);
    expect(all[0].evidence.join(" ")).toContain("50٪ من إجماليّ الفاتورة (5,000.00)");
  });

  it("ونسبةٌ غير مألوفة لا تُرشَّح", () => {
    expect(generateCandidates(
      tx({ amountMinor: 2_100_00 }),
      [inv({ id: "a", totalMinor: 5_000_00, outstandingMinor: 5_000_00 })],
    )).toEqual([]);
  });

  it("النسبة تُقاس بالأعداد الصحيحة ضمن هللة", () => {
    expect(instalmentPercent(333_33, 1_111_10)).toBe(30);
    expect(instalmentPercent(333_35, 1_111_10)).toBeNull();
    expect(instalmentPercent(0, 1_000_00)).toBeNull();
  });
});

describe("أرقام الأدلّة تمرّ بمنسّق المال", () => {
  it("«يبقى 1,234.50» لا «1234.5»", () => {
    const [c] = generateCandidates(
      tx({ amountMinor: 20_000_00 }),
      [inv({ id: "a", outstandingMinor: 21_234_50 })],
    );
    expect(c.evidence.join(" ")).toContain("يبقى 1,234.50 ريالاً");
  });
});

describe("فرق التاريخ بأيّام الرياض", () => {
  it("فاتورةٌ خُزّنت مساءً وحركةٌ بمنتصف الليل: الفرقُ أيّامٌ صحيحة", () => {
    /* ٢٢:٣٠ UTC يوم ٩ = ٠١:٣٠ يوم ١٠ بتوقيت الرياض */
    const stored = new Date("2026-08-09T22:30:00Z");
    expect(dateScore(day("2026-08-10"), stored)).toBe(1);
    const { candidates } = searchCandidates(
      tx({ valueDate: day("2026-08-13") }),
      [inv({ id: "a", invoiceDate: stored })],
    );
    expect(candidates[0].evidence.join(" ")).toContain("فرق التاريخ 3 أيّام");
  });
});
