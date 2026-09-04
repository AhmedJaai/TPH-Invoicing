import { describe, expect, it } from "vitest";
import {
  MATCH_TOLERANCE_PCT,
  deriveFromBank,
  expectedVsActual,
  isExpenseCategory,
  suspectedSupplierExpenses,
  looksLikeGoodsPurchase,
  matchRecurring,
  monthlyShare,
  periodOf,
  totalActual,
  totalExpected,
  unmetRecurring,
  type BankTx,
  type Expense,
  type RecurringExpense,
} from "./expenses";

function tx(over: Partial<BankTx> & { id: string }): BankTx {
  return {
    valueDate: new Date("2026-09-05T00:00:00Z"),
    description: "وصف",
    beneficiaryRaw: null,
    amountMinor: 1_000_00,
    direction: "DEBIT",
    category: "RENT",
    ...over,
  };
}

function exp(over: Partial<Expense> & { id: string }): Expense {
  return {
    periodMonth: "2026-09",
    occurredOn: "2026-09-05",
    category: "RENT",
    label: "إيجار",
    amountMinor: 1_000_00,
    source: "BANK",
    ...over,
  };
}

function rec(over: Partial<RecurringExpense> & { id: string }): RecurringExpense {
  return {
    label: "إيجار",
    category: "RENT",
    amountMinor: 1_000_00,
    cadence: "MONTHLY",
    isActive: true,
    ...over,
  };
}

describe("isExpenseCategory", () => {
  it("سداد المورّد ليس مصروفاً — فهو محسوبٌ في المشتريات", () => {
    expect(isExpenseCategory("SUPPLIER")).toBe(false);
  });

  it("الحركة الداخلية ليست مصروفاً — لا مال خرج", () => {
    expect(isExpenseCategory("INTERNAL")).toBe(false);
  });

  it("السحب الشخصي توزيعٌ لا مصروف تشغيليّ", () => {
    expect(isExpenseCategory("PERSONAL")).toBe(false);
  });

  it("المجهول لا يُقيَّد بابَ حساب", () => {
    expect(isExpenseCategory("UNKNOWN")).toBe(false);
  });

  it("الإيجار والراتب والفاتورة مصروفات", () => {
    for (const c of ["RENT", "SALARY", "UTILITY", "GOVERNMENT", "ZAKAT", "OTHER"] as const) {
      expect(isExpenseCategory(c)).toBe(true);
    }
  });
});

describe("deriveFromBank", () => {
  it("الوارد لا يُقيَّد مصروفاً", () => {
    expect(deriveFromBank([tx({ id: "a", direction: "CREDIT" })]).candidates).toEqual([]);
  });

  it("سداد المورّد يُستبعَد كي لا يُحسب مرّتين", () => {
    const out = deriveFromBank([
      tx({ id: "supplier", category: "SUPPLIER" }),
      tx({ id: "rent", category: "RENT" }),
    ]).candidates;
    expect(out.map((c) => c.bankTransactionId)).toEqual(["rent"]);
  });

  it("ما قُيّد من قبل لا يُقيَّد ثانيةً", () => {
    const txs = [tx({ id: "a" }), tx({ id: "b" })];
    const out = deriveFromBank(txs, new Set(["a"])).candidates;
    expect(out).toHaveLength(1);
    expect(out[0].bankTransactionId).toBe("b");
  });

  it("تشغيل الاشتقاق مرّتين لا يضاعف شيئاً", () => {
    const txs = [tx({ id: "a" }), tx({ id: "b" })];
    const first = deriveFromBank(txs).candidates;
    const second = deriveFromBank(txs, new Set(first.map((c) => c.bankTransactionId)));
    expect(second.candidates).toEqual([]);
  });

  it("المبلغ يُقيَّد موجباً مهما ورد", () => {
    const out = deriveFromBank([tx({ id: "a", amountMinor: -500_00 })]).candidates;
    expect(out[0].amountMinor).toBe(500_00);
  });

  it("حركة بصفر لا تُقيَّد", () => {
    expect(deriveFromBank([tx({ id: "a", amountMinor: 0 })]).candidates).toEqual([]);
  });

  it("الاسم من المستفيد ثمّ الوصف ثمّ اسم التصنيف", () => {
    expect(deriveFromBank([tx({ id: "a", beneficiaryRaw: "  شركة الإيجار " })]).candidates[0].label)
      .toBe("شركة الإيجار");
    expect(deriveFromBank([tx({ id: "b", beneficiaryRaw: "   ", description: "دفعة" })]).candidates[0].label)
      .toBe("دفعة");
    expect(deriveFromBank([tx({ id: "c", beneficiaryRaw: null, description: null })]).candidates[0].label)
      .toBe("إيجار");
  });

  it("الشهر يُشتقّ من تاريخ الحركة", () => {
    const out = deriveFromBank([tx({ id: "a", valueDate: new Date("2026-01-31T22:00:00Z") })]).candidates;
    expect(out[0].periodMonth).toBe("2026-01");
    expect(out[0].occurredOn).toBe("2026-01-31");
  });
});

