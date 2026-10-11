import { expect, it } from "vitest";
import { formatShare, formatUnits } from "./format";

it("الكمّيّةُ بفواصل الآلاف وبلا أصفارٍ زائدة", () => {
  expect(formatUnits(1_169_000)).toBe("1,169");
  expect(formatUnits(2_500)).toBe("2.5");
  expect(formatUnits(-750)).toBe("−0.75");
});

it("النسبةُ بخانة، والمجهولُ ليس صفراً", () => {
  expect(formatShare(7_922)).toContain("79.2٪");
  expect(formatShare(-1_050)).toContain("−10.5٪");
  expect(formatShare(null)).toBe("غير معروف");
});
