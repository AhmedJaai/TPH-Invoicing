import { describe, expect, it } from "vitest";
import { echoKey, findCreditEchoes, findPaymentEchoes, type EchoPayment } from "./payment-echo";

const p = (over: Partial<EchoPayment> & Pick<EchoPayment, "id" | "day">): EchoPayment => ({
  supplierId: "kohi",
  amountMinor: 83_375,
  feeMinor: 0,
  allocatedMinor: 0,
  method: "BANK_TRANSFER",
  status: "UNAPPLIED",
  hasBankRow: false,
  hasDocument: false,
  ...over,
});

describe("findPaymentEchoes — الحوالةُ نفسها قُيِّدت مرّتين", () => {
  it("كوهي كما في الإنتاج: إقرارٌ ٦ أغسطس يقابله حوالةُ ٥ أغسطس غير المنسوبة، لا حوالةُ ١٢ المنسوبة", () => {
    const rows = [
      p({ id: "bank-5", day: "2026-08-05", hasBankRow: true }),
      p({ id: "manual-6", day: "2026-08-06", allocatedMinor: 83_375, status: "APPLIED" }),
      p({ id: "bank-12", day: "2026-08-12", hasBankRow: true, allocatedMinor: 83_375, status: "APPLIED" }),
    ];
    expect(findPaymentEchoes(rows)).toEqual([
      { supplierId: "kohi", manualId: "manual-6", bankId: "bank-5", amountMinor: 83_375, manualDay: "2026-08-06", bankDay: "2026-08-05", daysApart: 1 },
    ]);
  });

  it("أطلس: اليومُ نفسه", () => {
    const rows = [
      p({ id: "m", supplierId: "atlas", amountMinor: 57_500, day: "2026-08-13", allocatedMinor: 57_500 }),
      p({ id: "b", supplierId: "atlas", amountMinor: 57_500, day: "2026-08-13", hasBankRow: true }),
    ];
    expect(findPaymentEchoes(rows).map(echoKey)).toEqual(["m:b"]);
  });

  it("لا صدى: من حساب المالك أو نقداً — لا يظهر في الكشف أصلاً", () => {
    const rows = [
      p({ id: "m", day: "2026-08-06", allocatedMinor: 83_375, method: "OWNER_ACCOUNT" }),
      p({ id: "c", day: "2026-08-06", allocatedMinor: 83_375, method: "CASH" }),
      p({ id: "b", day: "2026-08-05", hasBankRow: true }),
    ];
    expect(findPaymentEchoes(rows)).toEqual([]);
  });

  it("لا صدى: للإقرار إيصالٌ، أو مبلغٌ آخر، أو مورّدٌ آخر، أو بعيدٌ في الزمن", () => {
    const bank = p({ id: "b", day: "2026-08-05", hasBankRow: true });
    expect(findPaymentEchoes([bank, p({ id: "d", day: "2026-08-05", allocatedMinor: 83_375, hasDocument: true })])).toEqual([]);
    expect(findPaymentEchoes([bank, p({ id: "a", day: "2026-08-05", amountMinor: 83_300, allocatedMinor: 83_300 })])).toEqual([]);
    expect(findPaymentEchoes([bank, p({ id: "s", supplierId: "atlas", day: "2026-08-05", allocatedMinor: 83_375 })])).toEqual([]);
    expect(findPaymentEchoes([bank, p({ id: "f", day: "2026-08-25", allocatedMinor: 83_375 })])).toEqual([]);
  });

  it("لا صدى: الحوالةُ منسوبةٌ كلُّها — فالإقرارُ واقعةٌ أخرى أو يُسأل عنه غيرُ هذا", () => {
    const rows = [
      p({ id: "b", day: "2026-08-05", hasBankRow: true, allocatedMinor: 83_375 }),
      p({ id: "m", day: "2026-08-05", allocatedMinor: 83_375 }),
    ];
    expect(findPaymentEchoes(rows)).toEqual([]);
  });

  it("لا صدى: إقرارٌ لم يُخصَّص على شيء، أو مُلغى", () => {
    const bank = p({ id: "b", day: "2026-08-05", hasBankRow: true });
    expect(findPaymentEchoes([bank, p({ id: "m", day: "2026-08-05" })])).toEqual([]);
    expect(findPaymentEchoes([bank, p({ id: "v", day: "2026-08-05", allocatedMinor: 83_375, status: "VOID" })])).toEqual([]);
  });

  it("كلُّ حوالةٍ لإقرارٍ واحد — والأقربُ يوماً أوّلاً", () => {
    const rows = [
      p({ id: "b1", day: "2026-08-01", hasBankRow: true }),
      p({ id: "b2", day: "2026-08-08", hasBankRow: true }),
      p({ id: "m1", day: "2026-08-02", allocatedMinor: 83_375 }),
      p({ id: "m2", day: "2026-08-07", allocatedMinor: 83_375 }),
      p({ id: "m3", day: "2026-08-04", allocatedMinor: 83_375 }),
    ];
    expect(findPaymentEchoes(rows).map(echoKey).sort()).toEqual(["m1:b1", "m2:b2"]);
  });

  it("الرسمُ لا يُحسب مالاً للمورّد: حوالةٌ ينقصها رسمُها لا تسع إقراراً بالمبلغ كاملاً", () => {
    const rows = [
      p({ id: "b", day: "2026-08-05", hasBankRow: true, feeMinor: 500 }),
      p({ id: "m", day: "2026-08-05", allocatedMinor: 83_375 }),
    ];
    expect(findPaymentEchoes(rows)).toEqual([]);
  });
});

