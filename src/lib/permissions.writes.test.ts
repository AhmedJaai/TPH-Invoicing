import { describe, expect, it } from "vitest";
import { can } from "./permissions";

/**
 * الكتابة لا تُحرَس بصلاحية قراءة.
 *
 * كانت قواعد البنك واستيراده يُحرسان بـ`bank:view`، والمصروفات
 * بـ`amounts:view` — وكلاهما صلاحية اطّلاع. فالاسم يكذب على النيّة،
 * ولا يبقى ما يمنع منح الاطّلاع دون الكتابة.
 */
describe("فصل صلاحيات الكتابة عن القراءة", () => {
  it("مدير المشتريات لا يقرأ البنك ولا يكتب فيه", () => {
    expect(can("PURCHASING", "bank:view")).toBe(false);
    expect(can("PURCHASING", "bank:edit")).toBe(false);
    expect(can("PURCHASING", "expense:edit")).toBe(false);
  });

  it("المالك والمحاسب يكتبان في البنك والمصروفات", () => {
    for (const role of ["OWNER", "ACCOUNTANT"] as const) {
      expect(can(role, "bank:edit")).toBe(true);
      expect(can(role, "expense:edit")).toBe(true);
    }
  });

  it("اعتماد الدفعات يبقى للمالك وحده", () => {
    expect(can("OWNER", "payment:approve")).toBe(true);
    expect(can("ACCOUNTANT", "payment:approve")).toBe(false);
    expect(can("PURCHASING", "payment:approve")).toBe(false);
  });

  it("صلاحية الكتابة مستقلّة عن صلاحية القراءة في التعريف", () => {
    // من يملك الكتابة يملك القراءة، والعكس ليس لازماً
    for (const role of ["OWNER", "ACCOUNTANT", "PURCHASING"] as const) {
      if (can(role, "bank:edit")) expect(can(role, "bank:view")).toBe(true);
    }
  });
});
