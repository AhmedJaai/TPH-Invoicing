import { describe, expect, it } from "vitest";
import { readSinceYesterday, sinceYesterday } from "./since-yesterday";

describe("منذ صباح أمس", () => {
  it("الفرقُ عن لقطة أمس — زيادةً ونقصاً وثباتاً", () => {
    expect(sinceYesterday(1_500_00, 1_200_00, "2026-10-23")).toEqual({ known: true, delta: 300_00, day: "2026-10-23" });
    expect(sinceYesterday(9, 12, "2026-10-23")).toEqual({ known: true, delta: -3, day: "2026-10-23" });
    expect(sinceYesterday(0, 0, "2026-10-23")).toEqual({ known: true, delta: 0, day: "2026-10-23" });
  });

  it("لا لقطة لأمس: غير معروف — لا صفر", () => {
    expect(sinceYesterday(1_500_00, undefined, "2026-10-23")).toEqual({ known: false, day: "2026-10-23", reason: "no-snapshot" });
  });

  it("النقدُ المجهول أمس أو اليوم: غير معروف", () => {
    expect(sinceYesterday(5_00, null, "2026-10-23")).toMatchObject({ known: false, reason: "unknown-value" });
    expect(sinceYesterday(null, 5_00, "2026-10-23")).toMatchObject({ known: false, reason: "unknown-value" });
  });

  it("الردُّ يُقرأ بشكله، وما لا يُقرأ لا يُعرض", () => {
    expect(readSinceYesterday({ known: true, delta: 5, day: "2026-10-23" })).toEqual({ known: true, delta: 5, day: "2026-10-23" });
    expect(readSinceYesterday({ known: false, day: "2026-10-23", reason: "no-snapshot" })).toMatchObject({ known: false });
    expect(readSinceYesterday({ known: true, delta: 1.5, day: "2026-10-23" })).toBeNull();
    expect(readSinceYesterday({ known: true, delta: 5, day: "23/10" })).toBeNull();
    expect(readSinceYesterday(null)).toBeNull();
  });
});
