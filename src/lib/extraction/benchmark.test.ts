import { describe, expect, it } from "vitest";
import {
  CONFIDENT, formatBenchmark, predictionFromReading, rankProviders, scoreProvider,
  type GroundTruth, type Prediction,
} from "./benchmark";

const truth = (over: Partial<GroundTruth> & { documentId: string }): GroundTruth => ({
  kind: "TAX_INVOICE",
  supplierName: "أوراق الزيتون",
  invoiceNumber: "260342",
  totalMinor: 500_00,
  ...over,
});

const pred = (over: Partial<Prediction> & { documentId: string }): Prediction => ({
  provider: "gemini",
  model: "gemini-2.5-flash",
  promptVersion: "v1",
  schemaVersion: "v1",
  durationMs: 1000,
  ...over,
});

describe("scoreProvider", () => {
  it("لا تنبّؤات فلا نتيجة", () => {
    expect(scoreProvider([truth({ documentId: "a" })], [])).toBeNull();
  });

  it("الإصابة تُحسَب", () => {
    const r = scoreProvider(
      [truth({ documentId: "a" })],
      [pred({ documentId: "a", kind: "TAX_INVOICE", supplierName: "أوراق الزيتون",
        invoiceNumber: "260342", totalMinor: 500_00 })],
    )!;
    expect(r.overallAccuracy).toBe(1);
  });

  it("الفراغ يُسمّى فوتاً لا خطأً — وبينهما فرق", () => {
    const r = scoreProvider(
      [truth({ documentId: "a" })],
      [pred({ documentId: "a", kind: "TAX_INVOICE" })],
    )!;
    const supplier = r.fields.find((f) => f.field === "supplierName")!;
    expect(supplier.missed).toBe(1);
    expect(supplier.wrong).toBe(0);
  });

  it("ما لا حقيقة له لا يُحاسَب عليه", () => {
    const r = scoreProvider(
      [truth({ documentId: "a", invoiceDate: undefined })],
      [pred({ documentId: "a", invoiceDate: "2026-08-01" })],
    )!;
    expect(r.fields.find((f) => f.field === "invoiceDate")!.notApplicable).toBe(1);
  });

  it("يتسامح بهللة في المبالغ ولا يتسامح بأكثر", () => {
    const ok = scoreProvider([truth({ documentId: "a", totalMinor: 500_00 })],
      [pred({ documentId: "a", totalMinor: 500_01 })])!;
    expect(ok.fields.find((f) => f.field === "totalMinor")!.correct).toBe(1);

    const bad = scoreProvider([truth({ documentId: "a", totalMinor: 500_00 })],
      [pred({ documentId: "a", totalMinor: 500_50 })])!;
    expect(bad.fields.find((f) => f.field === "totalMinor")!.wrong).toBe(1);
  });

  it("يوحّد الاسم فلا تحجبه الهمزة", () => {
    const r = scoreProvider([truth({ documentId: "a", supplierName: "أوراق الزيتون" })],
      [pred({ documentId: "a", supplierName: "اوراق الزيتون" })])!;
    expect(r.fields.find((f) => f.field === "supplierName")!.correct).toBe(1);
  });

  it("الخطأ الواثق يُحسَب وحده — وهو المؤذي", () => {
    const r = scoreProvider(
      [truth({ documentId: "a", invoiceNumber: "260342" })],
      [pred({
        documentId: "a", invoiceNumber: "999999",
        confidence: { invoiceNumber: CONFIDENT + 0.1 },
      })],
    )!;
    expect(r.confidentErrorRate).toBe(1);
  });

  it("الخطأ بثقةٍ منخفضة لا يُعدّ واثقاً", () => {
    const r = scoreProvider(
      [truth({ documentId: "a", invoiceNumber: "260342" })],
      [pred({ documentId: "a", invoiceNumber: "999999", confidence: { invoiceNumber: 0.2 } })],
    )!;
    expect(r.confidentErrorRate).toBeNull();
  });

  it("الفشل يُعدّ ولا يُحسَب خطأً في الحقول", () => {
    const r = scoreProvider(
      [truth({ documentId: "a" })],
      [pred({ documentId: "a", failed: true })],
    )!;
    expect(r.failures).toBe(1);
    expect(r.overallAccuracy).toBeNull();
  });

  it("يحفظ نسخة الموجِّه والمخطّط — فقراءتان بموجِّهين لا تُقارَنان", () => {
    const r = scoreProvider([truth({ documentId: "a" })],
      [pred({ documentId: "a", promptVersion: "2026-09-05.1" })])!;
    expect(r.promptVersion).toBe("2026-09-05.1");
  });
});

