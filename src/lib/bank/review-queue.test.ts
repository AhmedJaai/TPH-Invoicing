import { describe, expect, it } from "vitest";
import {
  BUCKET_LABEL, bucketOf, bulkConfirmable, describeQueue, groupForReview,
  type ReviewItem,
} from "./review-queue";

const item = (over: Partial<ReviewItem> & { transactionId: string }): ReviewItem => ({
  valueDate: "2026-08-11",
  amountMinor: 1_000_00,
  direction: "DEBIT",
  description: "حوالة صادرة",
  supplierName: "أوراق الزيتون",
  disposition: "SUGGEST",
  category: "SUPPLIER",
  score: 88,
  reasons: [],
  candidateCount: 1,
  ...over,
});

describe("توزيع ما ينتظر", () => {
  it("الواثق يُقَرّ", () => {
    expect(bucketOf(item({ transactionId: "a" }))).toBe("CONFIRM");
  });

  it("المتردّد يُراجَع", () => {
    expect(bucketOf(item({ transactionId: "a", disposition: "REVIEW" }))).toBe("REVIEW");
  });

  /*
    الجهة المجهولة تسبق كل شيء: ليست حركةً تنتظر قراراً بل حركةً لا
    يُعرف عمّاذا تُسأل. ولا معنى لعرض مرشّحين لمن لا نعرف من هو.
  */
  it("مجهول الجهة يُحسَم لا يُراجَع", () => {
    expect(bucketOf(item({ transactionId: "a", supplierName: null }))).toBe("RESOLVE");
    expect(bucketOf(item({ transactionId: "a", category: "UNKNOWN", disposition: "REVIEW" })))
      .toBe("RESOLVE");
  });

  it("ثلاث مجموعات دائماً، ولو فرغت", () => {
    const g = groupForReview([]);
    expect(g).toHaveLength(3);
    expect(g.map((x) => x.bucket)).toEqual(["CONFIRM", "REVIEW", "RESOLVE"]);
  });

  /* بالمال لا بالتاريخ: ما يزن أكثر خطؤه أغلى */
  it("الأكبر مبلغاً أوّلاً داخل المجموعة", () => {
    const g = groupForReview([
      item({ transactionId: "small", amountMinor: 100_00 }),
      item({ transactionId: "big", amountMinor: 50_000_00 }),
    ]);
    expect(g[0].items.map((i) => i.transactionId)).toEqual(["big", "small"]);
    expect(g[0].amountMinor).toBe(50_100_00);
  });
});

describe("وصف الطابور", () => {
  /*
    عددٌ واحد يقول «١٢٧ تحتاج مراجعة» يُرهب ولا يُرشد: فيها مئةٌ
    تُختَم في دقيقة وسبعٌ تحتاج عيناً.
  */
  it("يُقرأ في ثانية", () => {
    const g = groupForReview([
      item({ transactionId: "a" }),
      item({ transactionId: "b" }),
      item({ transactionId: "c", disposition: "REVIEW" }),
      item({ transactionId: "d", supplierName: null }),
    ]);
    expect(describeQueue(g)).toBe(
      `${BUCKET_LABEL.CONFIRM} 2 · ${BUCKET_LABEL.REVIEW} 1 · ${BUCKET_LABEL.RESOLVE} 1`,
    );
  });

  it("الفارغ يُقال صراحةً", () => {
    expect(describeQueue(groupForReview([]))).toBe("لا شيء ينتظرك");
  });

  it("المجموعة الفارغة لا تُذكر", () => {
    expect(describeQueue(groupForReview([item({ transactionId: "a" })])))
      .toBe(`${BUCKET_LABEL.CONFIRM} 1`);
  });
});

describe("ما يصلح للإقرار الجماعيّ", () => {
  it("مجموعة «يُقَرّ» وحدها", () => {
    const ids = bulkConfirmable([
      item({ transactionId: "ok" }),
      item({ transactionId: "review", disposition: "REVIEW" }),
      item({ transactionId: "unknown", supplierName: null }),
    ]);
    expect(ids).toEqual(["ok"]);
  });

  it("المحسومة تلقائياً ليست اقتراحاً فلا تُقَرّ ثانيةً", () => {
    expect(bulkConfirmable([item({ transactionId: "a", disposition: "AUTO" })])).toEqual([]);
  });
});
