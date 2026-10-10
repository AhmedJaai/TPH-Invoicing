import { describe, expect, it } from "vitest";
import { buildPaymentRun, buildSupplierMessage, resolvePayeeAccount, toBankTransferCsv, type PayableInvoice } from "./payment-run";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const inv = (o: Partial<PayableInvoice> & { invoiceId: string }): PayableInvoice => ({
  supplierId: "s1", supplierName: "أوراق الزيتون",
  invoiceNumber: o.invoiceId, invoiceDate: d("2026-08-15"),
  periodMonth: "2026-08", totalMinor: 10_000, allocatedMinor: 0,
  taxStatus: "VALID", inputVatStatus: "ELIGIBLE", vatMinor: 1_500,
  ...o,
});

describe("دفعة أوّل الشهر", () => {
  it("تجمع مستحقّات الشهر لكل مورّد", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "1", totalMinor: 10_000 }),
      inv({ invoiceId: "2", totalMinor: 5_000 }),
      inv({ invoiceId: "3", supplierId: "s2", supplierName: "بيكوف", totalMinor: 30_000 }),
    ], "2026-08");

    expect(run.ready).toHaveLength(2);
    expect(run.ready[0].supplierName).toBe("بيكوف"); // الأكبر أوّلاً
    expect(run.ready[1].totalMinor).toBe(15_000);
    expect(run.readyTotalMinor).toBe(45_000);
  });

  it("تستبعد المسدَّد وتُدرج باقي المسدَّد جزئياً", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "paid", totalMinor: 10_000, allocatedMinor: 10_000 }),
      inv({ invoiceId: "partial", totalMinor: 10_000, allocatedMinor: 4_000 }),
    ], "2026-08");

    expect(run.ready[0].invoiceCount).toBe(1);
    expect(run.readyTotalMinor).toBe(6_000);
  });

  it("تتسامح بهللة تقريب فلا تُدرج المسدَّدة", () => {
    const run = buildPaymentRun([inv({ invoiceId: "x", totalMinor: 10_000, allocatedMinor: 9_999 })], "2026-08");
    expect(run.ready).toHaveLength(0);
  });

  it("تقتصر على الشهر المطلوب افتراضياً", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "aug", periodMonth: "2026-08" }),
      inv({ invoiceId: "jul", periodMonth: "2026-07" }),
    ], "2026-08");
    expect(run.ready[0].invoiceCount).toBe(1);
  });

  it("تضمّ المتأخّرات عند الطلب", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "aug", periodMonth: "2026-08" }),
      inv({ invoiceId: "jul", periodMonth: "2026-07" }),
      inv({ invoiceId: "sep", periodMonth: "2026-09" }),
    ], "2026-08", { includeOlderUnpaid: true });
    // أغسطس وما قبله فقط — لا سبتمبر
    expect(run.ready[0].invoiceCount).toBe(2);
  });
});

describe("حجز غير الصالح ضريبياً", () => {
  it("يمنع سداد ما ليس فاتورة ضريبية", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "ok" }),
      inv({ invoiceId: "bad", taxStatus: "INVALID", inputVatStatus: "NOT_ELIGIBLE", vatMinor: 3_000 }),
    ], "2026-08");

    expect(run.ready[0].invoiceCount).toBe(1);
    expect(run.held).toHaveLength(1);
    expect(run.held[0].reason).toBe("NOT_TAX_VALID");
    expect(run.held[0].message).toContain("قبل السداد");
    expect(run.vatAtRiskMinor).toBe(3_000);
  });

  it("يحجز ما لا يصلح لخصم المدخلات ولو كان ضريبياً شكلاً", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "x", taxStatus: "VALID", inputVatStatus: "NOT_ELIGIBLE" }),
    ], "2026-08");
    expect(run.held[0].reason).toBe("NO_VAT_DEDUCTION");
    expect(run.ready).toHaveLength(0);
  });

  it("يحسب إجمالي المحجوز", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "a", taxStatus: "INVALID", totalMinor: 20_000 }),
      inv({ invoiceId: "b", taxStatus: "INVALID", totalMinor: 5_000, allocatedMinor: 2_000 }),
    ], "2026-08");
    expect(run.heldTotalMinor).toBe(23_000);
  });
});