describe("شراء البضاعة يُقدَّم على التصنيف", () => {
  it("وصفٌ يقول شراء بضاعة لا يُقيَّد مصروفاً ولو صنّفته القاعدة راتباً", () => {
    const out = deriveFromBank([
      tx({ id: "goods", category: "SALARY", description: "سالم باحاج شراء بضاعة 121788" }),
    ]);
    expect(out.candidates).toEqual([]);
    expect(out.goodsPurchases.map((g) => g.bankTransactionId)).toEqual(["goods"]);
  });

  it("يُلتقَط من اسم المستفيد أيضاً لا من الوصف وحده", () => {
    const out = deriveFromBank([
      tx({ id: "g", category: "OTHER", description: null, beneficiaryRaw: "شراء بضاعه" }),
    ]);
    expect(out.candidates).toEqual([]);
    expect(out.goodsPurchases).toHaveLength(1);
  });

  it("الراتب الصريح يبقى مصروفاً", () => {
    const out = deriveFromBank([
      tx({ id: "s", category: "SALARY", description: "البراء الجعيدي BV:رواتب شهرية" }),
    ]);
    expect(out.candidates).toHaveLength(1);
    expect(out.goodsPurchases).toEqual([]);
  });

  it("يُحفظ مبلغه واسمه كي يُعرَض السبب لا أن يختفي بصمت", () => {
    const out = deriveFromBank([
      tx({ id: "g", category: "SALARY", beneficiaryRaw: "مخبز", description: "شراء بضاعة", amountMinor: 3_500_00 }),
    ]);
    expect(out.goodsPurchases[0]).toEqual({
      bankTransactionId: "g",
      label: "مخبز",
      amountMinor: 3_500_00,
    });
  });
});

describe("looksLikeGoodsPurchase", () => {
  it("تتجاهل حالة الأحرف وتقبل الإملاءين", () => {
    expect(looksLikeGoodsPurchase("GOODS PURCHASE")).toBe(true);
    expect(looksLikeGoodsPurchase("شراء بضاعه")).toBe(true);
  });

  it("لا تُطلق على ما ليس منه", () => {
    expect(looksLikeGoodsPurchase("رواتب شهرية", null)).toBe(false);
    expect(looksLikeGoodsPurchase(null, undefined)).toBe(false);
  });
});

describe("monthlyShare", () => {
  it("الشهريّ كما هو، والربعيّ على ثلاثة، والسنويّ على اثني عشر", () => {
    expect(monthlyShare({ amountMinor: 300, cadence: "MONTHLY" })).toBe(300);
    expect(monthlyShare({ amountMinor: 300, cadence: "QUARTERLY" })).toBe(100);
    expect(monthlyShare({ amountMinor: 1200, cadence: "ANNUAL" })).toBe(100);
  });
});

