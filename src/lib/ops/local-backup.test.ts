import { describe, expect, it } from "vitest";
import { daysToPrune, disambiguate, mirrorVersion, needsDownload, safeSegment } from "./local-backup";

function range(from: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("daysToPrune", () => {
  it("يبقي آخر أربعة عشر يوماً وأوّلَ يومٍ من كلّ شهر", () => {
    const days = range("2026-08-01", 85); // حتّى ٢٤ أكتوبر
    const pruned = daysToPrune(days);
    const kept = days.filter((d) => !pruned.includes(d));
    expect(kept).toContain("2026-08-01");
    expect(kept).toContain("2026-09-01");
    expect(kept).toContain("2026-10-01");
    expect(kept.filter((d) => d >= "2026-10-11")).toHaveLength(14);
    expect(kept).toHaveLength(14 + 3);
    expect(pruned).toContain("2026-08-02");
  });

  it("لا يمسّ مجلّداً اسمُه ليس تاريخاً، ولا يحذف الأحدث أبداً", () => {
    expect(daysToPrune(["notes", "2026-01-01"], 0, 0)).toEqual([]);
    expect(daysToPrune(["2026-01-01", "2026-01-02"], 0, 0)).toEqual(["2026-01-01"]);
  });

  it("أوّلُ يومٍ مأخوذٍ في الشهر هو الباقي ولو لم يكن الأوّل", () => {
    const pruned = daysToPrune(["2026-03-05", "2026-03-09", ...range("2026-05-01", 14)], 14, 24);
    expect(pruned).toEqual(["2026-03-09"]);
  });
});

describe("أسماء الملفّات", () => {
  it("لا يخرج اسمٌ من مجلّده", () => {
    expect(safeSegment("../x")).toBe("..∕x");
    expect(safeSegment("a/b")).toBe("a∕b");
    expect(safeSegment("..")).toBe("_");
    expect(safeSegment("  ")).toBe("_");
    expect(safeSegment("فاتورة ١.pdf")).toBe("فاتورة ١.pdf");
  });

  it("الاسم المكرَّر يحمل بداية معرّفه قبل امتداده", () => {
    expect(disambiguate("a.pdf", "1234567890")).toBe("a [12345678].pdf");
    expect(disambiguate("README", "abcdefghij")).toBe("README [abcdefgh]");
  });
});

describe("needsDownload", () => {
  const yes = () => true;
  const no = () => false;
  it("الجديد يُنزَّل، والمتغيّر يُنزَّل، والثابت لا", () => {
    expect(needsDownload(undefined, "m1", "p", yes)).toBe(true);
    expect(needsDownload({ version: "m1", path: "p" }, "m2", "p", yes)).toBe(true);
    expect(needsDownload({ version: "m1", path: "p" }, "m1", "p", yes)).toBe(false);
  });
  it("ما غاب من القرص يُنزَّل من جديد", () => {
    expect(needsDownload({ version: "m1", path: "p" }, "m1", "p", no)).toBe(true);
  });
  it("مستند جوجل بوقت تعديله", () => {
    expect(mirrorVersion({ modifiedTime: "2026-01-01T00:00:00Z" })).toBe("t:2026-01-01T00:00:00Z");
    expect(mirrorVersion({ md5Checksum: "x", modifiedTime: "t" })).toBe("x");
  });
});
