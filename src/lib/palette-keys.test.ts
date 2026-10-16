import { describe, expect, it } from "vitest";
import { movePaletteCursor } from "./palette-keys";

describe("تنقّل لوحة الأوامر بالمفاتيح", () => {
  const groups = ["RECENT", "RECENT", "ACTION", "ACTION", "ACTION", "PAGE", "PAGE"];

  it("السهمان يدوران عند الطرفين", () => {
    expect(movePaletteCursor(groups, 6, "ArrowDown")).toBe(0);
    expect(movePaletteCursor(groups, 0, "ArrowUp")).toBe(6);
  });

  it("Home و End لأوّل القائمة وآخرها", () => {
    expect(movePaletteCursor(groups, 4, "Home")).toBe(0);
    expect(movePaletteCursor(groups, 1, "End")).toBe(6);
  });

  it("Tab يقفز إلى أوّل المجموعة التالية ويدور", () => {
    expect(movePaletteCursor(groups, 0, "NextGroup")).toBe(2);
    expect(movePaletteCursor(groups, 3, "NextGroup")).toBe(5);
    expect(movePaletteCursor(groups, 6, "NextGroup")).toBe(0);
  });

  it("Shift+Tab: بداية مجموعتي من وسطها، ثمّ التي قبلها، ويدور", () => {
    expect(movePaletteCursor(groups, 4, "PrevGroup")).toBe(2);
    expect(movePaletteCursor(groups, 2, "PrevGroup")).toBe(0);
    expect(movePaletteCursor(groups, 0, "PrevGroup")).toBe(5);
  });

  it("قائمة فارغة لا تسقط شيئاً", () => {
    expect(movePaletteCursor([], 3, "NextGroup")).toBe(0);
  });
});