describe("rankProviders", () => {
  const result = (over: Partial<ReturnType<typeof scoreProvider>> & { provider: string }) =>
    ({
      model: "m", promptVersion: "v", schemaVersion: "v",
      documents: 10, failures: 0, fields: [],
      confidentErrorRate: 0, medianDurationMs: 1000, overallAccuracy: 0.9,
      ...over,
    }) as NonNullable<ReturnType<typeof scoreProvider>>;

  it("الخطأ الواثق يسبق الدقّة — في المال الخطأ الذي يمرّ أغلى", () => {
    const r = rankProviders([
      result({ provider: "دقيق لكن يخطئ بثقة", overallAccuracy: 0.95, confidentErrorRate: 0.06 }),
      result({ provider: "أقلّ دقّة وأصدق", overallAccuracy: 0.9, confidentErrorRate: 0.01 }),
    ]);
    expect(r[0].provider).toBe("أقلّ دقّة وأصدق");
  });

  it("ثمّ الدقّة، ثمّ السرعة", () => {
    const r = rankProviders([
      result({ provider: "بطيء أدقّ", overallAccuracy: 0.95, medianDurationMs: 9000 }),
      result({ provider: "سريع أقلّ", overallAccuracy: 0.9, medianDurationMs: 100 }),
    ]);
    expect(r[0].provider).toBe("بطيء أدقّ");
  });

  it("لا نتائج فلا ترتيب", () => {
    expect(rankProviders([])).toEqual([]);
  });
});

describe("predictionFromReading — قراءةٌ محفوظة أو جديدة إلى توقّعٍ يُقاس", () => {
  const meta = { documentId: "a", provider: "deepseek", model: "m", promptVersion: "p", schemaVersion: "s", durationMs: 10 };
  const parse = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : null);

  it("يقرأ الحقول المقيسة وحدها — ولا يشترط المخطّط كاملاً", () => {
    const p = predictionFromReading(
      { invoiceNumber: " 260138 ", invoiceDate: "2026-09-13T10:00", totalAmount: "165.00", vatAmount: "21.52",
        supplierNameAr: "", supplierNameEn: "Olive Leaves", lines: [{}, {}], confidence: { amounts: 0.9, junk: "x" } },
      meta, parse,
    );
    expect(p).toMatchObject({
      invoiceNumber: "260138", invoiceDate: "2026-09-13", totalMinor: 16500, vatMinor: 2152,
      subtotalMinor: 14348, supplierName: "Olive Leaves", lineCount: 2, confidence: { amounts: 0.9 },
    });
    expect(p.failed).toBeUndefined();
  });

  it("المجهول يبقى مجهولاً: لا صافٍ يُشتقّ بلا ضريبة، ولا صفر", () => {
    const p = predictionFromReading({ totalAmount: "165.00", vatAmount: "" }, meta, parse);
    expect(p.subtotalMinor).toBeUndefined();
    expect(p.vatMinor).toBeUndefined();
  });

  it("لا قراءة: فشلٌ يُعدّ فشلاً لا فراغاً", () => {
    expect(predictionFromReading(null, meta, parse).failed).toBe(true);
  });
});

describe("scoreProvider — قواعد المقارنة التي كانت في النصّ", () => {
  it("المورّد يُقاس على اسميه معاً وبالاحتواء", () => {
    const r = scoreProvider(
      [truth({ documentId: "a", supplierName: "أوراق الزيتون", supplierAliases: ["Olive Leaves"] })],
      [pred({ documentId: "a", supplierName: "Olive Leaves Trading Est." })],
    )!;
    expect(r.fields.find((f) => f.field === "supplierName")).toMatchObject({ correct: 1, wrong: 0 });
  });

  it("ضريبةٌ مقيَّدة صفراً وحقلٌ تركه النموذج فارغاً: قولٌ واحد", () => {
    const r = scoreProvider(
      [truth({ documentId: "a", vatMinor: 0 })],
      [pred({ documentId: "a", vatMinor: undefined })],
    )!;
    expect(r.fields.find((f) => f.field === "vatMinor")).toMatchObject({ correct: 1, missed: 0 });
  });

  it("الخطأ الواثق يُحسب من ثقة النموذج لا من عدد الأخطاء", () => {
    const r = scoreProvider(
      [truth({ documentId: "a", totalMinor: 1000 }), truth({ documentId: "b", totalMinor: 1000 })],
      [
        pred({ documentId: "a", totalMinor: 9999, subtotalMinor: undefined, vatMinor: undefined, confidence: { amounts: 0.95 } }),
        pred({ documentId: "b", totalMinor: 9999, subtotalMinor: undefined, vatMinor: undefined, confidence: { amounts: 0.4 } }),
      ],
    )!;
    /* خطآن، وواحدٌ منهما فقط واثق */
    expect(r.fields.find((f) => f.field === "totalMinor")!.wrong).toBe(2);
    expect(formatBenchmark("x", r)).toContain("الخطأ الواثق");
  });
});
