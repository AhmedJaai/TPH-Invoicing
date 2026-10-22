import { describe, expect, it } from "vitest";
import { bulkSkipReason, type BulkCandidate } from "./bulk-approve";

const clean: BulkCandidate = {
  canArchive: true, acknowledged: false, firstBlocker: null, supplierKnown: true,
  lowConfidenceFields: [], editedByHand: false, reviewing: false,
  evidence: { unresolvedConflicts: [], disagreements: [], reaskChanged: [] },
};

describe("الاعتمادُ دفعةً: ما يحتاج عيناً لا يُعتمد عنها", () => {
  it("النظيفةُ تُعتمد", () => {
    expect(bulkSkipReason(clean)).toBeNull();
  });

  it("المانعُ يُترك باسمه — إلّا ما أقرّ به صاحبُه في بطاقتها", () => {
    expect(bulkSkipReason({ ...clean, canArchive: false, firstBlocker: "فاتورة مكررة" })).toBe("يمنعها: فاتورة مكررة");
    expect(bulkSkipReason({ ...clean, canArchive: false, acknowledged: true })).toBeNull();
  });

  it("مورّدٌ لم يُعرف، أو فحصٌ لم يصل جوابُه، يُترك", () => {
    expect(bulkSkipReason({ ...clean, supplierKnown: false })).toMatch(/المورّد/);
    expect(bulkSkipReason({ ...clean, reviewing: true })).toMatch(/فحصها/);
  });

  it("الثقةُ الضعيفة والتعارضُ يُتركان — ما لم يصحّحه صاحبُه بيده", () => {
    expect(bulkSkipReason({ ...clean, lowConfidenceFields: ["المبالغ"] })).toMatch(/ثقة ضعيفة: المبالغ/);
    expect(bulkSkipReason({ ...clean, evidence: { ...clean.evidence!, unresolvedConflicts: ["مجموع البنود لا يوافق"] } })).toMatch(/تعارض/);
    expect(bulkSkipReason({ ...clean, evidence: { ...clean.evidence!, disagreements: [{ field: "total", read: "1", qr: "2", blocking: true }] } })).toMatch(/QR/);
    expect(bulkSkipReason({ ...clean, evidence: { ...clean.evidence!, reaskChanged: ["totalAmount"] } })).toMatch(/تبدّل/);
    expect(bulkSkipReason({ ...clean, lowConfidenceFields: ["المبالغ"], editedByHand: true })).toBeNull();
  });
});