describe("ملف التحويلات", () => {
  const run = buildPaymentRun([
    inv({ invoiceId: "1", invoiceNumber: "260302", totalMinor: 13_000 }),
    inv({ invoiceId: "2", invoiceNumber: "260310", totalMinor: 41_000 }),
  ], "2026-08");

  it("يحمل المستفيد والمبلغ وأرقام الفواتير", () => {
    const csv = toBankTransferCsv(run);
    expect(csv).toContain("أوراق الزيتون");
    expect(csv).toContain("540.00");
    expect(csv).toContain("260302 | 260310");
    expect(csv).toContain("SAR");
  });

  it("يحمل حسابَ المستفيد من أدلّة الكشف — والبنكُ لا يحوّل إلى اسم", () => {
    const sid = run.ready[0].supplierId;
    const accounts = new Map([[sid, resolvePayeeAccount([{ kind: "IBAN", normalized: "SA0380000000608010167519" }])]]);
    const line = toBankTransferCsv(run, accounts).split("\r\n")[1];
    expect(line).toContain("SA0380000000608010167519");
  });

  it("ولا حسابَ يُخمَّن: المجهولُ خارجَ قسم التحويل، بعنوانه وتنبيهه", () => {
    const lines = toBankTransferCsv(run).split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("");
    expect(lines[2]).toContain("يحتاج حساباً");
    expect(lines[3]).toContain("الحسابُ غير معروف");
  });

  it("ومن له حسابٌ في قسم التحويل وحده — لا عنوانَ ولا قسمَ ثانياً", () => {
    const sid = run.ready[0].supplierId;
    const accounts = new Map([[sid, resolvePayeeAccount([{ kind: "IBAN", normalized: "SA0380000000608010167519" }])]]);
    expect(toBankTransferCsv(run, accounts).split("\r\n")).toHaveLength(2);
  });

  it("خليّةٌ تبدأ بعلامة صيغة تُسبَق بفاصلةٍ عليا — لا تُنفَّذ في إكسل", () => {
    const evil = buildPaymentRun([
      inv({ invoiceId: "1", supplierName: "=HYPERLINK(\"http://x\")", invoiceNumber: "-1+2" }),
      inv({ invoiceId: "2", supplierId: "s2", supplierName: "@SUM(A1)", invoiceNumber: "+966" }),
    ], "2026-08");
    const accounts = new Map(evil.ready.map((r) => [r.supplierId, { account: "SA0380000000608010167519", note: null }]));
    const csv = toBankTransferCsv(evil, accounts);
    for (const line of csv.split("\r\n").slice(1)) {
      for (const cell of line.split(",")) expect(cell.replace(/^"/, "")).not.toMatch(/^[=+\-@]/);
    }
    expect(csv).toContain("'-1+2");
    expect(csv).toContain("'+966");
  });

  it("المبلغُ من الهللات نصّاً", () => {
    const one = buildPaymentRun([inv({ invoiceId: "1", totalMinor: 1_000_07 })], "2026-08");
    expect(toBankTransferCsv(one)).toContain("1000.07");
  });

  it("يبدأ بعلامة ترميز ليقرأه إكسل العربي", () => {
    expect(toBankTransferCsv(run).charCodeAt(0)).toBe(0xfeff);
  });

  it("يحمي الفواصل داخل الأسماء", () => {
    const tricky = buildPaymentRun([
      inv({ invoiceId: "1", supplierName: 'مؤسسة "أ, ب"' }),
    ], "2026-08");
    const line = toBankTransferCsv(tricky).split("\r\n")[3];
    expect(line.startsWith('"مؤسسة ""أ, ب"""')).toBe(true);
  });
});

describe("رسالة المورّد", () => {
  it("تسرد أرقام الفواتير الناقصة وتطلب البديل", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "1", invoiceNumber: "990", taxStatus: "INVALID" }),
    ], "2026-08");
    const msg = buildSupplierMessage("بيكوف", run.held, "310007971600003");
    expect(msg).toContain("بيكوف");
    expect(msg).toContain("990");
    expect(msg).toContain("310007971600003");
  });
});

