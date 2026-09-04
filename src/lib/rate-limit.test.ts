import { describe, expect, it } from "vitest";
import { decide, ruleFor, RULES, windowStart } from "./rate-limit";

const at = (iso: string) => new Date(iso);

describe("windowStart", () => {
  it("يثبت داخل النافذة الواحدة", () => {
    const a = windowStart(at("2026-09-04T10:05:00Z"), 3600);
    const b = windowStart(at("2026-09-04T10:59:59Z"), 3600);
    expect(a.toISOString()).toBe(b.toISOString());
    expect(a.toISOString()).toBe("2026-09-04T10:00:00.000Z");
  });

  it("ينتقل عند تجاوز النافذة", () => {
    expect(windowStart(at("2026-09-04T11:00:00Z"), 3600).toISOString())
      .toBe("2026-09-04T11:00:00.000Z");
  });
});

describe("decide", () => {
  const rule = { limit: 3, windowSeconds: 3600 };

  it("يسمح ما دام العدّ في الحدّ", () => {
    expect(decide(1, rule, at("2026-09-04T10:05:00Z")).allowed).toBe(true);
    expect(decide(3, rule, at("2026-09-04T10:05:00Z")).allowed).toBe(true);
  });

  it("يمنع بعد تجاوز الحدّ", () => {
    const d = decide(4, rule, at("2026-09-04T10:05:00Z"));
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
  });

  it("يحسب المتبقّي", () => {
    expect(decide(1, rule, at("2026-09-04T10:00:00Z")).remaining).toBe(2);
  });

  it("يقول متى تتجدّد النافذة", () => {
    const d = decide(9, rule, at("2026-09-04T10:30:00Z"));
    expect(d.retryAfterSeconds).toBe(1800);
  });

  it("لا يعطي مهلة صفراً في آخر لحظة", () => {
    expect(decide(9, rule, at("2026-09-04T10:59:59Z")).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("RULES", () => {
  it("الواجهات المستهلكة للنموذج أضيق حدّاً", () => {
    expect(RULES.analyze.limit).toBeLessThan(RULES["supplier-alias"].limit);
    expect(RULES["drive-sync"].limit).toBeLessThan(RULES.archive.limit);
  });

  it("الواجهة غير المعروفة لها حدّ افتراضي لا فراغ", () => {
    expect(ruleFor("لا-توجد").limit).toBeGreaterThan(0);
  });

  it("الاستعمال البشري المعتاد لا يصطدم بالحدّ", () => {
    // رفع عشرين فاتورة في ساعة عمل طبيعي
    expect(decide(20, RULES.analyze, at("2026-09-04T10:00:00Z")).allowed).toBe(true);
  });
});
