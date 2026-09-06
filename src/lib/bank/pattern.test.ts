import { describe, expect, it } from "vitest";
import { toCanonical, type RawBankRow } from "./canonical";
import {
  groupByIdentity, groupingIdentity, identitiesOf, memoryKeyFor, signatureOf,
} from "./pattern";

const base: RawBankRow = {
  valueDate: new Date("2026-08-27T00:00:00Z"),
  amountMinor: 1_000_00,
  direction: "DEBIT",
};
const row = (over: Partial<RawBankRow>) => toCanonical({ ...base, ...over });

/* أوصافٌ من كشف أحمد نفسه — لا صيغٌ متخيَّلة. */
const ZATCA_A = "Zakat, Tax and Customs Au thority رقم السداد310007971626300 1 هاتف الأهلي مرجع سداد6937647100 مرجع131353004";
const ZATCA_B = "Zakat, Tax and Customs Au thority رقم السداد310007971600003 2 هاتف الأهلي مرجع سداد6937000000 مرجع131000000";
const BALADIYA = "Ministry of Municipal and  Rural Affairs رقم السداد982521151712 هاتف الأهلي مرجع سداد6862612559 مرجع132190936";

describe("النمط يُمسك ما لا اسم له ولا حساب", () => {
  it("حركتا «سداد» لنفس الجهة نمطهما واحد وإن اختلفت أرقامهما", () => {
    expect(signatureOf(row({ description: ZATCA_A }))).toBe(
      signatureOf(row({ description: ZATCA_B })),
    );
  });

  it("جهتان مختلفتان نمطاهما مختلفان", () => {
    expect(signatureOf(row({ description: ZATCA_A }))).not.toBe(
      signatureOf(row({ description: BALADIYA })),
    );
  });

  it("«نوع العملية» لا يدخل النمط — يملؤه كشفٌ ويتركه آخر", () => {
    const withType = row({ description: ZATCA_A, transactionType: "مدفوعات سداد" });
    const without = row({ description: ZATCA_A, transactionType: null });
    expect(signatureOf(withType)).toBe(signatureOf(without));
  });

  it("وصفٌ كلّه أرقام لا نمط له — والمجهول يُعلَن", () => {
    expect(signatureOf(row({ description: "817263 992814 0011" }))).toBeNull();
    expect(signatureOf(row({ description: "" }))).toBeNull();
    expect(groupingIdentity(row({ description: "" }))).toBeNull();
  });

  it("طول سلسلة المراجع ليس معنى — تُختصر إلى علامةٍ واحدة", () => {
    expect(signatureOf(row({ description: "رسوم 11 22 33 خدمة" })))
      .toBe(signatureOf(row({ description: "رسوم 4444 خدمة" })));
  });

  it("اختلاف صيغة الهمزة والتاء المربوطة لا يفرّق النمط", () => {
    expect(signatureOf(row({ description: "مؤسسة أوراق الزيتون 5512" })))
      .toBe(signatureOf(row({ description: "مؤسسه اوراق الزيتون 7788" })));
  });
});

describe("الترتيب: الأقطع يسبق الأظنّ", () => {
  it("رقم الهوية يسبق الاسم ويسبق النمط", () => {
    const tx = row({
      description: "شركة إيفال بي بي إس BEN ID:7052673337 شراء بضاعة 13600001197",
      beneficiaryRaw: "أفال — بدر",
    });
    const kinds = identitiesOf(tx).map((i) => i.kind);
    expect(kinds[0]).toBe("NATIONAL_ID");
    expect(kinds).toContain("NAME");
    expect(kinds).toContain("PATTERN");
    expect(groupingIdentity(tx)?.kind).toBe("NATIONAL_ID");
  });

  it("الاسم يُقرأ من نصّ البنك — لا من عمودٍ يكتبه نظامُنا", () => {
    /*
      كان العمود يُؤخذ خاماً، وهو ملوَّث باسم المورّد الذي طابقه
      النظام. فجُمعت أربع حوالات لأربع جهات تحت اسمٍ واحد، وقرارٌ
      واحد عليها يُخطئ في أربع.
    */
    const tx = row({
      description: "حوالات تحت الطلب20260805S ANCBKNCBK6B82412005390704 top taste trading Company BENBK:AL INMA BANK",
      beneficiaryRaw: "سبعة جرة — عميل",
    });
    expect(tx.beneficiary).toBe("top taste trading Company");
    expect(groupingIdentity(tx)?.key).toBe("NAME:TOP TASTE TRADING COMPANY");
  });

  it("حوالتان لجهتين لا تجتمعان وإن حمل العمودُ اسماً واحداً", () => {
    const a = row({
      description: "حوالات تحت الطلب20260813S ANCBKNCBK6B82410205449975 مؤسسة عمار مصطفى احمد بن صديق BENBK:SAUDI INVESTMENT BA NK",
      beneficiaryRaw: "سبعة جرة — عميل",
    });
    const b = row({
      description: "حوالات تحت الطلب20260823S ANCBKNCBK6B82411033564951 PURE BEVERAGE INDUSTRY CO CLOS BENBK:SAUDI AWWAL BANK",
      beneficiaryRaw: "سبعة جرة — عميل",
    });
    expect(groupingIdentity(a)?.key).not.toBe(groupingIdentity(b)?.key);
  });

  it("ولا يُشتقّ اسمٌ من رسمٍ لا مستفيد له", () => {
    expect(row({ description: "CITY:Digital Channel" }).beneficiary).toBeNull();
    expect(row({ description: "81140155-260626-POS 0" }).beneficiary).toBeNull();
  });

  it("وبلا اسمٍ ولا رقم تبقى الهويّة النمط", () => {
    expect(groupingIdentity(row({ description: "PoSMonthlyFeeSep81140156" }))?.kind)
      .toBe("PATTERN");
  });

  it("المفتاح يُكتب ويُقرأ بصيغةٍ واحدة", () => {
    const id = identitiesOf(row({ description: ZATCA_A }))
      .find((i) => i.kind === "PATTERN")!;
    expect(id.key).toBe(memoryKeyFor("PATTERN", id.normalized));
  });
});

describe("التجميع: سؤالٌ واحد عن سبع حركات", () => {
  const rows = [
    { id: "a", amount: 1420932, d: ZATCA_A },
    { id: "b", amount: 1420932, d: ZATCA_B },
    { id: "c", amount: 25000, d: BALADIYA },
    { id: "d", amount: 2000, d: "" },
  ];

  const { groups, ungrouped } = groupByIdentity(
    rows,
    (r) => row({ description: r.d, amountMinor: r.amount }),
    (r) => r.amount,
  );

  it("المتشابه يجتمع والمبالغ تُجمَع", () => {
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].totalMinor).toBe(2841864);
  });

  it("الأكبر عدداً أوّلاً — كي يقصر الطابور بأسرع ما يمكن", () => {
    expect(groups.map((g) => g.items.length)).toEqual([2, 1]);
  });

  it("ما لا هويّة له لا يُدسّ في مجموعة", () => {
    expect(ungrouped.map((r) => r.id)).toEqual(["d"]);
  });
});