describe("المجهول لا يُسدَّد ولا يُطالَب صاحبه", () => {
  const base = {
    invoiceId: "i1", supplierId: "s1", supplierName: "أوراق الزيتون",
    invoiceNumber: "260300", invoiceDate: new Date("2026-08-05T00:00:00Z"),
    periodMonth: "2026-08", totalMinor: 50_000, allocatedMinor: 0, vatMinor: null,
  };

  it("الفاتورة المجهولة تُحجَز بسبب يخصّها", () => {
    const run = buildPaymentRun(
      [{ ...base, taxStatus: "UNKNOWN", inputVatStatus: "UNKNOWN" }],
      "2026-08",
    );
    expect(run.held).toHaveLength(1);
    expect(run.held[0].reason).toBe("TAX_UNKNOWN");
    expect(run.held[0].message).toContain("اقرأ المستند");
    expect(run.ready).toHaveLength(0);
  });

  it("سبب الحجز يفرّق بين «اقرأ المستند» و«طالِب المورّد»", () => {
    const run = buildPaymentRun(
      [
        { ...base, invoiceId: "u", taxStatus: "UNKNOWN", inputVatStatus: "UNKNOWN" },
        { ...base, invoiceId: "b", taxStatus: "INVALID", inputVatStatus: "NOT_ELIGIBLE" },
      ],
      "2026-08",
    );
    const reasons = run.held.map((h) => h.reason).sort();
    expect(reasons).toEqual(["NOT_TAX_VALID", "TAX_UNKNOWN"]);
  });

  it("الضريبة المجهولة لا تُجمع في «المعرّض» كصفر", () => {
    const run = buildPaymentRun(
      [
        { ...base, invoiceId: "u", taxStatus: "UNKNOWN", inputVatStatus: "UNKNOWN" },
        { ...base, invoiceId: "b", taxStatus: "INVALID", inputVatStatus: "NOT_ELIGIBLE" },
        { ...base, invoiceId: "k", taxStatus: "INVALID", inputVatStatus: "NOT_ELIGIBLE", vatMinor: 2_000 },
      ],
      "2026-08",
    );
    // المجهولة الحال لا يُعرَف أنّ ضريبتها ضائعة؛ والناقصة بلا ضريبة مقروءة تُعَدّ ولا تُجمَع
    expect(run.vatAtRiskMinor).toBe(2_000);
    expect(run.vatAtRiskUnknown).toBe(1);
  });
});

describe("دفعة أوّل الشهر — رصيدٌ لنا عند المورّد", () => {
  it("يُخصم الرصيد من دفعة صاحبه وحده، ولا يُحوَّل ما يغطّيه", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "1", supplierId: "loreva", supplierName: "لوريفا", totalMinor: 101_200 }),
      inv({ invoiceId: "2", supplierId: "olive", supplierName: "أوراق الزيتون", totalMinor: 70_000 }),
      inv({ invoiceId: "3", supplierId: "kohi", supplierName: "كوهي", totalMinor: 50_000 }),
    ], "2026-08", { creditBySupplier: new Map([["loreva", 63_250], ["kohi", 83_375]]) });

    const loreva = run.ready.find((s) => s.supplierId === "loreva")!;
    expect(loreva.totalMinor).toBe(37_950);
    expect(loreva.creditAppliedMinor).toBe(63_250);
    expect(run.ready.find((s) => s.supplierId === "olive")!.creditAppliedMinor).toBe(0);
    expect(run.coveredByCredit.map((s) => s.supplierId)).toEqual(["kohi"]);
    expect(run.readyTotalMinor).toBe(37_950 + 70_000);
    expect(toBankTransferCsv(run)).not.toContain("كوهي");
  });
});

