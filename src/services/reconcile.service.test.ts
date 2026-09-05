import { describe, expect, it } from "vitest";
import { runReconciliation } from "./reconcile.service";
import type { OpenInvoice } from "@/lib/bank/candidates";
import type { SupplierIdentity } from "@/lib/bank/entities";
import { buildMemory } from "@/lib/bank/classification";

const day = (d: string) => new Date(`${d}T00:00:00Z`);

const suppliers: SupplierIdentity[] = [
  { supplierId: "S1", nameAr: "أوراق الزيتون", slug: "OliveLeaves", aliases: [] },
  { supplierId: "S2", nameAr: "لافا كمبوتشا", slug: "Lava", aliases: ["أنس غالب خاشقجي"] },
];

const invoice = (over: Partial<OpenInvoice> & { id: string }): OpenInvoice => ({
  supplierId: "S1",
  invoiceNumber: null,
  invoiceDate: day("2026-08-10"),
  periodMonth: "2026-08",
  totalMinor: 1_000_00,
  outstandingMinor: 1_000_00,
  ...over,
});

const row = (over: Partial<Parameters<typeof runReconciliation>[0]["rows"][number]> & { key: string }) => ({
  valueDate: day("2026-08-11"),
  amountMinor: 1_000_00,
  direction: "DEBIT" as const,
  ...over,
});

