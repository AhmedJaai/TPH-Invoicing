import { describe, expect, it } from "vitest";
import {
  AMOUNT_WINDOW_MINOR,
  amountRange,
  normalizeArabic,
  normalizeDigits,
  parseSearch,
  rankHits,
  type SearchHit,
} from "./search";

describe("parseSearch", () => {
  it("الفراغ لا يُنتج بحثاً", () => {
    expect(parseSearch("")).toBeNull();
    expect(parseSearch("   ")).toBeNull();
  });

  it("التاريخ الكامل يُقرأ تاريخاً", () => {
    const r = parseSearch("2026-08-17")!;
    expect(r.kind).toBe("DATE");
    expect(r.targets).toContain("invoices");
  });

  it("الشهر يُقرأ شهراً", () => {
    expect(parseSearch("2026-08")!.kind).toBe("MONTH");
  });

  it("خمسة عشر رقماً رقمٌ ضريبي، ويُبحث في المورّدين", () => {
    const r = parseSearch("310007971600003")!;
    expect(r.kind).toBe("VAT");
    expect(r.targets).toEqual(["suppliers"]);
  });

  it("المبلغ الصغير يُقرأ مبلغاً", () => {
    const r = parseSearch("47500")!;
    expect(r.kind).toBe("AMOUNT");
    expect(r.amountMinor).toBe(47_500_00);
  });

  it("الرقم الطويل يُقرأ رقم مستند، ويبقى المبلغ مطروحاً", () => {
    const r = parseSearch("260342")!;
    expect(r.kind).toBe("NUMBER");
    expect(r.term).toBe("260342");
    // لا يُفقد احتمال أنّه مبلغ
    expect(r.amountMinor).toBe(260_342_00);
  });

  it("الكسر يجعله مبلغاً مهما طال", () => {
    const r = parseSearch("1234567.89")!;
    expect(r.kind).toBe("AMOUNT");
    expect(r.amountMinor).toBe(1_234_567_89);
  });

  it("فاصل الآلاف يُفهم", () => {
    expect(parseSearch("1,414.87")!.amountMinor).toBe(1_414_87);
  });

  it("الأرقام العربية تُقرأ كاللاتينية", () => {
    const r = parseSearch("٤٧٥٠٠")!;
    expect(r.kind).toBe("AMOUNT");
    expect(r.amountMinor).toBe(47_500_00);
  });

  it("المرجع بحروف وأرقام يُقرأ رقماً", () => {
    const r = parseSearch("V405484")!;
    expect(r.kind).toBe("NUMBER");
    expect(r.term).toBe("V405484");
  });

  it("الاسم العربي يُقرأ نصّاً ويُبحث في المورّدين أوّلاً", () => {
    const r = parseSearch("لافا")!;
    expect(r.kind).toBe("TEXT");
    expect(r.targets[0]).toBe("suppliers");
  });

  it("النصّ يُوحَّد فلا تحجبه الهمزة ولا التاء المربوطة", () => {
    expect(parseSearch("مخبزة الأحمد")!.term).toBe(normalizeArabic("مخبزه الاحمد"));
  });
});

describe("normalizeDigits", () => {
  it("تحوّل كل الأرقام العربية", () => {
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });

  it("لا تمسّ اللاتينية ولا الحروف", () => {
    expect(normalizeDigits("V405")).toBe("V405");
  });
});

describe("normalizeArabic", () => {
  it("تُسقط التشكيل والتطويل", () => {
    expect(normalizeArabic("مُحَمَّـد")).toBe("محمد");
  });

  it("توحّد الألف والياء والتاء المربوطة", () => {
    expect(normalizeArabic("أوراق الزيتون")).toBe("اوراق الزيتون");
    expect(normalizeArabic("مخبزة")).toBe("مخبزه");
    expect(normalizeArabic("مصطفى")).toBe("مصطفي");
  });

  it("تُقلّص الفراغات", () => {
    expect(normalizeArabic("  لافا   كوفي ")).toBe("لافا كوفي");
  });
});

describe("amountRange", () => {
  it("نافذة ريال حول المبلغ", () => {
    expect(amountRange(47_500_00)).toEqual({ min: 47_499_00, max: 47_501_00 });
    expect(AMOUNT_WINDOW_MINOR).toBe(100);
  });

  it("لا تنزل تحت الصفر", () => {
    expect(amountRange(50).min).toBe(0);
  });
});

describe("rankHits", () => {
  const hit = (kind: SearchHit["kind"]): SearchHit => ({
    kind, id: kind, title: kind, subtitle: "", href: "/",
  });

  it("من بحث برقم يريد الفاتورة أوّلاً", () => {
    const r = rankHits([hit("supplier"), hit("invoice")], "NUMBER");
    expect(r[0].kind).toBe("invoice");
  });

  it("من بحث باسم يريد المورّد أوّلاً", () => {
    const r = rankHits([hit("bankTransaction"), hit("supplier")], "TEXT");
    expect(r[0].kind).toBe("supplier");
  });

  it("من بحث برقم ضريبي يريد المورّد", () => {
    const r = rankHits([hit("invoice"), hit("supplier")], "VAT");
    expect(r[0].kind).toBe("supplier");
  });

  it("لا يُفقد شيء من النتائج", () => {
    const all: SearchHit[] = ["invoice", "supplier", "product", "bankTransaction", "document"].map((k) => hit(k as SearchHit["kind"]));
    expect(rankHits(all, "TEXT")).toHaveLength(5);
  });
});
