import { describe, expect, it } from "vitest";
import { evidenceFrom } from "./counterparty.service";
import { toCanonical, type RawBankRow } from "@/lib/bank/canonical";

const base: RawBankRow = {
  valueDate: new Date("2026-08-27T00:00:00Z"),
  amountMinor: 1_000_00,
  direction: "DEBIT",
};
const row = (over: Partial<RawBankRow>) => toCanonical({ ...base, ...over });

describe("evidenceFrom", () => {
  it("تلتقط رقم الهوية — وهو ما يعمّ على ثلاثين حركة بتأكيدٍ واحد", () => {
    const e = evidenceFrom(row({
      description: "احمد محمد يسلم الجعيدي BEN ID:2149830115 تحويل الى الاهل",
    }));
    expect(e.find((x) => x.kind === "NATIONAL_ID")?.value).toBe("2149830115");
  });

  it("تلتقط رقم الحساب والآيبان", () => {
    const e = evidenceFrom(row({ description: "تحويل الى 12600000942005" }));
    expect(e.find((x) => x.kind === "ACCOUNT")?.value).toBe("12600000942005");

    const iban = evidenceFrom(row({ description: "SA0380000000608010167519" }));
    expect(iban.find((x) => x.kind === "IBAN")).toBeDefined();
  });

  it("تلتقط رقم التاجر من حركة الشبكة", () => {
    const e = evidenceFrom(row({
      direction: "CREDIT",
      description: "81140155-260718-POS MC Se ttlem 125207",
    }));
    expect(e.find((x) => x.kind === "MERCHANT_ID")?.value).toBe("81140155");
  });

  it("تلتقط اسم المستفيد كما كتبه البنك", () => {
    const e = evidenceFrom(row({ beneficiaryRaw: "لوريفا كيك" }));
    expect(e.find((x) => x.kind === "NAME")?.value).toBe("لوريفا كيك");
  });

  it("لا تأخذ المرجع البنكيّ دليلاً — يتغيّر كل مرّة", () => {
    const e = evidenceFrom(row({ description: "EJAR رقم السداد20904553589 مرجع سداد6959405833" }));
    expect(e.some((x) => x.kind === "REFERENCE")).toBe(false);
  });

  it("توحّد القيمة للمطابقة وتُبقي الأصل", () => {
    const e = evidenceFrom(row({ beneficiaryRaw: "  مؤسّسة  الأحمد " }));
    const name = e.find((x) => x.kind === "NAME")!;
    expect(name.value).toBe("مؤسّسة  الأحمد");
    expect(name.normalized).toBe("مؤسسه الاحمد");
  });

  it("لا تُكرّر الدليل الواحد", () => {
    const e = evidenceFrom(row({
      description: "تحويل 12600000942005 الى 12600000942005",
    }));
    expect(e.filter((x) => x.kind === "ACCOUNT")).toHaveLength(1);
  });

  it("الاسم القصير جداً لا يصلح دليلاً", () => {
    expect(evidenceFrom(row({ beneficiaryRaw: "أب" })).some((x) => x.kind === "NAME")).toBe(false);
  });

  it("حركة بلا شيء لا تُنتج أدلّة كاذبة", () => {
    expect(evidenceFrom(row({ description: null, beneficiaryRaw: null }))).toEqual([]);
  });
});