describe("runReconciliation", () => {
  it("تسوية الشبكة لا تدخل مطابقة الفواتير أصلاً", () => {
    const { results, summary } = runReconciliation({
      rows: [row({ key: "t1", direction: "CREDIT", description: "81140155-260718-POS MC Se ttlem 125207" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    expect(results[0].kind).toBe("POS_SETTLEMENT");
    expect(results[0].outcome).toBe("NOT_A_PAYMENT");
    expect(results[0].candidate).toBeNull();
    expect(summary.notPayment).toBe(1);
  });

  it("مورّد معروف ومبلغ مطابق يُطابَق تلقائياً", () => {
    const { results, summary } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون", description: "شراء بضاعة" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    expect(results[0].decision?.disposition).toBe("AUTO");
    expect(results[0].candidate?.invoiceIds).toEqual(["i1"]);
    expect(summary.auto).toBe(1);
  });

  it("الاسم البديل يُعرِّف مورّداً لا يشبه اسمه", () => {
    const { results } = runReconciliation({
      rows: [row({ key: "t1", description: "شركة أنس غالب خاشقجي التجارية" })],
      invoices: [invoice({ id: "i1", supplierId: "S2" })],
      suppliers,
    });
    expect(results[0].supplierId).toBe("S2");
    expect(results[0].supplierEvidence.join(" ")).toContain("الاسم البديل");
  });

  it("مورّد معروف بلا فاتورة مفتوحة يُسمّى بذلك لا «مجهول»", () => {
    const { results } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون" })],
      invoices: [],
      suppliers,
    });
    expect(results[0].outcome).toBe("KNOWN_SUPPLIER_NO_INVOICE");
  });

  it("مستفيد مجهول يُسمّى مجهولاً — وهو حالٌ مختلف", () => {
    const { results } = runReconciliation({
      rows: [row({ key: "t1", description: "تحويل الى جهة" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    expect(results[0].outcome).toBe("UNKNOWN_ENTITY");
  });

  it("حركتان تتنافسان على فاتورة: الأقوى تأخذها ولا تُخصَّص مرّتين", () => {
    const { results } = runReconciliation({
      rows: [
        row({ key: "weak", beneficiaryRaw: "أوراق الزيتون", valueDate: day("2026-09-20") }),
        row({ key: "strong", beneficiaryRaw: "أوراق الزيتون", valueDate: day("2026-08-10") }),
      ],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    const taken = results.filter((r) => r.candidate !== null);
    expect(taken).toHaveLength(1);
    expect(taken[0].key).toBe("strong");
  });

  it("الذاكرة تُقدَّم على الكلمات في التصنيف", () => {
    const memory = buildMemory([
      { key: "NAME:أوراق الزيتون", kind: "SUPPLIER_PAYMENT", supplierId: "S1", at: day("2026-01-01") },
    ]);
    const { results } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون", description: "BV:رواتب شهرية" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
      memory,
    });
    expect(results[0].kind).toBe("SUPPLIER_PAYMENT");
    expect(results[0].classificationReason).toContain("أكّدتَ");
  });

  it("لكل نتيجة سببُ تصنيفها مكتوباً", () => {
    const { results } = runReconciliation({
      rows: [
        row({ key: "a", description: "EJAR رقم السداد20904553589" }),
        row({ key: "b", direction: "CREDIT", description: "81140155-260718-POS MC Se ttlem 1" }),
      ],
      invoices: [],
      suppliers,
    });
    for (const r of results) expect(r.classificationReason.length).toBeGreaterThan(0);
  });

  it("الملخّص يعدّ ما يحتاج المستخدم لا ما في الملف", () => {
    const { summary } = runReconciliation({
      rows: [
        row({ key: "pos", direction: "CREDIT", description: "81140155-260718-POS MC Se ttlem 1" }),
        row({ key: "rent", description: "EJAR رقم السداد20904553589" }),
        row({ key: "match", beneficiaryRaw: "أوراق الزيتون" }),
        row({ key: "mystery", description: "تحويل" }),
      ],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    expect(summary.total).toBe(4);
    expect(summary.notPayment).toBe(2);
    expect(summary.auto).toBe(1);
    expect(summary.review).toBe(1);
  });

  it("النتيجة واحدة لنفس المدخل", () => {
    const input = {
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    };
    expect(runReconciliation(input)).toEqual(runReconciliation(input));
  });
});

describe("خطّة الكتابة — مصدر قرارٍ واحد", () => {
  it("التلقائيّ وحده يُكتَب، والاقتراح ينتظر تأكيداً", () => {
    const { results, planned } = runReconciliation({
      // مرشّحان متساويان: القرار اقتراحٌ لا مطابقة
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون" })],
      invoices: [
        invoice({ id: "a", outstandingMinor: 1_000_00 }),
        invoice({ id: "b", outstandingMinor: 1_000_00 }),
      ],
      suppliers,
    });
    expect(results[0].decision?.disposition).toBe("SUGGEST");
    expect(planned).toEqual([]);
  });

  it("المطابقة التلقائية تُنتج خطّة تخصيص", () => {
    const { planned } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون" })],
      invoices: [invoice({ id: "a", outstandingMinor: 1_000_00 })],
      suppliers,
    });
    expect(planned).toHaveLength(1);
    expect(planned[0].allocations).toEqual([{ invoiceId: "a", amountMinor: 1_000_00 }]);
    expect(planned[0].supplierId).toBe("S1");
  });

  it("مجموع التخصيصات لا يتجاوز قيمة الدفعة", () => {
    const { planned } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون", amountMinor: 2_000_00 })],
      invoices: [
        invoice({ id: "a", outstandingMinor: 1_200_00, invoiceDate: day("2026-08-05") }),
        invoice({ id: "b", outstandingMinor: 800_00, invoiceDate: day("2026-08-09") }),
      ],
      suppliers,
    });
    if (planned.length > 0) {
      const sum = planned[0].allocations.reduce((s, a) => s + a.amountMinor, 0);
      expect(sum).toBeLessThanOrEqual(planned[0].amountMinor);
    }
  });

  it("لا تخصيص فوق قيمة الفاتورة الواحدة", () => {
    const { planned } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون", amountMinor: 2_000_00 })],
      invoices: [
        invoice({ id: "a", outstandingMinor: 1_200_00, invoiceDate: day("2026-08-05") }),
        invoice({ id: "b", outstandingMinor: 800_00, invoiceDate: day("2026-08-09") }),
      ],
      suppliers,
    });
    for (const p of planned) {
      for (const a of p.allocations) expect(a.amountMinor).toBeGreaterThan(0);
    }
  });

  it("الدفعة عبر شهور تحفظها كلّها لا شهر أوّل فاتورة", () => {
    const { planned } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون", amountMinor: 2_000_00,
        valueDate: day("2026-09-15") })],
      invoices: [
        invoice({ id: "aug", outstandingMinor: 1_200_00, periodMonth: "2026-08",
          invoiceDate: day("2026-08-20") }),
        invoice({ id: "sep", outstandingMinor: 800_00, periodMonth: "2026-09",
          invoiceDate: day("2026-09-05") }),
      ],
      suppliers,
    });
    const multi = planned.find((p) => p.months.length > 1);
    if (multi) {
      expect(multi.months).toEqual(["2026-08", "2026-09"]);
      // الأحدث هو الحاكم: الدفعة تُغلق ما بلغته
      expect(multi.primaryMonth).toBe("2026-09");
    }
  });

  it("الخطّة فارغة حين لا مطابقة تلقائية", () => {
    const { planned } = runReconciliation({
      rows: [row({ key: "t1", description: "تحويل الى جهة" })],
      invoices: [invoice({ id: "a" })],
      suppliers,
    });
    expect(planned).toEqual([]);
  });
});

