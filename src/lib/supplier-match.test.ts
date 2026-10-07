import { describe, expect, it } from "vitest";
import { matchSupplier, resolveNewSupplierName, similarity, trigramSimilarity, type SupplierRecord } from "./supplier-match";
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

/* ═══════════════════════════════════════════════════════════════
   الاسم النظاميّ يحوي اسمَ الشهرة

   وُجد على كشف أوراق الزيتون الحقيقيّ: المستند يقول «مؤسسة أوراق
   الزيتون التجارية» والمخزَّن «أوراق الزيتون». والتشابهُ الحرفيّ
   بينهما ٠٫٦٧ — دون حدّ الترجيح — فيُردّ الكشف بـ«لم يُعرف المورّد»
   وهو مذكورٌ في صدر صفحته.
   ═══════════════════════════════════════════════════════════════ */
describe("الاحتواء دليلٌ أقوى من التشابه", () => {
  const s = (nameAr: string, id = nameAr): SupplierRecord => ({
    id, slug: id, nameAr, driveFolderName: id,
    issuesInvoices: true, contractOnFile: false, aliases: [],
  });

  it("الاسم النظاميّ يُطابَق باسم الشهرة داخله", () => {
    const list = [s("أوراق الزيتون"), s("بيكوف"), s("زاكوباك")];
    const m = matchSupplier(list, { supplierNameAr: "مؤسسة أوراق الزيتون التجارية" });
    expect(m.supplier?.nameAr).toBe("أوراق الزيتون");
    expect(m.method).toBe("NAME");
  });

  it("ولا تُحذَف الصيغ بقائمة — «محمصة» أصلُ الاسم لا زائدة", () => {
    const list = [s("المحمصة الغربية"), s("محمصة أطلس")];
    expect(matchSupplier(list, { supplierNameAr: "المحمصة الغربية" }).supplier?.nameAr)
      .toBe("المحمصة الغربية");
  });

  it("وإن احتواه اسمان لم يعد الاحتواء دليلاً", () => {
    const list = [s("سرد كو"), s("سرد كو للتجارة")];
    const m = matchSupplier(list, { supplierNameAr: "مؤسسة سرد كو للتجارة المحدودة" });
    expect(m.supplier).toBeUndefined();
    expect(m.candidates.length).toBeGreaterThan(1);
  });

  it("والاسمُ القصير لا يبتلع ما احتواه", () => {
    const list = [s("سرد")];
    expect(matchSupplier(list, { supplierNameAr: "مؤسسة سرد الكبرى للتجارة" }).supplier)
      .toBeUndefined();
  });

  it("ولا يُطابَق اسمٌ ليس فيه", () => {
    const list = [s("أوراق الزيتون")];
    expect(matchSupplier(list, { supplierNameAr: "مؤسسة الرياض للتجارة" }).supplier)
      .toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════════════
   الأهليّ يقصّ الكلمة بفراغ، ويقتطع الاسم عند حدّه

   قِيس على كشف أحمد الحقيقيّ (٨ مايو ← ١ سبتمبر): تسعةَ عشر مستفيداً
   أكّد أحمد بنفسه من هُم، **أحدَ عشر منهم لا يعرفهم النظام** — وفيهم
   من له اسمٌ بديل مكتوبٌ عندنا صحيحاً منذ التأسيس. والسبب أنّ التصدير
   يلفّ السطر داخل الكلمة: «المحد ودة» و«التجا رية» و«TRA DING».
   ═══════════════════════════════════════════════════════════════ */
describe("عيوبُ تصدير الأهليّ في اسم المستفيد", () => {
  const s = (
    nameAr: string, aliases: string[] = [], nameEn?: string,
  ): SupplierRecord => ({
    id: nameAr, slug: nameAr, nameAr, nameEn, driveFolderName: nameAr,
    issuesInvoices: true, contractOnFile: false,
    aliases: aliases.map((a) => ({ normalized: normalizeName(a) })),
  });

  it("الفراغُ المقحَم داخل الكلمة لا يُبطل الاسم البديل", () => {
    const list = [s("غاناش", ["شركة أنس غالب حمزة خاشقجي التجارية المحدودة"]), s("زاكوباك")];
    const m = matchSupplier(list, {
      supplierNameAr: "شركة انس غالب حمزه خاشقجي التجارية المحد ودة",
    });
    expect(m.supplier?.nameAr).toBe("غاناش");
  });

  it("وفي الإنجليزيّ كذلك — «TRA DING»", () => {
    const list = [s("بيكوف", ["KHALID SAED BN MAHFUS TRADING"]), s("كوهي")];
    expect(matchSupplier(list, { supplierNameEn: "KHALID SAED BN MAHFUS TRA DING" })
      .supplier?.nameAr).toBe("بيكوف");
  });

  it("والاحتواء يعمل في الجهتين — المخزَّن أطولُ من الكشف", () => {
    /* الكشف «الكوب الذهبي» والمخزَّن «مصنع الكوب الذهبي» */
    const list = [s("مصنع الكوب الذهبي"), s("زاكوباك")];
    expect(matchSupplier(list, { supplierNameAr: "الكوب الذهبي" }).supplier?.nameAr)
      .toBe("مصنع الكوب الذهبي");
  });

  it("واسمُ الشهرة يُلتقَط من اسمٍ مقتطَع", () => {
    /* «شركة الرعاية المتناهية ال محدود» — قُطعت التاء عند حدّ الخانة */
    const list = [s("الرعاية المتناهية — فلاتر مياه", ["الرعاية المتناهية"])];
    expect(matchSupplier(list, { supplierNameAr: "شركة الرعاية المتناهية ال محدود" })
      .supplier?.nameAr).toBe("الرعاية المتناهية — فلاتر مياه");
  });

  it("ولا يُخلَط «سرد كو» بـ«سرد للتجارة» — وهما اثنان في دفتر أحمد", () => {
    const list = [
      s("سرد كو", ["شركة الصرد للتعبئة", "الصرد"]),
      s("سرد للتجارة — معدات", ["شركة سرد للتجارة"]),
    ];
    expect(matchSupplier(list, { supplierNameAr: "شركة الصرد للتعبئة والتغل يف" })
      .supplier?.nameAr).toBe("سرد كو");
    expect(matchSupplier(list, { supplierNameAr: "شركة سرد للتجارة" })
      .supplier?.nameAr).toBe("سرد للتجارة — معدات");
  });

  it("وإسقاطُ الفراغ لا يُطابق اسمين مختلفين", () => {
    const list = [s("أوراق الزيتون"), s("أوراق الزيت")];
    expect(matchSupplier(list, { supplierNameAr: "مؤسسة الرياض للتجارة" }).supplier)
      .toBeUndefined();
  });
});

describe("الرقمُ الضريبيّ المخالف يوقف الحسمَ بالاسم", () => {
  it("الاسمُ يطابق والرقمُ المقروء يخالف المخزَّن ← اقتراحٌ لا حسم", () => {
    const m = matchSupplier(suppliers, { sellerVatNumber: "310999999900003", supplierNameAr: "أوراق الزيتون" });
    expect(m.supplier).toBeUndefined();
    expect(m.method).toBe("NONE");
    expect(m.vatConflict).toBe(true);
    expect(m.candidates.map((c) => c.slug)).toEqual(["OliveLeaves"]);
  });

  it("والبديلُ والاحتواءُ كذلك", () => {
    expect(matchSupplier(suppliers, { sellerVatNumber: "310999999900003", supplierNameAr: "KHALID SAED BN MAHFUS TRADING" }).vatConflict).toBe(true);
    expect(matchSupplier(suppliers, { sellerVatNumber: "310999999900003", supplierNameAr: "مؤسسة أوراق الزيتون التجارية" }).vatConflict).toBe(true);
  });

  it("ومن لا رقمَ مخزَّناً له، أو قُرئ رقمُه ناقصاً، يُحسَم بالاسم كما كان", () => {
    expect(matchSupplier(suppliers, { sellerVatNumber: "310999999900003", supplierNameAr: "سرد كو" }).supplier?.slug).toBe("SardCo");
    expect(matchSupplier(suppliers, { sellerVatNumber: "31099", supplierNameAr: "أوراق الزيتون" }).supplier?.slug).toBe("OliveLeaves");
  });
});

describe("الاسمُ البديل المشترك لا يحسمه أوّلُ صفّ", () => {
  const shared = [
    make("A", "ألف", "Alpha", null, ["مؤسسة النخبة للتوريد"]),
    make("B", "باء", "Beta", null, ["مؤسسة النخبة للتوريد"]),
  ];
  it("بديلٌ يحمله مورّدان ← مرشّحان بلا حسم", () => {
    const m = matchSupplier(shared, { supplierNameAr: "مؤسسة النخبة للتوريد" });
    expect(m.supplier).toBeUndefined();
    expect(m.candidates.map((c) => c.slug).sort()).toEqual(["A", "B"]);
  });
});

describe("خطأُ حرفٍ في القراءة يُظهر المرشّحَ ولا يحسمه", () => {
  const list = [make("Ganache", "غاناش", "Ganache", null), make("Lorefa", "لوريفا", "Lorefa", null)];
  it("«غناش» تقترح «غاناش»، و«Loreva» تقترح «Lorefa»", () => {
    const a = matchSupplier(list, { supplierNameAr: "غناش" });
    expect(a.supplier).toBeUndefined();
    expect(a.candidates.map((c) => c.slug)).toContain("Ganache");
    const b = matchSupplier(list, { supplierNameEn: "Loreva" });
    expect(b.supplier).toBeUndefined();
    expect(b.candidates.map((c) => c.slug)).toContain("Lorefa");
  });
  it("واسمٌ لا يشبه شيئاً لا يقترح أحداً", () => {
    expect(matchSupplier(list, { supplierNameAr: "مطبعة الرياض" }).candidates).toEqual([]);
    expect(trigramSimilarity("", "غاناش")).toBe(0);
    expect(trigramSimilarity("غاناش", "غاناش")).toBe(1);
  });
});

describe("إنشاءُ مورّدٍ جديد — «أتقصد فلاناً؟»", () => {
  it("الاسمُ نفسه مطبَّعاً أو الإنجليزيّ أو البديلُ بنصّه ← هو نفسه", () => {
    expect(resolveNewSupplierName(suppliers, { nameAr: " أوراق  الزيتون " })).toMatchObject({ same: { slug: "OliveLeaves" } });
    expect(resolveNewSupplierName(suppliers, { nameAr: "جديد", nameEn: "olive leaves" })).toMatchObject({ same: { slug: "OliveLeaves" } });
    expect(resolveNewSupplierName(suppliers, { nameAr: "شركة الصرد للتعبئة" })).toMatchObject({ same: { slug: "SardCo" } });
  });

  it("«سرد» يشبه «سرد كو» و«سرد للتجارة» ← يُسأل ولا يُنشأ ولا يُحسَم", () => {
    const r = resolveNewSupplierName(suppliers, { nameAr: "سرد" });
    expect("similar" in r && r.similar.map((s) => s.slug).sort()).toEqual(["SardCo", "SardTrading"]);
  });

  it("والاسمُ النظاميّ الذي يحوي اسمَ الشهرة يُسأل عنه — لا يُفترض أنّه هو", () => {
    const r = resolveNewSupplierName(suppliers, { nameAr: "مؤسسة أوراق الزيتون التجارية" });
    expect("similar" in r && r.similar.map((s) => s.slug)).toEqual(["OliveLeaves"]);
  });

  it("واسمٌ لا يشبه أحداً ← لا مرشّحين، فيُنشأ", () => {
    expect(resolveNewSupplierName(suppliers, { nameAr: "مطبعة الرياض الحديثة" })).toEqual({ similar: [] });
  });
});
