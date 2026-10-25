import { describe, expect, it } from "vitest";
import { DAY, FIELD, GAP, ITEM, INVOICE, OPPORTUNITY, OTHER_ITEM, QUOTATION, SECOND, TIME, countNoun, doesNotBlock, mustBeResolved, nounForm } from "./arabic";

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

describe("الصيغ التي كانت ناقصة", () => {
  /*
    كلٌّ من هذه ظهر في الشاشة بعددٍ لا يميّزه: «2 مرّات» في أوّل بطاقة من
    «يحتاج انتباهك»، و«منذ 106 يوماً» تحتها — والمئة تُعيد الدورة فالصواب
    «106 أيّام». والخطأ في عددٍ يقرؤه صاحب العمل كلّ صباح يُفقد الثقة بما
    حوله، وما حوله مالُه.
  */
  it("المرّة", () => {
    expect(countNoun(2, TIME)).toBe("مرّتين");
    expect(countNoun(5, TIME)).toBe("5 مرّات");
  });

  it("اليوم — والقاعدة تدور عند المئة", () => {
    expect(countNoun(106, DAY)).toBe("106 أيّام");
    expect(countNoun(60, DAY)).toBe("60 يوماً");
    expect(countNoun(1, DAY)).toBe("يوم واحد");
  });

  it("الفجوة", () => {
    expect(countNoun(1, GAP)).toBe("فجوة واحدة");
    expect(countNoun(4, GAP)).toBe("4 فجوات");
    expect(countNoun(12, GAP)).toBe("12 فجوة");
  });

  it("الفرصة", () => {
    expect(countNoun(2, OPPORTUNITY)).toBe("فرصتان");
    expect(countNoun(3, OPPORTUNITY)).toBe("3 فرص");
  });

  it("الحقل", () => {
    expect(countNoun(3, FIELD)).toBe("3 حقول");
    expect(countNoun(12, FIELD)).toBe("12 حقلاً");
  });

  it("عرض السعر", () => {
    expect(countNoun(1, QUOTATION)).toBe("عرض سعر واحد");
    expect(countNoun(2, QUOTATION)).toBe("عرضا سعر");
    expect(countNoun(6, QUOTATION)).toBe("6 عروض أسعار");
  });
});

describe("SECOND — مدّةُ الانتظار بجانب الزرّ", () => {
  it("«منذ ثانيتين» و«منذ ٥ ثوانٍ» و«منذ ١٢ ثانية»", () => {
    expect(countNoun(2, SECOND)).toBe("ثانيتين");
    expect(countNoun(5, SECOND)).toBe("5 ثوانٍ");
    expect(countNoun(12, SECOND)).toBe("12 ثانية");
  });
});

describe("الصفةُ والفعلُ يتبعان العدد", () => {
  it("«آخر» بالعدد: بند آخر · بندان آخران · ٣ بنود أخرى · ١٢ بنداً آخر", () => {
    expect(countNoun(1, OTHER_ITEM)).toBe("بند آخر");
    expect(countNoun(2, OTHER_ITEM)).toBe("بندان آخران");
    expect(countNoun(3, OTHER_ITEM)).toBe("3 بنود أخرى");
    expect(countNoun(12, OTHER_ITEM)).toBe("12 بنداً آخر");
  });

  it("«لا يمنع» و«يجب حلّه» بالعدد", () => {
    expect([1, 2, 5, 11].map(doesNotBlock)).toEqual(["لا يمنع", "لا يمنعان", "لا تمنع", "لا تمنع"]);
    expect([1, 2, 4].map(mustBeResolved)).toEqual(["يجب حلّه", "يجب حلّهما", "يجب حلّها"]);
  });
});
