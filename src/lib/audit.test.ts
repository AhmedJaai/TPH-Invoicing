import { describe, expect, it } from "vitest";
import { diffCorrections } from "./audit";

describe("رصد التصحيحات اليدوية", () => {
  it("لا يرصد شيئاً حين لا يُعدَّل شيء", () => {
    const x = { invoiceNumber: "260302", totalAmount: "130.00" };
    expect(diffCorrections(x, x)).toEqual({});
  });

  it("يرصد الحقل المعدَّل وحده", () => {
    const d = diffCorrections(
      { invoiceNumber: "26O302", totalAmount: "130.00" },
      { invoiceNumber: "260302", totalAmount: "130.00" },
    );
    expect(Object.keys(d)).toEqual(["invoiceNumber"]);
    expect(d.invoiceNumber).toEqual({ from: "26O302", to: "260302" });
  });

  it("يتجاهل فروق المسافات الطرفية", () => {
    expect(diffCorrections({ a: "130.00" }, { a: " 130.00 " })).toEqual({});
  });

  it("يرصد ملء حقل كان فارغاً", () => {
    const d = diffCorrections({ invoiceDate: "" }, { invoiceDate: "2026-08-17" });
    expect(d.invoiceDate).toEqual({ from: "", to: "2026-08-17" });
  });

  it("يعامل غياب الحقل كفراغ لا كقيمة", () => {
    expect(diffCorrections({}, { a: "" })).toEqual({});
    const d = diffCorrections({}, { a: "x" });
    expect(d.a).toEqual({ from: null, to: "x" });
  });
});