describe("ما قرأه النموذج ولم يُؤكَّد لا يدخل ملفّ التحويلات", () => {
  it("يُحجَز بسببه ولو كان صالحاً ضريبياً", () => {
    const run = buildPaymentRun([
      {
        invoiceId: "i-review", supplierId: "s1", supplierName: "مورّد", invoiceNumber: "1",
        invoiceDate: new Date("2026-08-10T00:00:00Z"), periodMonth: "2026-08",
        totalMinor: 50_000, allocatedMinor: 0, taxStatus: "VALID", inputVatStatus: "ELIGIBLE",
        vatMinor: 6_522, needsReview: true,
      },
    ], "2026-08");
    expect(run.ready).toHaveLength(0);
    expect(run.held[0]?.reason).toBe("NEEDS_REVIEW");
    expect(run.heldTotalMinor).toBe(50_000);
  });
});

describe("حسابُ المستفيد", () => {
  it("آيبانٌ واحد يُكتَب — ويسبق رقمَ الحساب", () => {
    expect(resolvePayeeAccount([
      { kind: "ACCOUNT", normalized: "608010167519" },
      { kind: "IBAN", normalized: "SA0380000000608010167519" },
    ])).toEqual({ account: "SA0380000000608010167519", note: null });
  });

  it("آيبانان مختلفان سؤالٌ لا يُحسَم بالحدس", () => {
    const r = resolvePayeeAccount([
      { kind: "IBAN", normalized: "SA0380000000608010167519" },
      { kind: "IBAN", normalized: "SA4420000001234567891234" },
    ]);
    expect(r.account).toBeNull();
    expect(r.note).toContain("حسابات");
  });

  it("والمكرَّرُ نفسُه ليس حسابين", () => {
    expect(resolvePayeeAccount([
      { kind: "IBAN", normalized: "SA0380000000608010167519" },
      { kind: "IBAN", normalized: "SA0380000000608010167519" },
    ]).account).toBe("SA0380000000608010167519");
  });
});


describe("حسابُ المستفيد — ما كتبه صاحبُ المقهى بيده يمضي ويُقال", () => {
  const IBAN = "SA0380000000608010167519";
  const OTHER = "SA4420000001234567891234";
  it("بلا دليلٍ في الكشوف: المكتوبُ بيد يُكتب، مع تنبيه أوّل تحويل", () => {
    const a = resolvePayeeAccount([], IBAN);
    expect(a.account).toBe(IBAN);
    expect(a.note).toContain("لم يُحوَّل له من قبل");
  });
  it("يطابق الكشف: بلا تنبيه", () => {
    expect(resolvePayeeAccount([{ kind: "IBAN", normalized: IBAN }], IBAN)).toEqual({ account: IBAN, note: null });
  });
  it("يخالف الكشف: يبقى ما كتبه — لا يُبدَّل ولا يُحجَب — ويُقال إنّه يخالف", () => {
    const a = resolvePayeeAccount([{ kind: "IBAN", normalized: OTHER }], IBAN);
    expect(a.account).toBe(IBAN);
    expect(a.note).toContain("يخالف");
  });
  it("ويحسم تعدّدَ حسابات الكشوف", () => {
    const a = resolvePayeeAccount([{ kind: "IBAN", normalized: IBAN }, { kind: "IBAN", normalized: OTHER }], OTHER);
    expect(a).toEqual({ account: OTHER, note: null });
  });
});

/* ── قاعدةُ ٧ أكتوبر ٢٠٢٦: يُنبَّه ولا يُمنَع، ولا رقمَ يُبدَّل بصمت ── */

