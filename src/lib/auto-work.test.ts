import { describe, expect, it } from "vitest";
import { readAutoWork, summarizeAutoWork, type AutoWorkItem } from "./auto-work";

const item = (o: Partial<AutoWorkItem>): AutoWorkItem => ({
  documentId: "d1", fileName: "f.pdf", supplierName: "المراعي", what: "recorded", totalMinor: 10_000, ...o,
});

describe("ما فعله النظامُ وحده يُقال بأثره", () => {
  it("لا شيء وقع ← لا خبر", () => {
    expect(summarizeAutoWork([])).toBeNull();
    expect(summarizeAutoWork([], { arrived: 0, renamed: 0 })).toBeNull();
  });

  it("ما قُيِّد يُقال بمبلغه: زاد ما عليك كذا", () => {
    const s = summarizeAutoWork([item({ totalMinor: 100_000 }), item({ documentId: "d2", totalMinor: 24_050, supplierName: "بيكوف" })]);
    expect(s?.owedAddedMinor).toBe(124_050);
    expect(s?.title).toContain("قيّد");
    expect(s?.body).toContain("1,240.50");
    expect(s?.body).toContain("المراعي");
    expect(s?.touchesMoney).toBe(true);
  });

  it("المبلغُ المجهول يُعَدّ ولا يُجمَع صفراً", () => {
    const s = summarizeAutoWork([item({ totalMinor: 5_000 }), item({ documentId: "d2", totalMinor: null })]);
    expect(s?.owedAddedMinor).toBe(5_000);
    expect(s?.owedUnknown).toBe(1);
    expect(s?.body).toContain("لم يُعرف مبلغُها");
  });

  it("كلُّ ما قُيِّد مجهولُ المبلغ ← لا يُقال «زاد 0.00»", () => {
    const s = summarizeAutoWork([item({ totalMinor: null })]);
    expect(s?.owedAddedMinor).toBe(0);
    expect(s?.body).not.toContain("0.00");
    expect(s?.body).toContain("لم يُعرف مبلغُها");
  });

  it("الاعتمادُ وحده لا يزيد ما عليك — الفاتورةُ مقيَّدةٌ من قبل", () => {
    const s = summarizeAutoWork([item({ what: "approved", totalMinor: 90_000 })]);
    expect(s?.owedAddedMinor).toBe(0);
    expect(s?.touchesMoney).toBe(false);
    expect(s?.title).toContain("اعتمد");
  });

  it("وصولُ مستنداتٍ جديدة وحده خبرٌ كذلك", () => {
    const s = summarizeAutoWork([], { arrived: 3 });
    expect(s?.title).toContain("الدرايف");
    expect(s?.touchesMoney).toBe(false);
  });

  it("الأسماءُ تُقصّ عند ثلاثة ويُقال كم بقي", () => {
    const s = summarizeAutoWork(["أ", "ب", "ج", "د", "هـ"].map((n, i) => item({ documentId: `d${i}`, supplierName: n })));
    expect(s?.body).toContain("و2 غيرهم");
  });

  it("الردُّ يُقرأ بفحص: ما لا يُفهَم يُسقَط، والمبلغُ العشريّ «غير معروف»", () => {
    expect(readAutoWork(null)).toEqual([]);
    expect(readAutoWork([{ documentId: "d", what: "deleted" }, 5, { what: "recorded" }])).toEqual([]);
    expect(readAutoWork([{ documentId: "d", what: "recorded", totalMinor: 12.5, fileName: "x" }]))
      .toEqual([{ documentId: "d", fileName: "x", supplierName: null, what: "recorded", totalMinor: null }]);
  });
});
