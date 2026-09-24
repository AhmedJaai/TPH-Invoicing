import { describe, expect, it } from "vitest";
import { humanizeRefs } from "./finding-labels";
describe("humanizeRefs — رموز النموذج لا تُعرض", () => {
  const refs = [
    { ref: "F10", type: "invoice" as const, label: "فاتورة SI-0046 · 2026-09-04" },
    { ref: "F1", type: "invoice" as const, label: "فاتورة SI-0020 · 2026-08-12" },
    { ref: "P1", type: "payment" as const, label: "دفعة 2026-09-02 · 4,151.50" },
  ];

  it("الفاتورةُ برقمها والدفعةُ بتاريخها — ولا يلتبس F1 بـF10", () => {
    expect(humanizeRefs("فواتير F10 وF1 مفتوحة من دفعة P1.", refs))
      .toBe("فواتير SI-0046 وSI-0020 مفتوحة من دفعة 2026-09-02 · 4,151.50.");
  });

  it("ما لا مرجعَ له يبقى كما كُتب", () => {
    expect(humanizeRefs("وF12 أيضاً", refs)).toBe("وF12 أيضاً");
  });

  it("لا يمسّ رمزاً داخل كلمة", () => {
    expect(humanizeRefs("INVF1X", refs)).toBe("INVF1X");
  });
});