import { afterPayment, applyPartialAmounts, holdReasonOf, isOverridableHold, transferAfterCredit } from "./payment-run";
import { distributePartial } from "./mark-paid-plan";
import { EMPTY_SELECTION, planSupplier, readSelection } from "./pay-run-selection";

describe("قرارُ المالك في المحجوز", () => {
  const heldInv = inv({ invoiceId: "h1", totalMinor: 23_000, vatMinor: 3_000, taxStatus: "INVALID" });

  it("بلا قرار: تبقى محجوزةً ولا تدخل الجاهز", () => {
    const run = buildPaymentRun([heldInv], "2026-08");
    expect(run.ready).toHaveLength(0);
    expect(run.held).toHaveLength(1);
    expect(run.overridden).toHaveLength(0);
    expect(run.vatAtRiskMinor).toBe(3_000);
  });

  it("بقراره: تدخل بمبلغها، وتُسرَد بسبب حجزها وسببه، والضريبةُ المعرّضة تبقى ظاهرة", () => {
    const run = buildPaymentRun([heldInv], "2026-08", { overrides: new Map([["h1", { note: "لا يسلّم قبل السداد" }]]) });
    expect(run.readyTotalMinor).toBe(23_000);
    expect(run.held).toHaveLength(0);
    expect(run.heldTotalMinor).toBe(0);
    expect(run.overridden).toHaveLength(1);
    expect(run.overridden[0].reason).toBe("NOT_TAX_VALID");
    expect(run.overridden[0].override?.note).toBe("لا يسلّم قبل السداد");
    /* القرارُ يُدخل الفاتورة ولا يردّ ضريبتَها */
    expect(run.vatAtRiskMinor).toBe(3_000);
  });

  it("ضريبةٌ لم تُقرأ تُعَدّ مجهولةً بعد القرار ولا تُجمَع صفراً", () => {
    const run = buildPaymentRun(
      [inv({ invoiceId: "h2", vatMinor: null, inputVatStatus: "NOT_ELIGIBLE" })],
      "2026-08",
      { overrides: new Map([["h2", { note: "متّفقٌ عليه" }]]) },
    );
    expect(run.vatAtRiskMinor).toBe(0);
    expect(run.vatAtRiskUnknown).toBe(1);
  });

  it("ما لم يُؤكَّد مستندُه لا يُدخله قرار — مبلغُه لم يره إنسان", () => {
    const run = buildPaymentRun(
      [inv({ invoiceId: "r1", needsReview: true })],
      "2026-08",
      { overrides: new Map([["r1", { note: "ادفعها" }]]) },
    );
    expect(run.ready).toHaveLength(0);
    expect(run.held[0].reason).toBe("NEEDS_REVIEW");
    expect(isOverridableHold("NEEDS_REVIEW")).toBe(false);
  });

  it("قرارٌ على فاتورةٍ صارت صالحة لا أثر له — هي في الجاهز بلا وسم", () => {
    const run = buildPaymentRun([inv({ invoiceId: "ok" })], "2026-08", { overrides: new Map([["ok", { note: "قديم" }]]) });
    expect(run.overridden).toHaveLength(0);
    expect(run.readyTotalMinor).toBe(10_000);
  });

  it("سببُ الحجز قاعدةٌ واحدة يقرؤها البناءُ ومسارُ القرار", () => {
    expect(holdReasonOf({ needsReview: false, taxStatus: "VALID", inputVatStatus: "ELIGIBLE" })).toBeNull();
    expect(holdReasonOf({ needsReview: true, taxStatus: "VALID", inputVatStatus: "ELIGIBLE" })).toBe("NEEDS_REVIEW");
    expect(holdReasonOf({ needsReview: false, taxStatus: "UNKNOWN", inputVatStatus: "ELIGIBLE" })).toBe("TAX_UNKNOWN");
    expect(holdReasonOf({ needsReview: false, taxStatus: "VALID", inputVatStatus: "NOT_ELIGIBLE" })).toBe("NO_VAT_DEDUCTION");
  });

  it("الملفُّ يسمّي ما دخل بقرار المالك في صفّ مورّده", () => {
    const run = buildPaymentRun([heldInv], "2026-08", { overrides: new Map([["h1", { note: "س" }]]) });
    const csv = toBankTransferCsv(run, new Map([["s1", { account: "SA0380000000608010167519", note: null }]]));
    expect(csv).toContain("بقرار المالك وهي محجوزة: h1");
  });
});

