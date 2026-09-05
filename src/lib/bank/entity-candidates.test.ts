import { describe, expect, it } from "vitest";
import {
  MAX_ENTITY_CANDIDATES, MIN_CANDIDATE_SCORE, beneficiaryGuess, proposeEntities,
  type KnownCounterparty,
} from "./entity-candidates";
import { toCanonical, type RawBankRow } from "./canonical";
import type { SupplierIdentity } from "./entities";

const base: RawBankRow = {
  valueDate: new Date("2026-09-04T00:00:00Z"),
  amountMinor: 11_600_00,
  direction: "DEBIT",
};
const row = (over: Partial<RawBankRow>) => toCanonical({ ...base, ...over });

const suppliers: SupplierIdentity[] = [
  { supplierId: "S1", nameAr: "أوراق الزيتون", slug: "OliveLeaves", aliases: [] },
  { supplierId: "S2", nameAr: "سرد للتجارة", slug: "SardTrading", aliases: [] },
];

const known: KnownCounterparty[] = [
  { id: "C1", displayName: "شركة الصرد للتعبئة", supplierId: "S3", confirmations: 12,
    names: ["شركة الصرد للتعبئة", "الصرد"] },
];

describe("proposeEntities — الطبقة التي كانت مفقودة", () => {
  it("ترشّح جهةً أكّدها إنسان من قبل", () => {
    const c = proposeEntities(row({ description: "تحويل الى الصرد للتعبئة" }), suppliers, known);
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].counterpartyId).toBe("C1");
    expect(c[0].evidence.join(" ")).toContain("١٢".replace("١٢", "12"));
  });

  it("والتأكيد المتكرّر يرفع الترجيح ولا يبلغ الحسم", () => {
    const many = [{ ...known[0], confirmations: 500 }];
    const c = proposeEntities(row({ description: "تحويل الى الصرد" }), suppliers, many);
    expect(c[0].score).toBeLessThan(0.8);
  });

  it("ترشّح مورّداً مسجَّلاً بكلمة مشتركة", () => {
    const c = proposeEntities(row({ description: "دفعة الى سرد للتجارة" }), suppliers, []);
    expect(c.some((x) => x.supplierId === "S2")).toBe(true);
  });

  it("وترشّح جهةً جديدة من الوصف — بأضعف ترجيح", () => {
    const c = proposeEntities(
      row({ description: "ماريه محمد علي بامخشب BEN ID:1108417104 شراء بضاعه" }),
      suppliers, [],
    );
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].counterpartyId).toBeNull();
    expect(c[0].supplierId).toBeNull();
    expect(c[0].evidence.join(" ")).toContain("جديدة");
  });

  it("لا ترشّح ما لا دليل عليه", () => {
    expect(proposeEntities(row({ description: null, beneficiaryRaw: null }), suppliers, [])).toEqual([]);
  });

  it("تحدّ العدد — القائمة الطويلة تُشتّت", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      supplierId: `S${i}`, nameAr: `مؤسسة الاختبار ${i}`, slug: `T${i}`, aliases: [],
    }));
    const c = proposeEntities(row({ description: "مؤسسة الاختبار" }), many, []);
    expect(c.length).toBeLessThanOrEqual(MAX_ENTITY_CANDIDATES);
  });

  it("كلّ مرشّح فوق أدنى ترجيح", () => {
    const c = proposeEntities(row({ description: "تحويل الى الصرد" }), suppliers, known);
    for (const x of c) expect(x.score).toBeGreaterThanOrEqual(MIN_CANDIDATE_SCORE);
  });

  it("مرتّبة بالأرجح، وثابتة لا تتقلّب", () => {
    const tx = row({ description: "تحويل الى الصرد للتعبئة" });
    const a = proposeEntities(tx, suppliers, known);
    const b = proposeEntities(tx, suppliers, known);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) expect(a[i - 1].score).toBeGreaterThanOrEqual(a[i].score);
  });
});

describe("beneficiaryGuess", () => {
  it("يأخذ عمود المستفيد حين يوجد", () => {
    expect(beneficiaryGuess(row({ beneficiaryRaw: "لوريفا كيك" }))).toBe("لوريفا كيك");
  });

  it("ويقطع عند BEN ID — وما بعدها أرقام لا اسم", () => {
    const g = beneficiaryGuess(row({
      description: "احمد محمد يسلم الجعيدي BEN ID:2149830115 تحويل",
    }));
    expect(g).toContain("احمد");
    expect(g).not.toContain("2149830115");
  });

  it("ويقطع عند رقم السداد", () => {
    const g = beneficiaryGuess(row({ description: "EJAR رقم السداد20904553589" }));
    expect(g).toBe("EJAR");
  });

  it("لا يخمّن من أرقام محضة", () => {
    expect(beneficiaryGuess(row({ description: "123456 789" }))).toBeNull();
  });

  it("ولا من فراغ", () => {
    expect(beneficiaryGuess(row({ description: null, beneficiaryRaw: null }))).toBeNull();
  });
});
