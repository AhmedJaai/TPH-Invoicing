import { describe, expect, it } from "vitest";
import { checkCronAuth, decodeCronRun, encodeCronRun, ranRecently } from "./cron";

describe("سرّ التشغيل المجدول", () => {
  it("السرُّ الغائب في الخادم يرفض كلَّ طلب — لا «كلُّ أحدٍ مأذون»", () => {
    expect(checkCronAuth("Bearer anything", undefined)).toBe("unset");
    expect(checkCronAuth("Bearer anything", "")).toBe("unset");
    expect(checkCronAuth("Bearer ", "   ")).toBe("unset");
  });

  it("بلا ترويسة، أو بغير Bearer: غائب", () => {
    expect(checkCronAuth(null, "s3cret")).toBe("missing");
    expect(checkCronAuth("s3cret", "s3cret")).toBe("missing");
    expect(checkCronAuth("Basic s3cret", "s3cret")).toBe("missing");
    expect(checkCronAuth("Bearer", "s3cret")).toBe("missing");
  });

  it("سرٌّ خاطئ — وإن كان بادئةً للصحيح أو أطول منه", () => {
    expect(checkCronAuth("Bearer wrong", "s3cret")).toBe("wrong");
    expect(checkCronAuth("Bearer s3cre", "s3cret")).toBe("wrong");
    expect(checkCronAuth("Bearer s3cretX", "s3cret")).toBe("wrong");
  });

  it("السرُّ الصحيح يمرّ", () => {
    expect(checkCronAuth("Bearer s3cret", "s3cret")).toBe("ok");
    expect(checkCronAuth("  Bearer   s3cret  ", "s3cret")).toBe("ok");
  });
});

describe("أثرُ آخر تشغيل", () => {
  const at = new Date("2026-10-23T03:00:00Z");

  it("يُحفَظ ويُقرأ كما هو", () => {
    expect(decodeCronRun(encodeCronRun({ ok: false, result: "تفويض الدرايف غائب" }), at))
      .toEqual({ at, ok: false, result: "تفويض الدرايف غائب" });
  });

  it("ما ليس أثراً (عقدٌ أو بصمة) لا يُقرأ أثراً", () => {
    expect(decodeCronRun("6b1f-uuid", at)).toBeNull();
    expect(decodeCronRun(JSON.stringify({ ok: "yes", result: 1 }), at)).toBeNull();
    expect(decodeCronRun("null", at)).toBeNull();
  });

  it("والنتيجةُ الطويلة تُقصّ", () => {
    const run = decodeCronRun(encodeCronRun({ ok: true, result: "x".repeat(1000) }), at);
    expect(run?.result.length).toBe(400);
  });
});

describe("أنجح تشغيلٌ مجدول قريباً؟ — به تتنحّى القشرة", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const H = 3_600_000;
  const run = (ok: boolean, hoursAgo: number) => ({ ok, result: "", at: new Date(now - hoursAgo * H) });

  it("ناجحٌ داخل النافذة: تتنحّى", () => {
    expect(ranRecently(run(true, 1), 3 * H, now)).toBe(true);
  });

  it("ناجحٌ خارجها، أو فاشل، أو لا تشغيل: تعمل القشرةُ احتياطاً", () => {
    expect(ranRecently(run(true, 3), 3 * H, now)).toBe(false);
    expect(ranRecently(run(false, 0.1), 3 * H, now)).toBe(false);
    expect(ranRecently(null, 3 * H, now)).toBe(false);
  });

  it("وطابعٌ في المستقبل (ساعةٌ منحرفة) لا يُعدّ قريباً", () => {
    expect(ranRecently(run(true, -1), 3 * H, now)).toBe(false);
  });
});