describe("استثناءُ فاتورةٍ واحدة", () => {
  it("المستثناةُ لا تُحوَّل، والباقي بمبلغه", () => {
    const run = buildPaymentRun(
      [inv({ invoiceId: "a", totalMinor: 10_000 }), inv({ invoiceId: "b", totalMinor: 5_000 })],
      "2026-08",
      { excludeInvoiceIds: new Set(["b"]) },
    );
    expect(run.ready[0].invoiceCount).toBe(1);
    expect(run.readyTotalMinor).toBe(10_000);
  });

  it("الرصيدُ يُخصم ممّا بقي بعد الاستثناء لا ممّا استُثني", () => {
    const run = buildPaymentRun(
      [inv({ invoiceId: "a", totalMinor: 10_000 }), inv({ invoiceId: "b", totalMinor: 5_000 })],
      "2026-08",
      { excludeInvoiceIds: new Set(["a"]), creditBySupplier: new Map([["s1", 8_000]]) },
    );
    /* بقيت فاتورةُ الخمسين، والرصيدُ ثمانون: يغطّيها كلَّها ولا يُحوَّل شيء */
    expect(run.ready).toHaveLength(0);
    expect(run.coveredByCredit[0].creditAppliedMinor).toBe(5_000);
  });

  it("استثناءُ كلّ فواتير مورّدٍ يُخرجه من الدفعة", () => {
    const run = buildPaymentRun([inv({ invoiceId: "a" })], "2026-08", { excludeInvoiceIds: new Set(["a"]) });
    expect(run.ready).toHaveLength(0);
    expect(run.coveredByCredit).toHaveLength(0);
  });
});