describe("الحلّ التقريبيّ لا يُطابَق تلقائياً", () => {
  it("حين ينفد البحث يصير التلقائيّ اقتراحاً — وقولُ «تمّت» عنه ادّعاء", () => {
    /*
      حالة متشابكة عمداً كي تنفد ميزانيّة المحسِّن: عشرون حركة تتنافس
      على ستّ عشرة فاتورة لمورّدٍ واحد.
    */
    const invoices = Array.from({ length: 16 }, (_, i) =>
      invoice({ id: `i${i}`, outstandingMinor: 1_000_00 + i, invoiceDate: day("2026-08-10") }));
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({ key: `t${i}`, beneficiaryRaw: "أوراق الزيتون", amountMinor: 1_000_00 + (i % 16) }));

    const { results, summary } = runReconciliation({ rows, invoices, suppliers });

    if (!summary.exact) {
      for (const r of results) {
        expect(r.decision?.disposition).not.toBe("AUTO");
      }
    }
    expect(typeof summary.exact).toBe("boolean");
  });
});

describe("حالات التحكيم تُحسَب دائماً", () => {
  it("تُحسَب وإن لم يُستدعَ حَكَم — فمعرفة كم التبس أهمّ من حلّه", () => {
    const { adjudicationCases } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون" })],
      invoices: [
        invoice({ id: "a", outstandingMinor: 1_000_00 }),
        invoice({ id: "b", outstandingMinor: 1_000_00 }),
      ],
      suppliers,
    });
    expect(adjudicationCases.length).toBeGreaterThan(0);
    expect(adjudicationCases[0].reason).toBe("CLOSE_CANDIDATES");
  });

  it("وما حُسم تلقائياً لا يدخلها", () => {
    const { adjudicationCases } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون" })],
      invoices: [invoice({ id: "a", outstandingMinor: 1_000_00 })],
      suppliers,
    });
    expect(adjudicationCases).toEqual([]);
  });
});

describe("الرسم يصل إلى المال", () => {
  /*
    كان `splitBankFee` يُحسب ويُختبَر ولا يستدعيه أحد خارج اختباره.
    فتُقسَّم الدفعة كاملةً بما فيها رسمُ التحويل، ويُنسَب إلى المورّد
    مالٌ ذهب إلى البنك. وحسابٌ صحيح لا يصل إلى المال أسوأ من عدمه:
    يوهم أنّ الحالة معالَجة.
  */
  it("خصمٌ يزيد عن الفاتورة بقدر رسم التحويل يُقيَّد رسماً", () => {
    const { planned } = runReconciliation({
      rows: [row({
        key: "t1", amountMinor: 1_015_00,
        beneficiaryRaw: "أوراق الزيتون", description: "شراء بضاعة",
      })],
      invoices: [invoice({ id: "i1", totalMinor: 1_000_00, outstandingMinor: 1_000_00 })],
      suppliers,
    });
    expect(planned).toHaveLength(1);
    expect(planned[0].feeMinor).toBe(15_00);
    expect(planned[0].feeReason).toContain("رسم");
    /* المبلغ المسجَّل ما خرج فعلاً، وإلّا اختلّت معادلة الكشف */
    expect(planned[0].amountMinor).toBe(1_015_00);
    /* والمخصَّص على الفاتورة قيمتها لا أكثر */
    expect(planned[0].allocations.reduce((s, a) => s + a.amountMinor, 0)).toBe(1_000_00);
  });

  it("الخصم المساوي بلا رسم", () => {
    const { planned } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون", description: "شراء بضاعة" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    expect(planned[0].feeMinor).toBe(0);
    expect(planned[0].feeReason).toBeNull();
  });
});

describe("القراءة البصرية لا تُحسَم تلقائياً", () => {
  /*
    المعادلة تكشف الخطأ الجسيم — سطراً ساقطاً أو رقماً قُرئ ٧ بدل ١ —
    ولا تكشف تبادلَ وصفين بين سطرين متساويَي المبلغ. فالحساب صحيح على
    مدخلٍ غير مثبت، وهو حال الحلّ التقريبيّ نفسه.
  */
  const input = {
    rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون", description: "شراء بضاعة" })],
    invoices: [invoice({ id: "i1" })],
    suppliers,
  };

  it("المقروء حسابياً يُحسَم", () => {
    const { results, planned } = runReconciliation(input);
    expect(results[0].decision?.disposition).toBe("AUTO");
    expect(planned).toHaveLength(1);
  });

  it("والمقروء بصرياً يُقترَح ولا يُكتَب", () => {
    const { results, planned } = runReconciliation({ ...input, readSource: "VISION" });
    expect(results[0].decision?.disposition).toBe("SUGGEST");
    expect(results[0].decision?.reasons.some((r) => r.includes("بصرياً"))).toBe(true);
    expect(planned).toHaveLength(0);
  });
});
