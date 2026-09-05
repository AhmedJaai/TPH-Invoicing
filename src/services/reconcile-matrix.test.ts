/**
 * مصفوفة التسوية: اثنتان وعشرون حالةً مسمّاة.
 *
 * والغرض منها غيرُ غرض بقيّة الاختبارات. تلك تفحص دوالَّ بعينها، وهذه
 * تفحص **سلوك النظام** في الحالات التي تقع فعلاً في كشف حسابٍ حقيقيّ:
 * ماذا يفعل حين يطابق المبلغ تماماً؟ وحين يزيد قليلاً؟ وحين تطلب
 * حركتان الفاتورةَ نفسها؟ وحين لا يُعرف المستفيد أصلاً؟
 *
 * ولكلّ حالةٍ اسمٌ يُقرأ في تقرير الاختبارات — كي يُعرَف **أيّ سلوكٍ
 * انكسر** لا أيّ دالّةٍ فشلت. والفرق بينهما هو الفرق بين «فشل اختبار»
 * و«صار النظام يخترع سداداً».
 *
 * والمفحوص هو القرار المكتوب — `planned` — لا الدرجة وحدها: الدرجة
 * وسيط، والمكتوب هو المال.
 */
import { describe, expect, it } from "vitest";
import { runReconciliation } from "./reconcile.service";
import type { OpenInvoice } from "@/lib/bank/candidates";
import type { SupplierIdentity } from "@/lib/bank/entities";

const day = (d: string) => new Date(`${d}T00:00:00Z`);

const suppliers: SupplierIdentity[] = [
  { supplierId: "S1", nameAr: "أوراق الزيتون", slug: "OliveLeaves", aliases: [] },
  { supplierId: "S2", nameAr: "لافا كمبوتشا", slug: "Lava", aliases: [] },
  { supplierId: "S3", nameAr: "سرد للتجارة", slug: "Sard", aliases: [] },
];

const inv = (over: Partial<OpenInvoice> & { id: string }): OpenInvoice => ({
  supplierId: "S1", invoiceNumber: null, invoiceDate: day("2026-08-10"),
  periodMonth: "2026-08", totalMinor: 1_000_00, outstandingMinor: 1_000_00, ...over,
});

const tx = (over: Partial<Parameters<typeof runReconciliation>[0]["rows"][number]> & { key: string }) => ({
  valueDate: day("2026-08-12"), amountMinor: 1_000_00, direction: "DEBIT" as const,
  beneficiaryRaw: "أوراق الزيتون", description: "شراء بضاعة", ...over,
});

const run = (input: Parameters<typeof runReconciliation>[0]) => {
  const r = runReconciliation(input);
  return {
    ...r,
    of: (key: string) => r.results.find((x) => x.key === key)!,
    plan: (key: string) => r.planned.find((p) => p.transactionKey === key) ?? null,
  };
};

/* ───────────────────── ١–٦: المبلغ ───────────────────── */

describe("المصفوفة · المبلغ", () => {
  it("١. مبلغٌ مطابق تماماً لفاتورةٍ واحدة → يُكتَب", () => {
    const r = run({ rows: [tx({ key: "t" })], invoices: [inv({ id: "i" })], suppliers });
    expect(r.of("t").decision?.disposition).toBe("AUTO");
    expect(r.plan("t")?.allocations).toEqual([{ invoiceId: "i", amountMinor: 1_000_00 }]);
  });

  it("٢. مجموع فاتورتين يطابق الدفعة → تُكتبان معاً", () => {
    const r = run({
      rows: [tx({ key: "t", amountMinor: 1_800_00 })],
      invoices: [inv({ id: "a", outstandingMinor: 1_200_00 }), inv({ id: "b", outstandingMinor: 600_00 })],
      suppliers,
    });
    expect(r.plan("t")?.allocations).toHaveLength(2);
    expect(r.plan("t")?.allocations.reduce((s, a) => s + a.amountMinor, 0)).toBe(1_800_00);
  });

  it("٣. سدادٌ جزئيّ → يُخصَّص بقدره ولا يُقفِل الفاتورة", () => {
    const r = run({
      rows: [tx({ key: "t", amountMinor: 400_00 })],
      invoices: [inv({ id: "i", outstandingMinor: 1_000_00, invoiceNumber: "260342" })],
      suppliers,
    });
    const c = r.of("t").candidate;
    if (c) expect(c.allocatedMinor).toBeLessThanOrEqual(400_00);
    /* والمكتوب — إن كُتب — لا يتجاوز الدفعة */
    const p = r.plan("t");
    if (p) expect(p.allocations.reduce((s, a) => s + a.amountMinor, 0)).toBeLessThanOrEqual(400_00);
  });

  it("٤. زيادةٌ في حدّ رسم التحويل → مطابقةٌ تامّة ورسمٌ مفصول", () => {
    const r = run({
      rows: [tx({ key: "t", amountMinor: 1_015_00 })],
      invoices: [inv({ id: "i" })], suppliers,
    });
    expect(r.plan("t")?.feeMinor).toBe(15_00);
    expect(r.plan("t")?.allocations[0].amountMinor).toBe(1_000_00);
  });

  it("٥. زيادةٌ فوق حدّ الرسم → لا تُحسَم تلقائياً", () => {
    const r = run({
      rows: [tx({ key: "t", amountMinor: 1_500_00 })],
      invoices: [inv({ id: "i" })], suppliers,
    });
    expect(r.of("t").decision?.disposition).not.toBe("AUTO");
    expect(r.plan("t")).toBeNull();
  });

  it("٦. لا يُخصَّص فوق قيمة الفاتورة أبداً", () => {
    const r = run({
      rows: [tx({ key: "t", amountMinor: 5_000_00 })],
      invoices: [inv({ id: "i", outstandingMinor: 1_000_00 })], suppliers,
    });
    for (const a of r.plan("t")?.allocations ?? []) expect(a.amountMinor).toBeLessThanOrEqual(1_000_00);
  });
});

