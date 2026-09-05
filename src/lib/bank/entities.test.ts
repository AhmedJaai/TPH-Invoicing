import { describe, expect, it } from "vitest";
import { toCanonical, type RawBankRow } from "./canonical";
import { distinctiveTokens, resolveSupplier, tokenAppears, type SupplierIdentity } from "./entities";

const base: RawBankRow = {
  valueDate: new Date("2026-08-27T00:00:00Z"),
  amountMinor: 1_000_00,
  direction: "DEBIT",
};
const row = (over: Partial<RawBankRow>) => toCanonical({ ...base, ...over });

const sup = (over: Partial<SupplierIdentity> & { supplierId: string }): SupplierIdentity => ({
  nameAr: "مورّد",
  slug: "sup",
  aliases: [],
  ...over,
});

describe("tokenAppears", () => {
  it("تُطابَق على حدود الكلمات — «jar» داخل «EJAR» ليست مطابقة", () => {
    expect(tokenAppears("jar", "EJAR رقم السداد")).toBe(false);
    expect(tokenAppears("ejar", "EJAR رقم السداد")).toBe(true);
  });

  /*
    الحدّ نزل إلى ثلاثة أحرف: «سرد» و«نور» و«بدر» أسماء تجارة حقيقية،
    وإسقاطُها يترك أصحابها بلا هوية تُطابَق — وهو ما عطّل مطابقة دفعةٍ
    بأحد عشر ألفاً في بيانات أحمد.
  */
  it("الثلاثيّ يُعتدّ به — كثيرٌ من أسماء التجارة ثلاثيّة", () => {
    expect(tokenAppears("سرد", "دفعة الى سرد للتجارة")).toBe(true);
  });

  it("وما دونه لا", () => {
    expect(tokenAppears("ال", "شركة ال سعود")).toBe(false);
  });
});

describe("distinctiveTokens", () => {
  it("الطويل المميّز يُقدَّم، والثلاثيّ لا يُؤخَذ إلّا حين لا أطول منه", () => {
    // «لافا كمبوتشا» فيها طويلتان مميّزتان، فلا حاجة إلى الثلاثيّ
    expect(distinctiveTokens("لافا كمبوتشا")).toEqual(["لافا", "كمبوتشا"]);
    // و«سرد للتجارة» ليس فيها إلّا عامّة وثلاثيّ
    expect(distinctiveTokens("سرد للتجارة")).toEqual(["سرد"]);
  });

  it("تُسقط ما يتكرّر في أسماء الشركات", () => {
    const t = distinctiveTokens("شركة أوراق الزيتون التجارية المحدودة");
    expect(t).toContain("اوراق");
    expect(t).toContain("الزيتون");
    expect(t).not.toContain("شركه");
    expect(t).not.toContain("التجاريه");
  });

  it("تُسقط ضجيج البنك", () => {
    expect(distinctiveTokens("الأهلي مرجع السداد")).toEqual([]);
  });
});

describe("resolveSupplier", () => {
  const suppliers = [
    sup({ supplierId: "S1", nameAr: "أوراق الزيتون", slug: "OliveLeaves", aliases: [] }),
    sup({ supplierId: "S2", nameAr: "لافا كمبوتشا", slug: "Lava", aliases: ["شركة أنس غالب حمزة خاشقجي"] }),
  ];

  it("الاسم البديل المؤكَّد قاطع ولو لم يشبه الاسم الأصلي", () => {
    const r = resolveSupplier(row({ description: "شركة أنس غالب حمزة خاشقجي التجارية المحدودة" }), suppliers)!;
    expect(r.supplierId).toBe("S2");
    expect(r.evidence[0].kind).toBe("ALIAS");
    expect(r.score).toBeGreaterThanOrEqual(0.95);
  });

  it("اسم المورّد الوارد كما هو دليل قويّ", () => {
    const r = resolveSupplier(row({ description: "تحويل الى أوراق الزيتون" }), suppliers)!;
    expect(r.supplierId).toBe("S1");
    expect(r.evidence.some((e) => e.kind === "NAME")).toBe(true);
  });

  it("رقم الحساب المعروف قاطع", () => {
    const withAccount = [sup({ supplierId: "S3", nameAr: "بدر", accounts: ["12600000942005"] })];
    const r = resolveSupplier(row({ description: "تحويل الى 12600000942005" }), withAccount)!;
    expect(r.evidence[0].kind).toBe("ACCOUNT");
    expect(r.score).toBe(1);
  });

  it("لا دليل فلا تعريف — ولا يُخمَّن", () => {
    expect(resolveSupplier(row({ description: "تحويل محلي" }), suppliers)).toBeNull();
  });

  it("النصّ الفارغ لا يُعرَّف", () => {
    expect(resolveSupplier(row({ description: null }), suppliers)).toBeNull();
  });

  it("مورّدان بنفس القوّة يخفضان الدرجة ولا يُحسمان", () => {
    const twins = [
      sup({ supplierId: "A", nameAr: "محمصة الغربية" }),
      sup({ supplierId: "B", nameAr: "محمصة الغربية" }),
    ];
    const r = resolveSupplier(row({ description: "تحويل الى محمصة الغربية" }), twins)!;
    expect(r.score).toBeLessThan(0.8);
    expect(r.evidence.map((e) => e.detail).join(" ")).toContain("لا يُحسم");
  });

  it("لكل تعريف أدلّته مكتوبةً كي تُعرَض", () => {
    const r = resolveSupplier(row({ description: "أوراق الزيتون" }), suppliers)!;
    for (const e of r.evidence) expect(e.detail.length).toBeGreaterThan(0);
  });

  it("النتيجة واحدة لنفس المدخل", () => {
    const tx = row({ description: "أوراق الزيتون" });
    expect(resolveSupplier(tx, suppliers)).toEqual(resolveSupplier(tx, suppliers));
  });
});
