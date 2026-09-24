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

  it("ولا حسابَ يُخمَّن: المجهولُ فارغٌ ومعه تنبيه", () => {
    const line = toBankTransferCsv(run).split("\r\n")[1];
    expect(line).toContain("الحسابُ غير معروف");
  });

  it("يبدأ بعلامة ترميز ليقرأه إكسل العربي", () => {
    expect(toBankTransferCsv(run).charCodeAt(0)).toBe(0xfeff);
  });

  it("يحمي الفواصل داخل الأسماء", () => {
    const tricky = buildPaymentRun([
      inv({ invoiceId: "1", supplierName: 'مؤسسة "أ, ب"' }),
    ], "2026-08");
    const line = toBankTransferCsv(tricky).split("\r\n")[1];
    expect(line.startsWith('"مؤسسة ""أ, ب"""')).toBe(true);
  });
});

describe("رسالة المورّد", () => {
  it("تسرد أرقام الفواتير الناقصة وتطلب البديل", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "1", invoiceNumber: "990", taxStatus: "INVALID" }),
    ], "2026-08");
    const msg = buildSupplierMessage("بيكوف", run.held);
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
      [{ ...base, taxStatus: "UNKNOWN", inputVatStatus: "UNKNOWN" }],
      "2026-08",
    );
    expect(run.vatAtRiskMinor).toBe(0);
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

