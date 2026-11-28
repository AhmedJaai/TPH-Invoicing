import { describe, expect, it } from "vitest";
import { daysToPayday, payStatus } from "./pay-status";

describe("حالُ الموظّف في الشهر — من قسيمته وحدها", () => {
  it("لم يُحوَّل له شيء والمستحقّ معروف ← لم يصله شيء", () => {
    expect(payStatus({ dueMinor: 350_000, paidMinor: 0, remainingMinor: 350_000 })).toBe("NONE");
  });
  it("وصله جزء ← جزئيّ", () => {
    expect(payStatus({ dueMinor: 350_000, paidMinor: 100_000, remainingMinor: 250_000 })).toBe("PARTIAL");
  });
  it("الباقي صفر ← اكتمل، والسالب ← حُوّل زيادة", () => {
    expect(payStatus({ dueMinor: 350_000, paidMinor: 350_000, remainingMinor: 0 })).toBe("DONE");
    expect(payStatus({ dueMinor: 350_000, paidMinor: 400_000, remainingMinor: -50_000 })).toBe("OVER");
  });
  it("راتبٌ لم يُكتب لا يُعدّ «لم يصله شيء» ولا «اكتمل» — المجهولُ ليس صفراً", () => {
    expect(payStatus({ dueMinor: null, paidMinor: 0, remainingMinor: null })).toBe("UNKNOWN");
    expect(payStatus({ dueMinor: null, paidMinor: 200_000, remainingMinor: null })).toBe("UNKNOWN");
  });
  it("مستحقٌّ صفر بلا تحويل (سلفُه غطّته) ← اكتمل لا «لم يصله شيء»", () => {
    expect(payStatus({ dueMinor: 0, paidMinor: 0, remainingMinor: 0 })).toBe("DONE");
  });
});

describe("الأيّامُ حتى يوم الصرف", () => {
  it("في الشهر نفسه قبل يومه", () => {
    expect(daysToPayday("2026-11", "2026-11-26", 27)).toBe(1);
    expect(daysToPayday("2026-11", "2026-11-27", 27)).toBe(0);
  });
  it("بعد يومه أو لشهرٍ آخر لا يُقال", () => {
    expect(daysToPayday("2026-11", "2026-11-28", 27)).toBeNull();
    expect(daysToPayday("2026-10", "2026-11-03", 27)).toBeNull();
  });
});
