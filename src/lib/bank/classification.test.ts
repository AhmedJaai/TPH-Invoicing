import { describe, expect, it } from "vitest";
import { toCanonical, type RawBankRow } from "./canonical";
import { buildMemory, classify, merchantKey } from "./classification";

const base: RawBankRow = {
  valueDate: new Date("2026-08-27T00:00:00Z"),
  amountMinor: 1_000_00,
  direction: "DEBIT",
};
const row = (over: Partial<RawBankRow>) => toCanonical({ ...base, ...over });

describe("الطبقة الأولى — البنية تحسم", () => {
  it("تسوية الشبكة تُعرَف من بنيتها لا من كلمة", () => {
    const c = classify(row({ direction: "CREDIT", description: "81140155-260718-POS MC Se ttlem 125207" }));
    expect(c.kind).toBe("POS_SETTLEMENT");
    expect(c.layer).toBe("STRUCTURE");
  });

  it("الوارد من الشبكة لم يعد ضجيجاً داخلياً", () => {
    const c = classify(row({ direction: "CREDIT", description: "REFERENCE : 81140155 MC26 0831 000000" }));
    expect(c.kind).not.toBe("INTERNAL_TRANSFER");
    expect(c.kind).toBe("POS_SETTLEMENT");
  });

  it("رسوم الشبكة وضريبتها تُفصلان", () => {
    expect(classify(row({ description: "81140155-260727-POS FV Fe es 825258" })).kind).toBe("POS_FEE");
    expect(classify(row({ description: "81140155-260724-POS VM VA T 607110" })).kind).toBe("POS_VAT");
  });

  it("الصفّ المتطابق يُصنَّف تصنيفاً واحداً دائماً", () => {
    const line = "81140155-260508-POS VS VA T 418069";
    const a = classify(row({ description: line }));
    const b = classify(row({ description: line }));
    expect(a).toEqual(b);
  });
});

describe("الطبقة الثانية — المتعلَّم يسبق الكلمات", () => {
  const memory = buildMemory([
    { key: "NAME:لوريفا كيك", kind: "SUPPLIER_PAYMENT", supplierId: "S1", at: new Date("2026-08-01") },
  ]);

  it("ما أكّده الإنسان يُقدَّم على الكلمة المفتاحية", () => {
    // الوصف فيه «رواتب» والمستفيد مؤكَّد أنّه مورّد
    const c = classify(
      row({ beneficiaryRaw: "لوريفا كيك", description: "BV:رواتب شهرية" }),
      memory,
    );
    expect(c.kind).toBe("SUPPLIER_PAYMENT");
    expect(c.layer).toBe("LEARNED");
    expect(c.reason).toContain("أكّدتَ");
  });

  it("بلا ذاكرة تعمل الكلمة", () => {
    const c = classify(row({ beneficiaryRaw: "لوريفا كيك", description: "BV:رواتب شهرية" }));
    expect(c.kind).toBe("SALARY");
    expect(c.layer).toBe("KEYWORD");
  });
});

describe("الطبقة الثالثة — الكلمات بشروطها", () => {
  it("«شراء بضاعة» يُقدَّم على «رواتب» في الوصف نفسه", () => {
    const c = classify(row({ description: "سالم باحاج BV:رواتب شهرية شراء بضاعة 12178872" }));
    expect(c.kind).toBe("SUPPLIER_PAYMENT");
    expect(c.reason).toContain("شراء بضاعة");
  });

  it("زاتكا حكوميّة لا صدقة", () => {
    expect(classify(row({ description: "ZATCA سداد ضريبة" })).kind).toBe("GOVERNMENT");
  });

  it("إيجار من منصّة إيجار", () => {
    expect(classify(row({ description: "EJAR رقم السداد20904553589" })).kind).toBe("RENT");
  });

  it("الاتجاه شرطٌ: الراتب صادر لا وارد", () => {
    expect(classify(row({ direction: "CREDIT", description: "رواتب شهرية" })).kind).not.toBe("SALARY");
  });

  it("الكهرباء تُعرَف من اسم الشركة", () => {
    expect(classify(row({ description: "Saudi Energy رقم السداد30151604771" })).kind).toBe("UTILITY");
  });
});

describe("الطبقة الرابعة — المجهول يُعلَن", () => {
  it("الصادر المجهول يُقال عنه مجهول", () => {
    const c = classify(row({ description: "تحويل الى حساب" }));
    expect(c.kind).toBe("UNKNOWN");
    expect(c.layer).toBe("NONE");
  });

  it("الوارد المجهول لا يُفترَض ضجيجاً — وهذا كان الخلل", () => {
    const c = classify(row({ direction: "CREDIT", description: "ايداع" }));
    expect(c.kind).toBe("UNKNOWN");
    expect(c.reason).toContain("لا يُفترَض أنّه ضجيج");
  });
});

describe("merchantKey", () => {
  it("رقم الحساب أثبت من الاسم", () => {
    expect(merchantKey(row({ description: "تحويل 12600000942005", beneficiaryRaw: "فلان" })))
      .toBe("ACC:12600000942005");
  });

  it("ثمّ رقم الهوية", () => {
    expect(merchantKey(row({ description: "BEN ID:1115891903", beneficiaryRaw: "فلان" })))
      .toBe("ID:1115891903");
  });

  it("ثمّ الاسم موحَّداً", () => {
    expect(merchantKey(row({ beneficiaryRaw: "  لوريفا   كيك " }))).toBe("NAME:لوريفا كيك");
  });

  it("الاسم القصير جداً لا يصلح مفتاحاً", () => {
    expect(merchantKey(row({ beneficiaryRaw: "أب" }))).toBeNull();
  });
});

describe("buildMemory", () => {
  it("التأكيد المتكرّر يُعدّ", () => {
    const m = buildMemory([
      { key: "K", kind: "RENT", supplierId: null, at: new Date("2026-01-01") },
      { key: "K", kind: "RENT", supplierId: null, at: new Date("2026-02-01") },
    ]);
    expect(m.get("K")!.confirmations).toBe(2);
  });

  it("التضارب يُحسم للأحدث لا للأغلبية — الباب قد يتغيّر فعلاً", () => {
    const m = buildMemory([
      { key: "K", kind: "SALARY", supplierId: null, at: new Date("2026-01-01") },
      { key: "K", kind: "SALARY", supplierId: null, at: new Date("2026-02-01") },
      { key: "K", kind: "SUPPLIER_PAYMENT", supplierId: "S1", at: new Date("2026-03-01") },
    ]);
    expect(m.get("K")!.kind).toBe("SUPPLIER_PAYMENT");
    expect(m.get("K")!.confirmations).toBe(1);
  });

  it("لا تأكيدات فلا ذاكرة", () => {
    expect(buildMemory([]).size).toBe(0);
  });
});
