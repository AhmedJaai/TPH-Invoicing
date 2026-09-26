import { describe, expect, it } from "vitest";
import { isInspectorPath, pathOf, txHref } from "./inspector";

describe("لوحُ الفحص", () => {
  it("يفتح ملفّاتِ السجلّات الأربعة لوحاً", () => {
    expect(isInspectorPath("/suppliers/almarai")).toBe(true);
    expect(isInspectorPath("/purchases/invoices/abc#tax")).toBe(true);
    expect(isInspectorPath("/inventory/items/x?y=1")).toBe(true);
    expect(isInspectorPath(txHref("t1"))).toBe(true);
  });

  it("لا يعترض القوائمَ ولا ما يُطبع ولا ما يُعدّ", () => {
    expect(isInspectorPath("/suppliers")).toBe(false);
    expect(isInspectorPath("/suppliers/almarai/statement")).toBe(false);
    expect(isInspectorPath("/purchases/invoices")).toBe(false);
    expect(isInspectorPath("/inventory/counts/c1")).toBe(false);
    expect(isInspectorPath("/bank?tx=1")).toBe(false);
  });

  it("يقرأ المسارَ بلا استعلامٍ ولا مرساة", () => {
    expect(pathOf("/a/b?x=1#y")).toBe("/a/b");
    expect(pathOf("/a#y")).toBe("/a");
  });
});
