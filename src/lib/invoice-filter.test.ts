import { describe, expect, it } from "vitest";
import { describe as describeFilters, hasFilters, linkTo, parseFilters } from "./invoice-filter";

describe("parseFilters", () => {
  it("الفراغ ينتج الصفحة الأولى بلا ترشيح", () => {
    const f = parseFilters({});
    expect(f.page).toBe(1);
    expect(hasFilters(f)).toBe(false);
  });

  it("ترفض قيمة ليست من القائمة", () => {
    expect(parseFilters({ tax: "WHATEVER" }).tax).toBeUndefined();
    expect(parseFilters({ paid: "MAYBE" }).paid).toBeUndefined();
  });

  it("ترفض شهراً غير صالح", () => {
    expect(parseFilters({ month: "2026-8" }).month).toBeUndefined();
    expect(parseFilters({ month: "2026-08" }).month).toBe("2026-08");
  });

  it("الصفحة لا تكون صفراً ولا سالبة ولا كسراً", () => {
    expect(parseFilters({ page: "0" }).page).toBe(1);
    expect(parseFilters({ page: "-3" }).page).toBe(1);
    expect(parseFilters({ page: "abc" }).page).toBe(1);
    expect(parseFilters({ page: "2.7" }).page).toBe(2);
  });

  it("الأعلام تقرأ من «1» وحدها", () => {
    expect(parseFilters({ noLines: "1" }).noLines).toBe(true);
    expect(parseFilters({ noLines: "true" }).noLines).toBe(false);
  });
});

describe("linkTo", () => {
  it("يبني رابطاً نظيفاً بلا ترشيح", () => {
    expect(linkTo(parseFilters({}), {})).toBe("/purchases/invoices");
  });

  it("يحفظ ما كان ويضيف الجديد", () => {
    const f = parseFilters({ month: "2026-08" });
    expect(linkTo(f, { tax: "INVALID" })).toBe("/purchases/invoices?month=2026-08&tax=INVALID");
  });

  it("يزيل المرشّح حين يمرّر undefined", () => {
    const f = parseFilters({ month: "2026-08", tax: "INVALID" });
    expect(linkTo(f, { tax: undefined })).toBe("/purchases/invoices?month=2026-08");
  });

  it("التعديل يعيد إلى الصفحة الأولى", () => {
    const f = parseFilters({ page: "5", tax: "INVALID" });
    expect(linkTo(f, { tax: "VALID" })).not.toContain("page");
  });

  it("الصفحة تذكر حين تطلب صراحةً", () => {
    expect(linkTo(parseFilters({}), { page: 3 })).toBe("/purchases/invoices?page=3");
  });
});

describe("describe", () => {
  it("تقول ما يعرض لا اسم الصفحة", () => {
    expect(describeFilters(parseFilters({}))).toBe("كل الفواتير");
    expect(describeFilters(parseFilters({ tax: "INVALID" }))).toBe("بياناتها الضريبية ناقصة");
    expect(describeFilters(parseFilters({ tax: "INVALID", month: "2026-08" })))
      .toBe("بياناتها الضريبية ناقصة · في 2026-08");
    expect(describeFilters(parseFilters({ overdue: "1" }))).toContain("60");
    expect(describeFilters(parseFilters({ supplier: "Loreva" }), "لوريفا كيك")).toBe("من لوريفا كيك");
    expect(describeFilters(parseFilters({ supplier: "Loreva" }))).toBe("من Loreva");
  });
});

describe("مرشّح الأصول الثابتة", () => {
  it("يقرأ من الرابط ويكتب فيه ويوصف", () => {
    const f = parseFilters({ asset: "1", month: "2026-09" });
    expect(f.fixedAsset).toBe(true);
    expect(linkTo(f, {})).toBe("/purchases/invoices?month=2026-09&asset=1");
    expect(linkTo(f, { fixedAsset: false })).toBe("/purchases/invoices?month=2026-09");
    expect(hasFilters(parseFilters({ asset: "1" }))).toBe(true);
    expect(describeFilters(parseFilters({ asset: "1" }))).toContain("أصول ثابتة");
    expect(parseFilters({ asset: "yes" }).fixedAsset).toBe(false);
  });
});

