import { describe, expect, it } from "vitest";
import { batchKey, groupBatches, recognizePos, squash } from "./pos";

/**
 * كل نصّ هنا منقول حرفياً من كشف الأهلي في قاعدة أحمد — بفراغاته
 * المقطوعة داخل الكلمات. الاختبار الذي يُكتب على نصّ مثاليّ لا يثبت
 * شيئاً عن ملفٍ حقيقيّ.
 */
describe("squash", () => {
  it("تُزيل قطع البنك داخل الكلمات", () => {
    expect(squash("Se ttlem")).toBe("SETTLEM");
    expect(squash("Fe es")).toBe("FEES");
    expect(squash("VA T")).toBe("VAT");
  });
});

describe("recognizePos — صفوف حقيقية", () => {
  it("تسوية واردة", () => {
    const p = recognizePos("81140155-260718-POS MC Se ttlem 125207", "CREDIT")!;
    expect(p.kind).toBe("POS_SETTLEMENT");
    expect(p.merchantId).toBe("81140155");
    expect(p.scheme).toBe("MC");
    expect(p.batchDate).toBe("260718");
    expect(p.batchRef).toBe("125207");
  });

  it("رسوم صادرة", () => {
    const p = recognizePos("81140155-260727-POS FV Fe es 825258", "DEBIT")!;
    expect(p.kind).toBe("POS_FEE");
    expect(p.scheme).toBe("FV");
  });

  it("ضريبة الرسوم — وتُفحص قبل الرسوم", () => {
    const p = recognizePos("81140155-260724-POS VM VA T 607110", "DEBIT")!;
    expect(p.kind).toBe("POS_VAT");
  });

  it("سطر REFERENCE يُفصَل بالاتجاه وحده", () => {
    expect(recognizePos("REFERENCE : 81140155 MC26 0831 000000", "CREDIT")!.kind)
      .toBe("POS_SETTLEMENT");
    expect(recognizePos("REFERENCE : 81140155 VM26 0826 000000", "DEBIT")!.kind)
      .toBe("POS_FEE");
  });

  it("سطر REFERENCE يُخرج التاجر والشبكة والتاريخ", () => {
    const p = recognizePos("REFERENCE : 81140155 MC26 0831 000000", "CREDIT")!;
    expect(p.merchantId).toBe("81140155");
    expect(p.scheme).toBe("MC");
    expect(p.batchDate).toBe("260831");
  });

  it("سطر بلا كلمة: الوارد تسوية، والصادر لا يُخمَّن", () => {
    expect(recognizePos("81140155-260526-POS 119872", "CREDIT")!.kind).toBe("POS_SETTLEMENT");
    expect(recognizePos("81140155-260526-POS 119872", "DEBIT")).toBeNull();
  });

  it("ما ليس حركة شبكة يُرجع null لا تخميناً", () => {
    expect(recognizePos("عبدالرحمن احمد بن عبدالرح BV:رواتب شهرية", "DEBIT")).toBeNull();
    expect(recognizePos("EJAR رقم السداد20904553589", "DEBIT")).toBeNull();
    expect(recognizePos("", "CREDIT")).toBeNull();
    expect(recognizePos(null, "CREDIT")).toBeNull();
  });

  it("النتيجة واحدة لنفس المدخل — لا تتقلّب", () => {
    const line = "81140155-260714-POS VC Se ttlem 598102";
    const a = recognizePos(line, "CREDIT");
    const b = recognizePos(line, "CREDIT");
    expect(a).toEqual(b);
  });
});

describe("batchKey", () => {
  it("يجمع التاجر والتاريخ والشبكة", () => {
    const p = recognizePos("81140155-260718-POS MC Se ttlem 125207", "CREDIT")!;
    expect(batchKey(p)).toBe("81140155:260718:MC");
  });

  it("بلا تاريخ لا مفتاح", () => {
    expect(batchKey({ kind: "POS_FEE", merchantId: "1" })).toBeNull();
  });
});

describe("groupBatches", () => {
  it("تجمع التسوية برسومها وضريبتها فتُظهر ما وصل فعلاً", () => {
    const rows = [
      { pos: recognizePos("81140155-260718-POS MC Se ttlem 125207", "CREDIT")!, amountMinor: 10_000_00 },
      { pos: recognizePos("81140155-260718-POS MC Fe es 125207", "DEBIT")!, amountMinor: 75_00 },
      { pos: recognizePos("81140155-260718-POS MC VA T 125207", "DEBIT")!, amountMinor: 11_25 },
    ];
    const [b] = groupBatches(rows);
    expect(b.settlementMinor).toBe(10_000_00);
    expect(b.feeMinor).toBe(75_00);
    expect(b.vatMinor).toBe(11_25);
    expect(b.netMinor).toBe(9_913_75);
    expect(b.count).toBe(3);
  });

  it("دفعتان مختلفتان لا تختلطان", () => {
    const rows = [
      { pos: recognizePos("81140155-260718-POS MC Se ttlem 1", "CREDIT")!, amountMinor: 100 },
      { pos: recognizePos("81140155-260719-POS MC Se ttlem 2", "CREDIT")!, amountMinor: 200 },
    ];
    expect(groupBatches(rows)).toHaveLength(2);
  });

  it("ترتّب بالأكبر تسويةً", () => {
    const rows = [
      { pos: recognizePos("81140155-260718-POS MC Se ttlem 1", "CREDIT")!, amountMinor: 100 },
      { pos: recognizePos("81140155-260719-POS VC Se ttlem 2", "CREDIT")!, amountMinor: 900 },
    ];
    expect(groupBatches(rows)[0].settlementMinor).toBe(900);
  });
});