/* ───────────────────── ٧–١١: الجهة ───────────────────── */

describe("المصفوفة · الجهة", () => {
  it("٧. مستفيدٌ غير معروف → يُعلَن ولا يُخمَّن", () => {
    const r = run({
      rows: [tx({ key: "t", beneficiaryRaw: "جهة لا نعرفها", description: "حوالة" })],
      invoices: [inv({ id: "i" })], suppliers,
    });
    expect(r.of("t").supplierId).toBeNull();
    expect(r.plan("t")).toBeNull();
  });

  /* الاسم الثلاثيّ: «سرد» ثلاثة أحرف و«للتجاره» عامّة — فبقي بلا مميِّز */
  it("٨. اسمٌ تجاريّ ثلاثيّ يُعرَف — ولا يبقى بلا كلمةٍ مميّزة", () => {
    const r = run({
      rows: [tx({ key: "t", beneficiaryRaw: "سرد للتجارة", amountMinor: 11_600_00 })],
      invoices: [inv({ id: "i", supplierId: "S3", outstandingMinor: 11_600_00 })],
      suppliers,
    });
    expect(r.of("t").supplierId).toBe("S3");
  });

  it("٩. مورّدٌ معروف بلا فاتورة مفتوحة → يُعلَن ولا يُطابَق", () => {
    const r = run({ rows: [tx({ key: "t" })], invoices: [], suppliers });
    expect(r.of("t").outcome).toBe("KNOWN_SUPPLIER_NO_INVOICE");
    expect(r.plan("t")).toBeNull();
  });

  it("١٠. فاتورةُ مورّدٍ آخر لا تُنسَب إليه", () => {
    const r = run({
      rows: [tx({ key: "t", beneficiaryRaw: "لافا كمبوتشا" })],
      invoices: [inv({ id: "i", supplierId: "S1" })], suppliers,
    });
    expect(r.plan("t")).toBeNull();
  });

  it("١١. الوارد ليس سداد مورّد", () => {
    const r = run({
      rows: [tx({ key: "t", direction: "CREDIT", description: "إيداع" })],
      invoices: [inv({ id: "i" })], suppliers,
    });
    expect(r.plan("t")).toBeNull();
  });
});

/* ───────────────────── ١٢–١٥: التنازع ───────────────────── */

describe("المصفوفة · التنازع", () => {
  /*
    هذه أخطر حالةٍ في الملفّ كلّه: المطابق الجشع يحجز الفاتورة لأوّل
    حركةٍ تطلبها، فتُطابَق واحدة وتبقى الأخرى معلّقة — أو أسوأ: تُخصَّص
    الفاتورة مرّتين.
  */
  it("١٢. حركتان تطلبان الفاتورة نفسها → لا تُخصَّص مرّتين", () => {
    const r = run({
      rows: [tx({ key: "a" }), tx({ key: "b" })],
      invoices: [inv({ id: "i" })], suppliers,
    });
    const claimed = r.planned.flatMap((p) => p.allocations.map((x) => x.invoiceId));
    expect(claimed.filter((x) => x === "i").length).toBeLessThanOrEqual(1);
  });

  it("١٣. مرشّحان متقاربان → لا حسمَ تلقائيّ", () => {
    const r = run({
      rows: [tx({ key: "t" })],
      invoices: [
        inv({ id: "a", outstandingMinor: 1_000_00, invoiceDate: day("2026-08-10") }),
        inv({ id: "b", outstandingMinor: 1_000_00, invoiceDate: day("2026-08-10") }),
      ],
      suppliers,
    });
    expect(r.of("t").decision?.disposition).not.toBe("AUTO");
  });

  it("١٤. الفارق الواضح يُحسَم", () => {
    const r = run({
      rows: [tx({ key: "t" })],
      invoices: [inv({ id: "a" }), inv({ id: "b", outstandingMinor: 7_777_00 })],
      suppliers,
    });
    expect(r.plan("t")?.allocations[0].invoiceId).toBe("a");
  });

  it("١٥. الفاتورة المسدَّدة لا تدخل الترشيح", () => {
    const r = run({
      rows: [tx({ key: "t" })],
      invoices: [inv({ id: "paid", outstandingMinor: 0 }), inv({ id: "open" })],
      suppliers,
    });
    expect(r.plan("t")?.allocations[0].invoiceId).toBe("open");
  });
});

