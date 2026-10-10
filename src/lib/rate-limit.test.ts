import { describe, expect, it } from "vitest";
import { decide, isUnlimited, MEMORY_COUNTED_ROUTES, MemoryWindowCounter, ruleFor, RULES, windowStart } from "./rate-limit";

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
    expect(RULES.analyze.limit).toBeLessThan(RULES["mark-paid"].limit);
    /*
      والمزامنة خرجت من هذه القاعدة بقرارٍ صريح من صاحب العمل: حدُّها
      كان يوقفه عن إصلاح نظامه. وما يحميها الحارسُ والصلاحية، لا العدّاد.
    */
    expect(RULES["drive-sync"].limit).toBeGreaterThan(RULES.archive.limit);
  });

  it("الواجهة غير المعروفة لها حدّ افتراضي لا فراغ", () => {
    expect(ruleFor("لا-توجد").limit).toBeGreaterThan(0);
  });

  it("الاستعمال البشري المعتاد لا يصطدم بالحدّ", () => {
    // رفع عشرين فاتورة في ساعة عمل طبيعي
    expect(decide(20, RULES.analyze, at("2026-09-04T10:00:00Z")).allowed).toBe(true);
  });
});

describe("العدّ في الذاكرة", () => {
  const rule = { limit: 3, windowSeconds: 3600 };

  it("يعدّ داخل النافذة ويبدأ من واحدٍ في التالية", () => {
    const c = new MemoryWindowCounter();
    expect(c.hit("search:u1", rule, at("2026-10-09T10:01:00Z"))).toBe(1);
    expect(c.hit("search:u1", rule, at("2026-10-09T10:30:00Z"))).toBe(2);
    expect(c.hit("search:u2", rule, at("2026-10-09T10:30:00Z"))).toBe(1);
    expect(c.hit("search:u1", rule, at("2026-10-09T11:00:00Z"))).toBe(1);
  });

  it("والرابعُ في حدّ الثلاثة يُردّ", () => {
    const c = new MemoryWindowCounter();
    const now = at("2026-10-09T10:01:00Z");
    for (let i = 0; i < 3; i++) expect(decide(c.hit("k", rule, now), rule, now).allowed).toBe(true);
    expect(decide(c.hit("k", rule, now), rule, now).allowed).toBe(false);
  });

  it("ما حُفظ مردوداً يُقرأ في نافذته وحدها — والنافذةُ التالية تسأل القاعدة من جديد", () => {
    const c = new MemoryWindowCounter();
    c.remember("analyze:u1", rule, at("2026-10-09T10:59:00Z"), 4);
    expect(c.peek("analyze:u1", rule, at("2026-10-09T10:59:30Z"))).toBe(4);
    expect(c.peek("analyze:u1", rule, at("2026-10-09T11:00:01Z"))).toBe(0);
    expect(c.peek("analyze:other", rule, at("2026-10-09T10:59:30Z"))).toBe(0);
  });

  it("لا تكبر بلا حدّ", () => {
    const c = new MemoryWindowCounter(10);
    for (let i = 0; i < 50; i++) c.hit(`k${i}`, rule, at("2026-10-09T10:00:00Z"));
    expect(c.size).toBeLessThanOrEqual(10);
  });

  it("الذاكرةُ للقراءة الرخيصة وحدها — ما يكلّف نموذجاً أو يكتب مالاً يبقى في القاعدة", () => {
    expect([...MEMORY_COUNTED_ROUTES].sort()).toEqual(["notifications", "search"]);
    for (const route of ["analyze", "archive", "bank-import", "payment-run", "mark-paid", "month-close"]) {
      expect(MEMORY_COUNTED_ROUTES.has(route)).toBe(false);
    }
  });

  it("المزامنةُ وحدها بلا حدّ (قرار أحمد)", () => {
    const unlimited = Object.entries(RULES).filter(([, r]) => isUnlimited(r)).map(([k]) => k);
    expect(unlimited).toEqual(["drive-sync"]);
  });
});