describe("findCreditEchoes — إقرارٌ بيد وللمورّد حوالاتٌ لم تُنسب تسعه", () => {
  it("غاناش: فاتورتان بـ٤٥٥٫٤٠ وُسمتا بيد، وحوالةٌ جامعة غيرُ منسوبة قبلهما", () => {
    const rows = [
      p({ id: "lump", supplierId: "g", amountMinor: 5_225_60, day: "2026-07-03", hasBankRow: true }),
      p({ id: "m1", supplierId: "g", amountMinor: 455_40, allocatedMinor: 455_40, day: "2026-08-14" }),
      p({ id: "m2", supplierId: "g", amountMinor: 455_40, allocatedMinor: 455_40, day: "2026-08-17" }),
    ];
    const out = findCreditEchoes(rows);
    expect(out.map((e) => e.manualId)).toEqual(["m1", "m2"]);
    expect(out[0].sources).toEqual([{ bankId: "lump", day: "2026-07-03", amountMinor: 455_40 }]);
  });

  it("الرصيدُ يُستهلك مرّة: حوالةٌ تسع إقراراً واحداً لا اثنين", () => {
    const rows = [
      p({ id: "b", supplierId: "g", amountMinor: 500_00, day: "2026-08-01", hasBankRow: true }),
      p({ id: "m1", supplierId: "g", amountMinor: 455_40, allocatedMinor: 455_40, day: "2026-08-14" }),
      p({ id: "m2", supplierId: "g", amountMinor: 455_40, allocatedMinor: 455_40, day: "2026-08-17" }),
    ];
    expect(findCreditEchoes(rows).map((e) => e.manualId)).toEqual(["m1"]);
  });

  it("لا صدى: الحوالةُ أبعد من ستّين يوماً، أو بعد الإقرار بأكثر من ثلاثة، أو ما أُخذ في صدى المبلغ نفسه", () => {
    const m = p({ id: "m", supplierId: "g", amountMinor: 100_00, allocatedMinor: 100_00, day: "2026-08-14" });
    expect(findCreditEchoes([m, p({ id: "old", supplierId: "g", day: "2026-06-01", hasBankRow: true })])).toEqual([]);
    expect(findCreditEchoes([m, p({ id: "late", supplierId: "g", day: "2026-08-20", hasBankRow: true })])).toEqual([]);
    expect(findCreditEchoes([m, p({ id: "b", supplierId: "g", day: "2026-08-10", hasBankRow: true })], ["m"])).toEqual([]);
  });
});
