import { describe, expect, it } from "vitest";
import { ITEM, INVOICE, countNoun, nounForm } from "./arabic";

describe("nounForm", () => {
  it("الواحد والاثنان لهما صيغتاهما", () => {
    expect(nounForm(1, ITEM)).toBe("بند واحد");
    expect(nounForm(2, ITEM)).toBe("بندان");
  });

  it("من ثلاثة إلى عشرة جمع", () => {
    for (const n of [3, 7, 10]) expect(nounForm(n, ITEM)).toBe("بنود");
  });

  it("من أحد عشر فصاعداً مفرد منصوب", () => {
    for (const n of [11, 25, 99]) expect(nounForm(n, ITEM)).toBe("بنداً");
  });

  it("تعود الدورة عند المئة", () => {
    expect(nounForm(103, ITEM)).toBe("بنود");
    expect(nounForm(111, ITEM)).toBe("بنداً");
    expect(nounForm(100, ITEM)).toBe("بنداً");
    expect(nounForm(200, ITEM)).toBe("بنداً");
  });

  it("الصفر له صيغته حين تُذكر", () => {
    expect(nounForm(0, ITEM)).toBe("لا بنود");
    expect(nounForm(0, { one: "أ", two: "ب", few: "ج", many: "د" })).toBe("د");
  });

  it("السالب كالموجب في التمييز", () => {
    expect(nounForm(-2, ITEM)).toBe("بندان");
  });

  it("الكسر يُقتطع", () => {
    expect(nounForm(2.9, ITEM)).toBe("بندان");
  });
});

describe("countNoun", () => {
  it("لا يُذكر العدد مع الواحد والاثنين", () => {
    expect(countNoun(1, INVOICE)).toBe("فاتورة واحدة");
    expect(countNoun(2, INVOICE)).toBe("فاتورتان");
  });

  it("يُذكر العدد فيما سواهما", () => {
    expect(countNoun(5, INVOICE)).toBe("5 فواتير");
    expect(countNoun(65, INVOICE)).toBe("65 فاتورة");
  });

  it("الصفر بلا عدد", () => {
    expect(countNoun(0, INVOICE)).toBe("لا فواتير");
  });
});
