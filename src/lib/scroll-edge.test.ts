import { describe, expect, it } from "vitest";
import { overflowSide, revealDelta } from "./scroll-edge";

describe("حافّة الشريط الذي يُمرَّر عرضاً", () => {
  it("لا حافّة حين يسع المحتوى وعاءه (ولو بفرق بكسلٍ كسريّ)", () => {
    expect(overflowSide(300, 300, 0)).toBe("none");
    expect(overflowSide(300.8, 300, 0)).toBe("none");
  });
  it("في أوّله: المزيدُ عند النهاية", () => {
    expect(overflowSide(600, 300, 0)).toBe("end");
  });
  it("في وسطه: من الجهتين — و`scrollLeft` السالب في RTL يُؤخذ مطلقه", () => {
    expect(overflowSide(600, 300, -150)).toBe("both");
    expect(overflowSide(600, 300, 150)).toBe("both");
  });
  it("في آخره: المزيدُ عند البداية", () => {
    expect(overflowSide(600, 300, -300)).toBe("start");
    expect(overflowSide(600, 300, 299.5)).toBe("start");
  });
});

describe("اللسانُ المختار يُمرَّر إلى الوسط", () => {
  const box = { left: 0, right: 400 };
  it("الظاهرُ كلُّه لا يُحرَّك", () => {
    expect(revealDelta(box, { left: 100, right: 180 })).toBe(0);
  });
  it("المقصوصُ على اليسار (آخرُ لسانٍ في RTL) يُحرَّك سالباً إلى الوسط", () => {
    expect(revealDelta(box, { left: -60, right: 20 })).toBe(-220);
  });
  it("الخارجُ يميناً يُحرَّك موجباً", () => {
    expect(revealDelta(box, { left: 380, right: 460 })).toBe(220);
  });
});
