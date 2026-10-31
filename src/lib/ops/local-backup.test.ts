import { describe, expect, it } from "vitest";
import {
  daysToPrune, disambiguate, errorSummary, failedDaysToPrune, isTransient, mirrorVersion, needsDownload, safeSegment,
  shouldNotify, shouldRun,
} from "./local-backup";

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

describe("التشغيل كلَّ ساعة", () => {
  it("لا يُعاد يومٌ اكتمل إلّا بطلب", () => {
    expect(shouldRun({ successDay: "2026-10-30" }, "2026-10-30", false)).toBe(false);
    expect(shouldRun({ successDay: "2026-10-30" }, "2026-10-30", true)).toBe(true);
    expect(shouldRun({ successDay: "2026-10-29" }, "2026-10-30", false)).toBe(true);
    expect(shouldRun({}, "2026-10-30", false)).toBe(true);
  });

  it("إشعارٌ واحد في اليوم، وبعد يومٍ ونصف بلا نسخةٍ كاملة", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(shouldNotify({ lastSuccess: "2026-10-30T01:00:00Z" }, "2026-10-30", now)).toBe(false);
    expect(shouldNotify({ lastSuccess: "2026-10-27T10:00:00Z" }, "2026-10-30", now)).toBe(true);
    expect(shouldNotify({ lastSuccess: "2026-10-27T10:00:00Z", notifiedDay: "2026-10-30" }, "2026-10-30", now)).toBe(false);
    expect(shouldNotify({}, "2026-10-30", now)).toBe(true);
  });

  it("الأيّام الناقصة قبل آخر يومٍ كامل تُحذف، وما بعده يبقى", () => {
    expect(failedDaysToPrune([
      { day: "2026-10-26", ok: false }, { day: "2026-10-27", ok: true },
      { day: "2026-10-28", ok: false }, { day: "2026-10-30", ok: true }, { day: "2026-10-31", ok: false },
    ])).toEqual(["2026-10-26", "2026-10-28"]);
    expect(failedDaysToPrune([{ day: "2026-10-26", ok: false }])).toEqual([]);
  });
});

describe("errorSummary", () => {
  it("يأخذ سطر الخطأ لا ذيل المكدّس", () => {
    const out = "file:///x.js:12\n  throw e\nError: read ECONNRESET\n    at TLSWrap.onStreamRead\n{\n  errno: -54\n}\n\nNode.js v20.20.2";
    expect(errorSummary(out)).toBe("Error: read ECONNRESET");
    expect(errorSummary("✕ getaddrinfo ENOTFOUND host")).toBe("getaddrinfo ENOTFOUND host");
    expect(errorSummary("}\nNode.js v20.20.2\n")).toBe("توقّف بلا رسالة");
  });
  it("العابرُ يُعاد، والدائمُ لا", () => {
    expect(isTransient("read ECONNRESET")).toBe(true);
    expect(isTransient("getaddrinfo ENOTFOUND x")).toBe(true);
    expect(isTransient("Request had invalid authentication credentials.")).toBe(true);
    expect(isTransient("relation \"x\" does not exist")).toBe(false);
  });
});