describe("expectedVsActual", () => {
  it("الفرق موجب حين يُصرف أكثر من المتوقَّع", () => {
    const v = expectedVsActual(
      [rec({ id: "r", amountMinor: 7_916_00 })],
      [exp({ id: "e", amountMinor: 8_120_00 })],
      "2026-09",
    );
    expect(v[0].varianceMinor).toBe(204_00);
    expect(v[0].expectedMinor).toBe(7_916_00);
    expect(v[0].actualMinor).toBe(8_120_00);
  });

  it("لا نسبة إلى صفر", () => {
    const v = expectedVsActual([], [exp({ id: "e", category: "ZAKAT" })], "2026-09");
    expect(v[0].expectedMinor).toBe(0);
    expect(v[0].variancePct).toBeNull();
  });

  it("شهر آخر لا يدخل الحساب", () => {
    const v = expectedVsActual(
      [rec({ id: "r" })],
      [exp({ id: "e", periodMonth: "2026-08", amountMinor: 99_999_00 })],
      "2026-09",
    );
    expect(v[0].actualMinor).toBe(0);
  });

  it("المتكرّر المعطَّل لا يُتوقَّع منه شيء", () => {
    const v = expectedVsActual([rec({ id: "r", isActive: false })], [], "2026-09");
    expect(v).toEqual([]);
  });

  it("يُرتَّب بأكبر فرق مطلق", () => {
    const v = expectedVsActual(
      [rec({ id: "r1", category: "RENT", amountMinor: 100_00 }),
       rec({ id: "r2", category: "SALARY", amountMinor: 100_00 })],
      [exp({ id: "e1", category: "RENT", amountMinor: 110_00 }),
       exp({ id: "e2", category: "SALARY", amountMinor: 900_00 })],
      "2026-09",
    );
    expect(v[0].category).toBe("SALARY");
  });
});

describe("unmetRecurring", () => {
  it("تكشف الإيجار الذي لم يُدفع", () => {
    const out = unmetRecurring([rec({ id: "rent" })], [], "2026-09");
    expect(out.map((r) => r.id)).toEqual(["rent"]);
  });

  it("المربوط صراحةً يُعدّ مدفوعاً ولو نقص مبلغه", () => {
    const out = unmetRecurring(
      [rec({ id: "rent", amountMinor: 1_000_00 })],
      [exp({ id: "e", amountMinor: 10_00, recurringExpenseId: "rent" })],
      "2026-09",
    );
    expect(out).toEqual([]);
  });

  it("بلا ربط: يُعدّ مدفوعاً إن بلغ صرف بابه حصّة الشهر", () => {
    const rents = [rec({ id: "rent", amountMinor: 1_000_00 })];
    expect(unmetRecurring(rents, [exp({ id: "e", amountMinor: 1_000_00 })], "2026-09")).toEqual([]);
    expect(unmetRecurring(rents, [exp({ id: "e", amountMinor: 999_99 })], "2026-09"))
      .toHaveLength(1);
  });

  it("صرفٌ في شهر آخر لا يُبرئ هذا الشهر", () => {
    const out = unmetRecurring(
      [rec({ id: "rent" })],
      [exp({ id: "e", periodMonth: "2026-08" })],
      "2026-09",
    );
    expect(out).toHaveLength(1);
  });

  it("المعطَّل لا يُطالَب به", () => {
    expect(unmetRecurring([rec({ id: "r", isActive: false })], [], "2026-09")).toEqual([]);
  });
});

