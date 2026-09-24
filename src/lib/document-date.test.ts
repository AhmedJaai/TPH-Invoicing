import { describe, expect, it } from "vitest";
import { normalizeDocumentDate } from "./document-date";

describe("تاريخُ المستند كما كُتب", () => {
  it("الصيغةُ القياسيّة تبقى كما هي", () => {
    expect(normalizeDocumentDate("2026-09-13")).toBe("2026-09-13");
  });

  it("يومٌ ثمّ شهرٌ ثمّ سنة — كما يُطبع في السعوديّة", () => {
    expect(normalizeDocumentDate("13/09/2026")).toBe("2026-09-13");
    expect(normalizeDocumentDate("05-09-2026")).toBe("2026-09-05");
    expect(normalizeDocumentDate("5.9.2026")).toBe("2026-09-05");
  });

  it("والوقتُ بعده لا يُسقطه", () => {
    expect(normalizeDocumentDate("13/09/2026 15:13:22")).toBe("2026-09-13");
    expect(normalizeDocumentDate("2026-09-13T15:13:22Z")).toBe("2026-09-13");
  });

  it("السنةُ أوّلاً بفاصلٍ آخر", () => {
    expect(normalizeDocumentDate("2026/9/13")).toBe("2026-09-13");
  });

  it("الأرقامُ العربيّة", () => {
    expect(normalizeDocumentDate("١٣/٠٩/٢٠٢٦")).toBe("2026-09-13");
  });

  it("الشهرُ أوّلاً حين لا يحتمل غيرَه", () => {
    expect(normalizeDocumentDate("09/13/2026")).toBe("2026-09-13");
  });

  it("وما لا يُفهَم مجهولٌ لا مخمَّن", () => {
    expect(normalizeDocumentDate("")).toBeNull();
    expect(normalizeDocumentDate(null)).toBeNull();
    expect(normalizeDocumentDate("سبتمبر")).toBeNull();
    expect(normalizeDocumentDate("31/02/2026")).toBeNull();
    expect(normalizeDocumentDate("1448-03-01")).toBeNull(); // هجريّ
  });
});
