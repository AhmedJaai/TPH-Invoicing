import { describe, expect, it } from "vitest";
import { matchSupplier, similarity, type SupplierRecord } from "./supplier-match";
import { normalizeName } from "./suppliers-seed";

const make = (
  slug: string,
  nameAr: string,
  nameEn: string,
  vat: string | null,
  aliases: string[] = [],
): SupplierRecord => ({
  id: slug,
  slug,
  nameAr,
  nameEn,
  driveFolderName: nameEn,
  vatNumber: vat,
  issuesInvoices: true,
  contractOnFile: false,
  aliases: aliases.map((a) => ({ normalized: normalizeName(a) })),
});

const suppliers = [
  make("OliveLeaves", "أوراق الزيتون", "Olive Leaves", "310111111100003"),
  make("BeCof", "بيكوف", "BeCof", "310222222200003", ["KHALID SAED BN MAHFUS TRADING"]),
  make("SardCo", "سرد كو", "Sard Co", null, ["شركة الصرد للتعبئة"]),
  make("SardTrading", "سرد للتجارة", "Sard Trading", null),
];

describe("مطابقة المورد", () => {
  it("الرقم الضريبي يقطع الشك ولو اختلف الاسم تماماً", () => {
    const r = matchSupplier(suppliers, {
      sellerVatNumber: "310222222200003",
      supplierNameAr: "اسم لا يشبه شيئاً",
    });
    expect(r.method).toBe("VAT");
    expect(r.supplier?.slug).toBe("BeCof");
  });

  it("يتجاهل المسافات والشرطات في الرقم الضريبي", () => {
    const r = matchSupplier(suppliers, { sellerVatNumber: "3102-2222-2200-003" });
    expect(r.supplier?.slug).toBe("BeCof");
  });

  it("يطابق باسم المستفيد البنكي المسجَّل كاسم بديل", () => {
    const r = matchSupplier(suppliers, { supplierNameEn: "Khalid Saed Bn Mahfus Trading" });
    expect(r.method).toBe("ALIAS");
    expect(r.supplier?.slug).toBe("BeCof");
  });

  it("يطابق سرد كو باسمها العربي البديل ولا يخلطها بسرد للتجارة", () => {
    const r = matchSupplier(suppliers, { supplierNameAr: "شركة الصرد للتعبئة" });
    expect(r.supplier?.slug).toBe("SardCo");
  });

  it("يطابق بالاسم المباشر", () => {
    const r = matchSupplier(suppliers, { supplierNameAr: "أوراق الزيتون" });
    expect(r.method).toBe("NAME");
    expect(r.supplier?.slug).toBe("OliveLeaves");
  });

  it("لا يخمّن عند التشابه الملتبس بين اسمين متقاربين", () => {
    const r = matchSupplier(suppliers, { supplierNameAr: "سرد" });
    expect(r.supplier).toBeUndefined();
    expect(r.candidates.map((c) => c.slug).sort()).toEqual(["SardCo", "SardTrading"]);
  });

  it("يرجع بلا مطابقة لمورد مجهول تماماً", () => {
    const r = matchSupplier(suppliers, { supplierNameAr: "مؤسسة لا وجود لها" });
    expect(r.method).toBe("NONE");
    expect(r.supplier).toBeUndefined();
  });

  it("لا يطابق شيئاً حين لا يُستخرج اسم ولا رقم", () => {
    expect(matchSupplier(suppliers, {}).method).toBe("NONE");
  });
});

describe("قياس التشابه", () => {
  it("المطابقة التامة واحد والفراغ صفر", () => {
    expect(similarity("أوراق الزيتون", "أوراق الزيتون")).toBe(1);
    expect(similarity("", "شيء")).toBe(0);
  });

  it("الاحتواء الجزئي بين صفر وواحد", () => {
    const s = similarity("زيتون", "أوراق الزيتون");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});
