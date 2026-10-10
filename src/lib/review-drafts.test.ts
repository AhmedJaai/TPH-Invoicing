import { describe, expect, it } from "vitest";
import { DRAFT_TTL_MS, expired, loadDrafts, saveDraft } from "./review-drafts";

describe("مسوّداتُ المراجعة", () => {
  const now = Date.UTC(2026, 9, 9, 12);

  it("تبقى يومين ثمّ تسقط — مسوّدةٌ نُسيت لا تبقى فاتورةً في متصفّح", () => {
    expect(expired(now - 60_000, now)).toBe(false);
    expect(expired(now - DRAFT_TTL_MS + 1, now)).toBe(false);
    expect(expired(now - DRAFT_TTL_MS - 1, now)).toBe(true);
  });

  it("تاريخٌ لا يُفهم أو من المستقبل يسقط", () => {
    expect(expired(Number.NaN, now)).toBe(true);
    expect(expired(now + 3_600_000, now)).toBe(true);
  });

  it("بلا IndexedDB (خادمٌ، أو متصفّحٌ يمنع التخزين) لا يرمي: لا استعادة ولا عطب", async () => {
    await expect(saveDraft("x", { a: 1 })).resolves.toBe(false);
    await expect(loadDrafts()).resolves.toEqual([]);
  });
});
