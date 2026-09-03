import { describe, expect, it } from "vitest";
import { annualImpactMinor, detectPriceChange, normalizeItem, priceKey } from "./items";

const at = (iso: string, price: number) => ({ date: new Date(`${iso}T00:00:00Z`), unitPriceMinor: price });

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
    expect(normalizeItem("زُبْدَة")).toBe(normalizeItem("زبده"));
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

describe("كشف تغيّر السعر", () => {
  it("لا يكشف شيئاً من نقطة واحدة", () => {
    expect(detectPriceChange([at("2026-08-01", 1000)])).toBeNull();
  });

  it("لا يكشف شيئاً حين لا يتغيّر السعر أبداً", () => {
    expect(detectPriceChange([at("2026-08-01", 1000), at("2026-08-10", 1000)])).toBeNull();
  });

  it("يكشف الارتفاع ويحسب نسبته", () => {
    const c = detectPriceChange([at("2026-07-01", 1000), at("2026-08-01", 1200)]);
    expect(c).not.toBeNull();
    expect(c!.direction).toBe("up");
    expect(c!.deltaMinor).toBe(200);
    expect(c!.deltaRatio).toBeCloseTo(0.2);
  });

  it("يكشف الانخفاض", () => {
    const c = detectPriceChange([at("2026-07-01", 1200), at("2026-08-01", 1000)]);
    expect(c!.direction).toBe("down");
    expect(c!.deltaMinor).toBe(-200);
  });

  it("يتخطّى الأسعار المكرّرة ليجد التغيّر الحقيقي", () => {
    // النمط الشائع: سعر ثابت لأشهر ثم ارتفاع، وآخر فاتورتين متطابقتان
    const c = detectPriceChange([
      at("2026-05-01", 1000), at("2026-06-01", 1000),
      at("2026-07-01", 1200), at("2026-08-01", 1200),
    ]);
    expect(c).not.toBeNull();
    expect(c!.previousMinor).toBe(1000);
    expect(c!.currentMinor).toBe(1200);
  });

  it("لا يتأثّر بترتيب الإدخال", () => {
    const shuffled = [at("2026-08-01", 1200), at("2026-05-01", 1000), at("2026-07-01", 1000)];
    const c = detectPriceChange(shuffled);
    expect(c!.currentMinor).toBe(1200);
    expect(c!.previousMinor).toBe(1000);
  });

  it("لا يقسم على صفر", () => {
    const c = detectPriceChange([at("2026-07-01", 0), at("2026-08-01", 500)]);
    expect(c!.deltaRatio).toBe(0);
    expect(Number.isFinite(c!.deltaRatio)).toBe(true);
  });
});

describe("الأثر السنوي", () => {
  it("يضرب فرق السعر في الكمية السنوية", () => {
    const c = detectPriceChange([at("2026-07-01", 1000), at("2026-08-01", 1200)])!;
    expect(annualImpactMinor(c, 480)).toBe(96_000); // ٩٦٠ ريال سنوياً
  });

  it("الانخفاض يعطي أثراً سالباً أي توفيراً", () => {
    const c = detectPriceChange([at("2026-07-01", 1200), at("2026-08-01", 1000)])!;
    expect(annualImpactMinor(c, 100)).toBe(-20_000);
  });
});
