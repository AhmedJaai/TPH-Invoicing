import { describe, expect, it } from "vitest";
import {
  REVERSAL_WINDOW_DAYS, describeReversal, findReversals, type ReversalInput,
} from "./reversal";

const day = (d: string) => new Date(`2026-09-${String(d).padStart(2, "0")}T00:00:00Z`);

const tx = (over: Partial<ReversalInput> & { id: string }): ReversalInput => ({
  valueDate: day("04"),
  amountMinor: 4_250_00,
  direction: "DEBIT",
  party: "شركة XYZ",
  ...over,
});

describe("findReversals", () => {
  it("الحالة التي ذكرها المراجع: خصمٌ ثمّ ردٌّ بنفس المبلغ", () => {
    const r = findReversals([
      tx({ id: "out", direction: "DEBIT", valueDate: day("04") }),
      tx({ id: "in", direction: "CREDIT", valueDate: day("06") }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].daysApart).toBe(2);
    expect(r[0].samePartyEvidence).toBe(true);
  });

  it("الردّ يأتي بعد الخصم لا قبله", () => {
    const r = findReversals([
      tx({ id: "out", direction: "DEBIT", valueDate: day("06") }),
      tx({ id: "in", direction: "CREDIT", valueDate: day("04") }),
    ]);
    expect(r).toEqual([]);
  });

  it("خارج النافذة ليس ردّاً", () => {
    const far = new Date(day("04").getTime() + (REVERSAL_WINDOW_DAYS + 1) * 86400000);
    const r = findReversals([
      tx({ id: "out", direction: "DEBIT", valueDate: day("04") }),
      tx({ id: "in", direction: "CREDIT", valueDate: far }),
    ]);
    expect(r).toEqual([]);
  });

  it("المبلغ المختلف ليس ردّاً", () => {
    const r = findReversals([
      tx({ id: "out", direction: "DEBIT" }),
      tx({ id: "in", direction: "CREDIT", amountMinor: 4_000_00, valueDate: day("06") }),
    ]);
    expect(r).toEqual([]);
  });

  it("ردٌّ واحد لخصمٍ واحد — لا يُقرَن مرّتين", () => {
    const r = findReversals([
      tx({ id: "out1", direction: "DEBIT", valueDate: day("04") }),
      tx({ id: "out2", direction: "DEBIT", valueDate: day("05") }),
      tx({ id: "in", direction: "CREDIT", valueDate: day("06") }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].outgoing.id).toBe("out1");
  });

  it("اختلاف الطرف يُبقيه ترجيحاً لا يقيناً", () => {
    const r = findReversals([
      tx({ id: "out", direction: "DEBIT", party: "شركة أ" }),
      tx({ id: "in", direction: "CREDIT", party: "جهة ب", valueDate: day("06") }),
    ]);
    expect(r[0].samePartyEvidence).toBe(false);
  });

  it("الطرف الغائب لا يُعدّ تطابقاً", () => {
    const r = findReversals([
      tx({ id: "out", direction: "DEBIT", party: null }),
      tx({ id: "in", direction: "CREDIT", party: null, valueDate: day("06") }),
    ]);
    expect(r[0].samePartyEvidence).toBe(false);
  });

  it("لا حركات فلا ردود", () => {
    expect(findReversals([])).toEqual([]);
  });
});

describe("describeReversal", () => {
  it("تقول إنّه ردٌّ حين يتطابق الطرف", () => {
    const [r] = findReversals([
      tx({ id: "out", direction: "DEBIT" }),
      tx({ id: "in", direction: "CREDIT", valueDate: day("06") }),
    ]);
    expect(describeReversal(r)).toContain("ردٌّ لا إيراد");
  });

  it("وتقول إنّه ترجيح حين لا يتطابق", () => {
    const [r] = findReversals([
      tx({ id: "out", direction: "DEBIT", party: "أ ب ج د" }),
      tx({ id: "in", direction: "CREDIT", party: "هـ و ز ح", valueDate: day("06") }),
    ]);
    expect(describeReversal(r)).toContain("يحتاج نظرك");
  });
});
