import { describe, expect, it } from "vitest";
import { normalizeItem, priceKey, similarItems } from "./items";


describe("تطبيع أسماء الأصناف", () => {
  it("يوحّد الأرقام العربية واللاتينية", () => {
    expect(normalizeItem("حليب طازج ٢ لتر")).toBe(normalizeItem("حليب طازج 2 لتر"));
  });

  it("يوحّد صيغ الوحدة", () => {
    expect(normalizeItem("حليب 2 لتر")).toBe(normalizeItem("حليب 2 ل"));
    expect(normalizeItem("بن 1 كجم")).toBe(normalizeItem("بن 1 كيلو"));
    expect(normalizeItem("سكر 25 kg")).toBe(normalizeItem("سكر 25 كجم"));
  });

  it("يفصل الرقم عن الوحدة الملتصقة", () => {
    expect(normalizeItem("حليب 2ل")).toBe(normalizeItem("حليب 2 لتر"));
  });

  it("يتجاهل التشكيل والهمزات والرموز", () => {
    expect(normalizeItem("زبدة")).toBe(normalizeItem("زبده"));
    expect(normalizeItem("أكياس")).toBe(normalizeItem("اكياس"));
    expect(normalizeItem("بن  --  عربي")).toBe(normalizeItem("بن عربي"));
  });

  it("لا يدمج صنفين مختلفين فعلاً", () => {
    expect(normalizeItem("حليب كامل الدسم")).not.toBe(normalizeItem("حليب خالي الدسم"));
    expect(normalizeItem("بن اثيوبي")).not.toBe(normalizeItem("بن كولومبي"));
    expect(normalizeItem("حليب 1 لتر")).not.toBe(normalizeItem("حليب 2 لتر"));
  });

  it("مفتاح السعر يفصل المورّدين", () => {
    expect(priceKey("s1", "حليب 2 لتر")).not.toBe(priceKey("s2", "حليب 2 لتر"));
    expect(priceKey("s1", "حليب ٢ لتر")).toBe(priceKey("s1", "حليب 2 ل"));
  });
});

describe("الفاصلة العشرية في وصف الصنف", () => {
  it("«١٫٥ لتر» و«1.5 لتر» صنف واحد", () => {
    expect(normalizeItem("حليب ١٫٥ لتر")).toBe(normalizeItem("حليب 1.5 لتر"));
  });

  it("ولا تلتقي بـ«١٥ لتر»", () => {
    expect(normalizeItem("حليب ١٫٥ لتر")).not.toBe(normalizeItem("حليب ١٥ لتر"));
  });
});

describe("أقرب أصناف المورّد — للاقتراح لا للدمج", () => {
  const n = (s: string) => normalizeItem(s);
  it("صيغ الغربية تتقدّم: «عنب» و«كولومي عنب» لـ«كولومبي عنب»", () => {
    const out = similarItems(n("كولومبي عنب"), [n("بن سومطرة"), n("عنب"), n("كولومي عنب"), n("كولومبي بن")]);
    expect(out[0]).toBe(n("كولومي عنب"));
    expect(out).toContain(n("عنب"));
    expect(out).not.toContain(n("بن سومطرة"));
    /* «بن» وحدها لا تجمع صنفين */
    expect(similarItems(n("بن سومطرة"), [n("كولومبي بن")])).toEqual([]);
  });
  it("والأرقام المختلفة صنفان لا يقترح أحدهما للآخر", () => {
    expect(similarItems(n("كيس 1 كيلو"), [n("كيس 2 كيلو")])).toEqual([]);
  });
});

