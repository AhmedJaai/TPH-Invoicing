import { describe, expect, it } from "vitest";
import { sameQuantity } from "./same-quantity";

describe("sameQuantity — الكمّيّةُ نفسُها بصيغتين", () => {
  it("الأصفارُ الأخيرة والأرقامُ العربيّة لا تغيّر الكمّيّة", () => {
    expect(sameQuantity("1.600", "1.6")).toBe(true);
    expect(sameQuantity("5.850", "5.85")).toBe(true);
    expect(sameQuantity("7.800", "7.8")).toBe(true);
    expect(sameQuantity("3165", "3165.0")).toBe(true);
    expect(sameQuantity("١٫٦", "1.6")).toBe(true);
    expect(sameQuantity(" 2 ", "2")).toBe(true);
  });
  it("والمختلفُ يبقى مختلفاً، والفراغُ «لم يُعدّ» لا صفر", () => {
    expect(sameQuantity("1.601", "1.6")).toBe(false);
    expect(sameQuantity("0", "")).toBe(false);
    expect(sameQuantity("", "")).toBe(true);
  });
  it("الفاصلةُ الملتبسة لا تُخمَّن: «1,600» ليست «1.6» ولا «1600»", () => {
    expect(sameQuantity("1,600", "1.6")).toBe(false);
    expect(sameQuantity("1,600", "1600")).toBe(false);
    expect(sameQuantity("1,600", "1,600")).toBe(true);
  });
});