describe("matchRecurring", () => {
  it("يربط بالتصنيف والمبلغ معاً", () => {
    const m = matchRecurring(
      { category: "RENT", amountMinor: 1_000_00 },
      [rec({ id: "rent" }), rec({ id: "salary", category: "SALARY" })],
    );
    expect(m?.id).toBe("rent");
  });

  it("لا يربط راتباً بإيجار لتشابه المبلغ", () => {
    const m = matchRecurring(
      { category: "SALARY", amountMinor: 1_000_00 },
      [rec({ id: "rent", category: "RENT", amountMinor: 1_000_00 })],
    );
    expect(m).toBeNull();
  });

  it("يقبل فرقاً على الحدّ تماماً ويرفض ما جاوزه بهللة", () => {
    const list = [rec({ id: "rent", amountMinor: 1_000_00 })];
    const onEdge = 1_000_00 + (1_000_00 * MATCH_TOLERANCE_PCT) / 100; // ١١٠٬٠٠٠ هللة
    expect(matchRecurring({ category: "RENT", amountMinor: onEdge }, list)?.id).toBe("rent");
    expect(matchRecurring({ category: "RENT", amountMinor: onEdge + 1 }, list)).toBeNull();
  });

  it("يختار الأقرب حين تتزاحم المرشّحات", () => {
    const m = matchRecurring({ category: "RENT", amountMinor: 1_020_00 }, [
      rec({ id: "far", amountMinor: 1_100_00 }),
      rec({ id: "near", amountMinor: 1_000_00 }),
    ]);
    expect(m?.id).toBe("near");
  });

  it("المعطَّل لا يُربط به", () => {
    expect(matchRecurring({ category: "RENT", amountMinor: 1_000_00 },
      [rec({ id: "r", isActive: false })])).toBeNull();
  });
});

describe("المجاميع", () => {
  it("الفعليّ للشهر المطلوب وحده", () => {
    const rows = [exp({ id: "a" }), exp({ id: "b", periodMonth: "2026-08" })];
    expect(totalActual(rows, "2026-09")).toBe(1_000_00);
  });

  it("المتوقَّع يجمع الحصص الشهرية للنشط وحده", () => {
    expect(totalExpected([
      rec({ id: "a", amountMinor: 1_200_00, cadence: "ANNUAL" }),
      rec({ id: "b", amountMinor: 100_00 }),
      rec({ id: "c", amountMinor: 999_00, isActive: false }),
    ])).toBe(200_00);
  });
});

describe("periodOf", () => {
  it("بتوقيت عالمي لا محلّي", () => {
    expect(periodOf(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12");
  });
});

describe("suspectedSupplierExpenses", () => {
  it("تكشف قيداً اسمه اسم مورّد مسجَّل", () => {
    const out = suspectedSupplierExpenses(
      [exp({ id: "a", label: "لوريفا كيك", category: "SALARY" })],
      ["لوريفا كيك", "محمصة الغربية"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].supplier).toBe("لوريفا كيك");
  });

  it("تتغاضى عن اختلاف الهمزة والتاء المربوطة", () => {
    const out = suspectedSupplierExpenses(
      [exp({ id: "a", label: "مخبزة الاحمد" })],
      ["مخبزه الأحمد"],
    );
    expect(out).toHaveLength(1);
  });

  it("تلتقط الاسم داخل وصف أطول", () => {
    const out = suspectedSupplierExpenses(
      [exp({ id: "a", label: "تحويل الى هنقري مان بيكري مرجع 123" })],
      ["هنقري مان بيكري"],
    );
    expect(out).toHaveLength(1);
  });

  it("لا تُطلق على راتب موظّف", () => {
    const out = suspectedSupplierExpenses(
      [exp({ id: "a", label: "البراء محمد الجعيدي رواتب شهرية" })],
      ["لوريفا كيك"],
    );
    expect(out).toEqual([]);
  });

  it("الاسم القصير جداً لا يُعتدّ به — يُطابق بالمصادفة", () => {
    const out = suspectedSupplierExpenses(
      [exp({ id: "a", label: "دفعة كهرباء" })],
      ["كه"],
    );
    expect(out).toEqual([]);
  });

  it("لا مورّدين فلا اشتباه", () => {
    expect(suspectedSupplierExpenses([exp({ id: "a" })], [])).toEqual([]);
  });
});