describe("«ادفع كذا فقط» في الملفّ", () => {
  const base = () => buildPaymentRun(
    [inv({ invoiceId: "a", totalMinor: 10_000 }), inv({ invoiceId: "z", supplierId: "s2", supplierName: "بيكوف", totalMinor: 30_000 })],
    "2026-08",
  );

  it("الجزئيُّ يُحوَّل بمبلغه ويُحفَظ الكلُّ بجانبه", () => {
    const { run, errors } = applyPartialAmounts(base(), new Map([["s2", 12_550]]));
    expect(errors).toEqual([]);
    const s2 = run.ready.find((s) => s.supplierId === "s2");
    expect(s2?.totalMinor).toBe(12_550);
    expect(s2?.fullMinor).toBe(30_000);
    expect(run.readyTotalMinor).toBe(22_550);
  });

  it("ما زاد على ما يُحوَّل يُردّ ولا يُقصّ", () => {
    const { run, errors } = applyPartialAmounts(base(), new Map([["s2", 30_001]]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("بيكوف");
    /* لم يُبدَّل شيء */
    expect(run.readyTotalMinor).toBe(40_000);
  });

  it.each([0, -500, 12.5, Number.NaN])("مبلغٌ ليس عدداً صحيحاً موجباً (%s) يُردّ", (bad) => {
    expect(applyPartialAmounts(base(), new Map([["s2", bad]])).errors).toHaveLength(1);
  });

  it("مبلغٌ يساوي الكلّ ليس جزئيّاً", () => {
    const { run, errors } = applyPartialAmounts(base(), new Map([["s2", 30_000]]));
    expect(errors).toEqual([]);
    expect(run.ready.find((s) => s.supplierId === "s2")?.fullMinor).toBeUndefined();
  });

  it("مبلغٌ لمورّدٍ ليس بين الجاهزين يُردّ", () => {
    expect(applyPartialAmounts(base(), new Map([["ghost", 100]])).errors).toHaveLength(1);
  });

  it("الملفُّ يقول المبلغين في صفّ الجزئيّ", () => {
    const { run } = applyPartialAmounts(base(), new Map([["s2", 12_550]]));
    const csv = toBankTransferCsv(run, new Map([["s2", { account: "SA0380000000608010167519", note: null }]]));
    expect(csv).toContain("بيكوف,SA0380000000608010167519,125.50,SAR");
    expect(csv).toContain("دفعٌ جزئيّ: 125.50 من 300.00");
    expect(csv).toContain("سداد جزئيّ من فواتير 2026-08");
  });
});

describe("توزيعُ السداد الجزئيّ على الفواتير — الأقدمُ أوّلاً", () => {
  const open = [
    { invoiceId: "old", openMinor: 10_000 },
    { invoiceId: "mid", openMinor: 5_000 },
    { invoiceId: "new", openMinor: 7_000 },
  ];

  it("يملأ الأقدمَ ثمّ ما يليه، ويترك ما لم يبلغه", () => {
    const r = distributePartial(open, 12_000);
    expect(r).toEqual({
      ok: true,
      shares: [{ invoiceId: "old", payMinor: 10_000 }, { invoiceId: "mid", payMinor: 2_000 }],
      untouched: ["new"],
    });
  });

  it("مجموعُ الحصص هو المبلغُ بالهللة", () => {
    const r = distributePartial(open, 21_999);
    expect(r.ok && r.shares.reduce((s, x) => s + x.payMinor, 0)).toBe(21_999);
  });

  it("ما زاد على المفتوح يُردّ بمبلغ المفتوح — لا يُقصّ", () => {
    expect(distributePartial(open, 22_001)).toEqual({ ok: false, reason: "EXCEEDS_OPEN", openMinor: 22_000 });
  });

  it("المفتوحُ كلُّه مقبول", () => {
    const r = distributePartial(open, 22_000);
    expect(r.ok && r.untouched).toEqual([]);
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("ما ليس عدداً صحيحاً موجباً (%s) يُردّ", (bad) => {
    expect(distributePartial(open, bad).ok).toBe(false);
  });
});

describe("ما يبقى عليك بعد الدفعة — لا يُقصّ عند الصفر", () => {
  it("الباقي يُقال بمبلغه", () => {
    expect(afterPayment(50_000, 30_000)).toEqual({ state: "remaining", minor: 20_000 });
  });
  it("الدفعُ الزائد يُقال زيادةً بمبلغها لا «يبقى 0.00»", () => {
    expect(afterPayment(30_000, 65_000)).toEqual({ state: "over", minor: 35_000 });
  });
  it("السدادُ التامّ (بتسامح الهللة) ليس زيادةً ولا باقياً", () => {
    expect(afterPayment(30_000, 30_000)).toEqual({ state: "settled" });
    expect(afterPayment(30_000, 30_001)).toEqual({ state: "settled" });
  });
  it("ما عليك مجهول ← مجهول، لا صفر", () => {
    expect(afterPayment(null, 30_000)).toEqual({ state: "unknown" });
  });
});

describe("اختيارُ صاحب الدفعة في الشاشة", () => {
  const s = { supplierId: "s1", creditMinor: 0, invoices: [{ id: "a", openMinor: 10_000 }, { id: "b", openMinor: 5_000 }] };

  it("بلا اختيار: الكلّ بمبلغه", () => {
    expect(planSupplier(s, EMPTY_SELECTION)).toMatchObject({ on: true, payingMinor: 15_000, skippedInvoices: 0, partialMinor: null });
  });

  it("فاتورةٌ مستثناة تُنقص المجموعَ بمبلغها", () => {
    const p = planSupplier(s, { ...EMPTY_SELECTION, skipInvoices: ["b"] });
    expect(p).toMatchObject({ on: true, payingMinor: 10_000, skippedInvoices: 1, invoiceIds: ["a"] });
  });

  it("استثناءُ كلّ فواتيره يُخرجه", () => {
    expect(planSupplier(s, { ...EMPTY_SELECTION, skipInvoices: ["a", "b"] })).toMatchObject({ on: false, payingMinor: 0 });
  });

  it("المبلغُ الجزئيّ الصحيح هو ما يخرج", () => {
    expect(planSupplier(s, { ...EMPTY_SELECTION, partial: { s1: "75.50" } })).toMatchObject({ partialMinor: 7_550, payingMinor: 7_550, partialError: null });
  });

  it("الجزئيُّ الأكبر ممّا يُحوَّل يُقال خطأً ولا يُحسَب — والمجموعُ يبقى الكلّ", () => {
    const p = planSupplier(s, { ...EMPTY_SELECTION, partial: { s1: "151" } });
    expect(p.partialMinor).toBeNull();
    expect(p.partialError).not.toBeNull();
    expect(p.payingMinor).toBe(15_000);
  });

  it("الرصيدُ يُخصم بقاعدة الخادم نفسها", () => {
    expect(transferAfterCredit(15_000, 4_000)).toEqual({ transferMinor: 11_000, creditAppliedMinor: 4_000 });
    expect(planSupplier({ ...s, creditMinor: 4_000 }, EMPTY_SELECTION)).toMatchObject({ fullMinor: 11_000, creditAppliedMinor: 4_000 });
  });

  it("ما حُفظ في المتصفّح يُقرأ بفحص — والتالفُ «لا اختيار»", () => {
    expect(readSelection(null)).toEqual(EMPTY_SELECTION);
    expect(readSelection("x")).toEqual(EMPTY_SELECTION);
    expect(readSelection({ skipSuppliers: ["s1", 5], skipInvoices: "no", partial: { s1: "10", s2: 7 } }))
      .toEqual({ skipSuppliers: ["s1"], skipInvoices: [], partial: { s1: "10" } });
  });
});

describe("دفعتان من صفوفٍ واحدة — «النقد القادم» يستعلم مرّةً", () => {
  /* صفوفُ الشهر الجاري تحوي صفوفَ ما قبله؛ فالدفعةُ المبنيّة منها كالمبنيّة من صفوف شهرها وحده */
  const older = [
    inv({ invoiceId: "jul", periodMonth: "2026-07", totalMinor: 7_000 }),
    inv({ invoiceId: "aug-1", periodMonth: "2026-08", totalMinor: 10_000, allocatedMinor: 4_000 }),
    inv({ invoiceId: "aug-held", periodMonth: "2026-08", supplierId: "s2", supplierName: "بيكوف", taxStatus: "UNKNOWN" }),
  ];
  const current = [
    inv({ invoiceId: "sep-1", periodMonth: "2026-09", totalMinor: 20_000 }),
    inv({ invoiceId: "sep-2", periodMonth: "2026-09", supplierId: "s2", supplierName: "بيكوف", totalMinor: 3_000 }),
  ];
  const credit = new Map([["s1", 2_000]]);

  it("دفعةُ الشهر المنقضي لا تتغيّر بوجود صفوف الشهر الجاري", () => {
    const options = { includeOlderUnpaid: true, creditBySupplier: credit };
    expect(buildPaymentRun([...older, ...current], "2026-08", options))
      .toEqual(buildPaymentRun(older, "2026-08", options));
  });

  it("ودفعةُ الشهر الجاري وحده لا تأخذ من المتأخّر", () => {
    const options = { includeOlderUnpaid: false };
    expect(buildPaymentRun([...older, ...current], "2026-09", options))
      .toEqual(buildPaymentRun(current, "2026-09", options));
  });
});
