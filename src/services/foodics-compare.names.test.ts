import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const { namesAlike } = await import("./foodics-compare.service");

describe("شبهُ الاسم تلميحٌ لا هويّة", () => {
  it("الكلمةُ المميِّزة تجمع، ولو اختلفت الحروفُ كِبَراً أو همزةً أو تاءً", () => {
    expect(namesAlike("Aval", "AVAL")).toBe(true);
    expect(namesAlike("محمصة رونه", "رونة")).toBe(true);
    expect(namesAlike("Lava of kombucha", "Lava of Kombucha")).toBe(true);
  });
  it("الكلماتُ التي تصف الكيان لا تجمع", () => {
    expect(namesAlike("مورد حبوب قهوة", "مختبرات القهوة")).toBe(false);
    expect(namesAlike("شركة نادك", "شركة التوريد الماسي")).toBe(false);
    expect(namesAlike("Lanius", "Sard Co")).toBe(false);
  });
});
