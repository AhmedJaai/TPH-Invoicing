import { describe, expect, it } from "vitest";
import { formatQuantity } from "./team-units";

describe("كمّيّةُ التالف كما تُقرأ", () => {
  it("من المِلّي بلا كسرٍ عشريّ", () => {
    expect(formatQuantity(1500, "KG")).toBe("1.5 كجم");
    expect(formatQuantity(2000, "PIECE")).toBe("2 حبة");
    expect(formatQuantity(250, "L")).toBe("0.25 لتر");
  });
});
