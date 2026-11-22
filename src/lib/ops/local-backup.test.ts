import { describe, expect, it } from "vitest";
import {
  daysToPrune, disambiguate, errorSummary, failedDaysToPrune, isTransient, mirrorVersion, needsDownload, safeSegment,
  shouldNotify, pendingParts, coreComplete, buildHeartbeat, parseHeartbeat, backupVerdict, reportCoreOk, copyEntries,
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
  const ALL = ["القاعدة", "الشيفرة", "الأسرار", "الدرايف"];
  const okAll = Object.fromEntries(ALL.map((n) => [n, { ok: true, detail: "" }]));

  it("لا يُعاد يومٌ اكتمل إلّا بطلب، ويومٌ جديد يُشغَّل كلُّه", () => {
    expect(pendingParts({ day: "2026-10-30", results: okAll }, "2026-10-30", ALL, false)).toEqual([]);
    expect(pendingParts({ day: "2026-10-30", results: okAll }, "2026-10-30", ALL, true)).toEqual(ALL);
    expect(pendingParts({ day: "2026-10-29", results: okAll }, "2026-10-30", ALL, false)).toEqual(ALL);
    expect(pendingParts({}, "2026-10-30", ALL, false)).toEqual(ALL);
  });

  it("تعذّرُ الدرايف وحده يُعاد هو — لا تُنسخ القاعدةُ كلَّ ساعة", () => {
    const results = { ...okAll, "الدرايف": { ok: false, detail: "invalid_grant" } };
    expect(pendingParts({ day: "2026-11-22", results }, "2026-11-22", ALL, false)).toEqual(["الدرايف"]);
    expect(coreComplete(results)).toBe(true);
    expect(coreComplete({ ...okAll, "القاعدة": { ok: false, detail: "ETIMEDOUT" } })).toBe(false);
  });

  it("حالُ النسخة للتطبيق: المرآةُ المتعذّرة لا تُسقط تاريخَ آخر نسخةٍ للقاعدة", () => {
    const now = new Date("2026-11-22T14:00:00Z");
    const hb = buildHeartbeat(now, "2026-11-22", { ...okAll, "الدرايف": { ok: false, detail: "invalid_grant" } }, { lastSuccess: "2026-10-30T21:06:25Z" });
    expect(hb).toMatchObject({ coreOk: true, driveOk: false, lastCoreSuccess: now.toISOString(), lastFullSuccess: "2026-10-30T21:06:25Z" });
    expect(hb.failed).toEqual([{ part: "الدرايف", detail: "invalid_grant" }]);
    expect(parseHeartbeat(JSON.stringify(hb))).toEqual(hb);
    expect(parseHeartbeat("not json")).toBeNull();
    expect(parseHeartbeat(JSON.stringify({ at: 1 }))).toBeNull();
  });

  it("الحكم: القاعدةُ بعد يومين متأخّرة، والمرآةُ بعد أربعة، وبلا حالٍ «غير معروف»", () => {
    const now = new Date("2026-11-22T14:00:00Z");
    const hb = (core: string | null, full: string | null) => ({ at: now.toISOString(), day: "2026-11-22", coreOk: true, driveOk: true, lastCoreSuccess: core, lastFullSuccess: full, failed: [] });
    expect(backupVerdict(null, now).state).toBe("UNKNOWN");
    expect(backupVerdict(hb("2026-11-22T10:00:00Z", "2026-11-22T10:00:00Z"), now).state).toBe("OK");
    expect(backupVerdict(hb("2026-11-22T10:00:00Z", "2026-10-30T21:00:00Z"), now).state).toBe("MIRROR_STALE");
    expect(backupVerdict(hb("2026-11-19T10:00:00Z", "2026-11-19T10:00:00Z"), now).state).toBe("CORE_STALE");
    expect(backupVerdict(hb(null, null), now).state).toBe("CORE_STALE");
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
    /* ما ليس اسمُه تاريخاً لا يُكنس */
    expect(failedDaysToPrune([{ day: ".DS_Store", ok: false }, { day: "2026-10-30", ok: true }])).toEqual([]);
  });

  it("تقريرُ يومٍ قديم بلا `coreOk` يُحكم بأجزائه: الدرايفُ وحده لا يجعله ناقصاً (١–٢١ نوفمبر كُنست بهذا)", () => {
    const legacy = { ok: false, results: { "القاعدة": { ok: true, detail: "" }, "الشيفرة": { ok: true, detail: "" }, "الأسرار": { ok: true, detail: "" }, "الدرايف": { ok: false, detail: "invalid_grant" } } };
    expect(reportCoreOk(legacy)).toBe(true);
    expect(reportCoreOk({ ...legacy, results: { ...legacy.results, "القاعدة": { ok: false, detail: "ETIMEDOUT" } } })).toBe(false);
    expect(reportCoreOk({ ok: false, coreOk: true })).toBe(true);
    expect(reportCoreOk({ ok: true })).toBe(true);
    /* ما لا يُقرأ لا يُحذف */
    expect(reportCoreOk(null)).toBe(true);
    expect(reportCoreOk({})).toBe(true);
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

describe("النسخة الثانية خارج القرص", () => {
  it("الأسرارُ لا تخرج إلّا بطلبٍ صريح", () => {
    expect(copyEntries(["db", "code", "secrets", "memory", "report.json"], false)).toEqual(["db", "memory", "report.json"]);
    expect(copyEntries(["db", "secrets"], true)).toEqual(["db", "secrets"]);
  });
});

