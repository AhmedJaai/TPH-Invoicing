import { describe, expect, it } from "vitest";
import {
  TOTAL_TOLERANCE_MINOR, auditTruth, isClean, summarize,
  type ArchiveFile, type DbRecord,
} from "./truth-audit";

const file = (over: Partial<ArchiveFile> = {}): ArchiveFile => ({
  driveId: "d1", fileName: "260342-أوراق الزيتون-1150.00.pdf",
  supplierSlug: "OliveLeaves", periodMonth: "2026-08",
  invoiceNumber: "260342", totalMinor: 1_150_00, ...over,
});

const rec = (over: Partial<DbRecord> = {}): DbRecord => ({
  documentId: "doc1", driveId: "d1", fileName: "260342-أوراق الزيتون-1150.00.pdf",
  supplierSlug: "OliveLeaves", periodMonth: "2026-08",
  invoiceNumber: "260342", totalMinor: 1_150_00, hasInvoice: true, ...over,
});

const verdicts = (a: ArchiveFile[], r: DbRecord[]) => auditTruth(a, r).map((f) => f.verdict);

describe("مقابلة الأرشيف بالقاعدة", () => {
  it("الموافق مطابق", () => {
    expect(verdicts([file()], [rec()])).toEqual(["VERIFIED"]);
  });

  it("اختلاف الإجمالي يحتاج تصحيحاً — ولا يُصحَّح آلياً", () => {
    const f = auditTruth([file()], [rec({ totalMinor: 1_050_00 })])[0];
    expect(f.verdict).toBe("CORRECTED");
    expect(f.detail).toContain("100.00");
    expect(f.suggestion).toContain("لا يُصحَّح آلياً");
  });

  it("وريالٌ يُتسامح فيه — المورّد يُسقط كسور الريال", () => {
    expect(TOTAL_TOLERANCE_MINOR).toBe(100);
    expect(verdicts([file()], [rec({ totalMinor: 1_150_00 - 100 })])).toEqual(["VERIFIED"]);
    expect(verdicts([file()], [rec({ totalMinor: 1_150_00 - 101 })])).toEqual(["CORRECTED"]);
  });

  it("اختلاف الشهر تصحيحٌ كذلك — ينقل الفاتورة إلى شهرٍ ليس لها", () => {
    const f = auditTruth([file()], [rec({ periodMonth: "2026-07" })])[0];
    expect(f.verdict).toBe("CORRECTED");
    expect(f.detail).toContain("2026-07");
  });

  it("أصلٌ بلا قيد مفقود", () => {
    const f = auditTruth([file()], [])[0];
    expect(f.verdict).toBe("MISSING");
    expect(f.detail).toContain("ولا قيد له");
  });

  it("وقيدٌ بلا أصل مفقودٌ كذلك — ولا يُحذَف", () => {
    const f = auditTruth([], [rec()])[0];
    expect(f.verdict).toBe("MISSING");
    expect(f.suggestion).toContain("لا تحذف القيد");
  });

  it("أصلٌ واحد وقيدان مكرَّر", () => {
    const f = auditTruth([file()], [rec({ documentId: "a" }), rec({ documentId: "b" })])[0];
    expect(f.verdict).toBe("DUPLICATE");
    expect(f.detail).toContain("2");
  });
});

describe("ما لا يُقطَع فيه", () => {
  /*
    `AMBIGUOUS` ليست فشلاً: هي الحكم الصادق حين لا يكفي الدليل، وهي ما
    يمنع أن يُصحَّح رقمٌ صحيح بآخر خاطئ.
  */
  it("اسمٌ بلا إجمالٍ لا يُقابَل", () => {
    const f = auditTruth([file({ totalMinor: null })], [rec()])[0];
    expect(f.verdict).toBe("AMBIGUOUS");
    expect(f.detail).toContain("لا يحمل إجمالاً");
  });

  it("وقيدٌ بلا إجمالٍ مقروء كذلك", () => {
    expect(verdicts([file()], [rec({ totalMinor: null })])).toEqual(["AMBIGUOUS"]);
  });

  it("وقيدٌ بلا معرّف درايف لا يُقابَل بأصل", () => {
    const f = auditTruth([], [rec({ driveId: null })])[0];
    expect(f.verdict).toBe("AMBIGUOUS");
    expect(f.detail).toContain("لا يُقابَل بأصل");
  });

  it("ولا يُقال «مطابق» عن رقمٍ لم يُقرأ", () => {
    expect(verdicts([file({ totalMinor: null })], [rec({ totalMinor: null })]))
      .toEqual(["AMBIGUOUS"]);
  });
});

describe("الحكم على النقاء", () => {
  it("المطابق وحده نقيّ", () => {
    expect(isClean(summarize(auditTruth([file()], [rec()])))).toBe(true);
  });

  /* الجهل ليس خطأً — و`AMBIGUOUS` لا تمنع */
  it("وما لا يُقطَع فيه لا يمنع", () => {
    expect(isClean(summarize(auditTruth([file({ totalMinor: null })], [rec()])))).toBe(true);
  });

  it("والمخالف والمكرَّر والمفقود يمنعون", () => {
    expect(isClean(summarize(auditTruth([file()], [rec({ totalMinor: 9_99 })])))).toBe(false);
    expect(isClean(summarize(auditTruth([file()], [])))).toBe(false);
    expect(isClean(summarize(auditTruth([file()], [rec({ documentId: "a" }), rec({ documentId: "b" })]))))
      .toBe(false);
  });

  it("والعدّ يشمل الأحكام الخمسة دائماً", () => {
    expect(Object.keys(summarize([]))).toHaveLength(5);
  });
});