/* ───────────────────── ١٦–١٩: الزمن ───────────────────── */

describe("المصفوفة · الزمن", () => {
  it("١٦. فاتورةٌ قبل الدفعة بأيام → عاديّة", () => {
    const r = run({
      rows: [tx({ key: "t", valueDate: day("2026-08-15") })],
      invoices: [inv({ id: "i", invoiceDate: day("2026-08-10") })], suppliers,
    });
    expect(r.of("t").candidate?.parts.date).toBeGreaterThan(0.8);
  });

  /* تصل الفاتورة ثمّ تُدفَع — ولا يُنسَب سدادٌ إلى ما لم يكن موجوداً */
  it("١٧. فاتورةٌ بعد الدفعة بأسبوعين → لا تُنسَب إليها", () => {
    const r = run({
      rows: [tx({ key: "t", valueDate: day("2026-08-01") })],
      invoices: [inv({ id: "i", invoiceDate: day("2026-08-20") })], suppliers,
    });
    expect(r.of("t").candidate?.parts.date ?? 0).toBe(0);
  });

  it("١٨. فاتورةٌ بعد الدفعة بيوم → ممكنةٌ لا مرجَّحة", () => {
    const r = run({
      rows: [tx({ key: "t", valueDate: day("2026-08-10") })],
      invoices: [inv({ id: "i", invoiceDate: day("2026-08-11") })], suppliers,
    });
    const d = r.of("t").candidate?.parts.date ?? 0;
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(0.5);
  });

  it("١٩. الشهر الحاكم أحدثُ شهور الفاتورة لا أقدمُها", () => {
    const r = run({
      rows: [tx({ key: "t", amountMinor: 2_000_00, valueDate: day("2026-09-01") })],
      invoices: [
        inv({ id: "a", periodMonth: "2026-07", invoiceDate: day("2026-07-20"), outstandingMinor: 1_000_00 }),
        inv({ id: "b", periodMonth: "2026-08", invoiceDate: day("2026-08-20"), outstandingMinor: 1_000_00 }),
      ],
      suppliers,
    });
    const p = r.plan("t");
    if (p) {
      expect(p.primaryMonth).toBe("2026-08");
      expect(p.months).toEqual(["2026-07", "2026-08"]);
    }
  });
});

/* ───────────────────── ٢٠–٢٢: ما ليس سداداً ───────────────────── */

describe("المصفوفة · ما ليس سداداً", () => {
  it("٢٠. تسوية الشبكة لا تدخل مطابقة الفواتير", () => {
    const r = run({
      rows: [tx({ key: "t", direction: "CREDIT", description: "81140155-260718-POS MC Se ttlem 125207" })],
      invoices: [inv({ id: "i" })], suppliers,
    });
    expect(r.of("t").outcome).toBe("NOT_A_PAYMENT");
    expect(r.of("t").candidate).toBeNull();
  });

  it("٢١. الراتب لا يُطابَق بفاتورة", () => {
    const r = run({
      rows: [tx({ key: "t", beneficiaryRaw: "محمد علي", description: "رواتب موظفين" })],
      invoices: [inv({ id: "i" })], suppliers,
    });
    expect(r.plan("t")).toBeNull();
  });

  /* «زاتكا» ليست صدقة — والحكوميّ يسبق الزكاة في الترتيب */
  it("٢٢. سدادٌ حكوميّ لا يُقرأ زكاةً", () => {
    const r = run({
      rows: [tx({ key: "t", description: "سداد فاتورة زاتكا الضريبة" })],
      invoices: [inv({ id: "i" })], suppliers,
    });
    expect(r.of("t").category).not.toBe("ZAKAT");
    expect(r.plan("t")).toBeNull();
  });
});
