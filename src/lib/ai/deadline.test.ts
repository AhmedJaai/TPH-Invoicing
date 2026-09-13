import { describe, expect, it } from "vitest";
import { attemptTimeout, currentDeadline, withDeadline } from "./deadline";

describe("مهلة النداء تحت عمر الطلب", () => {
  it("بلا موعدٍ معلَن: المهلة الافتراضية", () => {
    expect(attemptTimeout(90_000, null)).toBe(90_000);
  });

  it("الموعد القريب يقصّ المهلة — لا تتجاوز ما بقي ناقصاً الهامش", () => {
    expect(attemptTimeout(90_000, 1_000_000 + 40_000, 1_000_000)).toBe(37_000);
  });

  it("لا تُبدأ محاولةٌ لم يبقَ لها ما يكفي", () => {
    expect(attemptTimeout(90_000, 1_000_000 + 6_000, 1_000_000)).toBeNull();
  });

  it("الموعد يُقرأ داخل المسار ولا يتسرّب خارجه", async () => {
    expect(currentDeadline()).toBeNull();
    const inside = await withDeadline(55_000, async () => currentDeadline());
    expect(inside).not.toBeNull();
    expect(currentDeadline()).toBeNull();
  });
});
