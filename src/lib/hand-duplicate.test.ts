import { describe, expect, it } from "vitest";
import {
  duplicateWhy, findDuplicateHandPayments, findTwin, handDuplicateKey, isHandRecorded, onlyPaidThis,
  type HandPaymentRow, type ReleaseTrace,
} from "./hand-duplicate";

const p = (over: Partial<HandPaymentRow> & Pick<HandPaymentRow, "id" | "day">): HandPaymentRow => ({
  supplierId: "mood",
  amountMinor: 204_30,
  feeMinor: 0,
  allocatedMinor: 0,
  method: "OWNER_ACCOUNT",
  status: "UNAPPLIED",
  hasBankRow: false,
  hasDocument: false,
  isAdvance: false,
  ...over,
});

const merged = (paymentId: string): ReleaseTrace => ({
  paymentId, action: "INVOICE_MERGED", day: "2026-10-24", droppedNumber: "74389", keptNumber: "74389",
});

describe("findDuplicateHandPayments — سدادٌ بيدٍ قُيّد مرّتين", () => {
  it("مود القهوة كما في الإنتاج: نسختان مسدّدتان من حساب المالك، دُمجتا فبقي سداد الساقطة رصيداً", () => {
    const rows = [
      p({ id: "kept", day: "2026-09-30", allocatedMinor: 204_30, status: "APPLIED" }),
      p({ id: "dup", day: "2026-09-30" }),
      /* حوالةُ 67910 بالبنك وفيها ٠٫٧١ زائدة — مالٌ خرج حقّاً، لا يُسأل عنه */
      p({ id: "bank", day: "2026-09-10", amountMinor: 1_625_72, allocatedMinor: 1_625_01, method: "BANK_TRANSFER", hasBankRow: true, status: "OVERPAYMENT" }),
    ];
    const out = findDuplicateHandPayments(rows, new Map([["dup", merged("dup")]]));
    expect(out).toEqual([{
      supplierId: "mood", paymentId: "dup", day: "2026-09-30", method: "OWNER_ACCOUNT", amountMinor: 204_30,
      creditMinor: 204_30, allocatedMinor: 0,
      twin: { paymentId: "kept", day: "2026-09-30", bank: false },
      release: merged("dup"),
    }]);
  });

  it("جملة التقنية: يكفي أنّ الدمج فكّها — ولو لم يبقَ توأم", () => {
    const rows = [p({ id: "j", supplierId: "jmla", amountMinor: 382_00, day: "2026-09-16" })];
    const out = findDuplicateHandPayments(rows, new Map([["j", merged("j")]]));
    expect(out.map((d) => [d.paymentId, d.creditMinor, d.twin])).toEqual([["j", 382_00, null]]);
  });

  it("ويكفي التوأم وحده: سدادٌ آخر بالمبلغ نفسه في سبعة أيّام سدّد فاتورة — بيد أو بحوالة", () => {
    const hand = [p({ id: "a", day: "2026-09-01", allocatedMinor: 204_30 }), p({ id: "b", day: "2026-09-07" })];
    expect(findDuplicateHandPayments(hand).map((d) => d.paymentId)).toEqual(["b"]);
    const bank = [p({ id: "t", day: "2026-09-01", allocatedMinor: 204_30, method: "BANK_TRANSFER", hasBankRow: true }), p({ id: "b", day: "2026-09-03", method: "BANK_TRANSFER" })];
    expect(findDuplicateHandPayments(bank)[0].twin).toEqual({ paymentId: "t", day: "2026-09-01", bank: true });
  });

  it("وجزءٌ منها مخصَّص ما زال يُعدّ — رصيدُه ما بقي", () => {
    const rows = [p({ id: "a", day: "2026-09-01", allocatedMinor: 204_30 }), p({ id: "b", day: "2026-09-02", allocatedMinor: 100_00, status: "PARTIALLY_APPLIED" })];
    expect(findDuplicateHandPayments(rows).map((d) => [d.paymentId, d.creditMinor, d.allocatedMinor])).toEqual([["b", 104_30, 100_00]]);
  });

  it("لا يُعدّ: ما شهد له البنك أو الإيصال، ولو فكّه دمج", () => {
    const rows = [
      p({ id: "k", day: "2026-09-30", allocatedMinor: 204_30 }),
      p({ id: "bank", day: "2026-09-30", method: "BANK_TRANSFER", hasBankRow: true }),
      p({ id: "doc", day: "2026-09-30", hasDocument: true }),
    ];
    expect(findDuplicateHandPayments(rows, new Map([["bank", merged("bank")], ["doc", merged("doc")]]))).toEqual([]);
  });

  it("لا يُعدّ: بلا دليل — رصيدٌ بيدٍ لا توأمَ له ولا دمجَ فكّه", () => {
    expect(findDuplicateHandPayments([p({ id: "x", day: "2026-09-01" })])).toEqual([]);
  });

  it("لا يُعدّ: التوأمُ بعيد، أو بمبلغٍ آخر، أو لمورّدٍ آخر، أو لم يسدّد شيئاً، أو ملغى", () => {
    const x = p({ id: "x", day: "2026-09-10" });
    expect(findDuplicateHandPayments([x, p({ id: "far", day: "2026-09-18", allocatedMinor: 204_30 })])).toEqual([]);
    expect(findDuplicateHandPayments([x, p({ id: "amt", day: "2026-09-10", amountMinor: 204_31, allocatedMinor: 204_31 })])).toEqual([]);
    expect(findDuplicateHandPayments([x, p({ id: "sup", supplierId: "other", day: "2026-09-10", allocatedMinor: 204_30 })])).toEqual([]);
    expect(findDuplicateHandPayments([x, p({ id: "free", day: "2026-09-10" })]).map((d) => d.paymentId)).toEqual([]);
    expect(findDuplicateHandPayments([x, p({ id: "void", day: "2026-09-10", allocatedMinor: 204_30, status: "VOID" })])).toEqual([]);
  });

  it("لا يُعدّ: مقدَّمةٌ أعلنها صاحبها، ولا إشعارٌ دائن، ولا عهدة، ولا ملغاة", () => {
    const twin = p({ id: "t", day: "2026-09-01", allocatedMinor: 204_30 });
    for (const over of [{ isAdvance: true }, { method: "CREDIT_NOTE" }, { method: "EMPLOYEE_ADVANCE" }, { status: "VOID" }, { status: "REVERSED" }]) {
      expect(findDuplicateHandPayments([twin, p({ id: "x", day: "2026-09-01", ...over })])).toEqual([]);
    }
  });

  it("لا يُعدّ ما دون الهللة: الرصيدُ صفرٌ عملاً", () => {
    const rows = [p({ id: "a", day: "2026-09-01", allocatedMinor: 204_30 }), p({ id: "b", day: "2026-09-01", allocatedMinor: 204_29 })];
    expect(findDuplicateHandPayments(rows)).toEqual([]);
  });
});

describe("findTwin", () => {
  it("الأقربُ يوماً", () => {
    const x = p({ id: "x", day: "2026-09-10" });
    const rows = [x, p({ id: "far", day: "2026-09-04", allocatedMinor: 204_30 }), p({ id: "near", day: "2026-09-11", allocatedMinor: 204_30 })];
    expect(findTwin(x, rows)?.id).toBe("near");
  });
});

describe("onlyPaidThis — عند الدمج و«حذف القيد»", () => {
  const hand = { status: "APPLIED", hasBankRow: false, hasDocument: false, method: "OWNER_ACCOUNT", isAdvance: false, amountMinor: 204_30, feeMinor: 0 };
  it("سدادٌ بيدٍ بمبلغه كلّه على هذه وحدها", () => {
    expect(onlyPaidThis(hand, [{ invoiceId: "drop", amountMinor: 204_30 }], "drop")).toBe(true);
  });
  it("لا: سدّد فاتورةً أخرى معها، أو زاد منه شيء، أو شهد له البنك أو الإيصال، أو لا تخصيص", () => {
    expect(onlyPaidThis(hand, [{ invoiceId: "drop", amountMinor: 100_00 }, { invoiceId: "other", amountMinor: 104_30 }], "drop")).toBe(false);
    expect(onlyPaidThis({ ...hand, amountMinor: 500_00 }, [{ invoiceId: "drop", amountMinor: 204_30 }], "drop")).toBe(false);
    expect(onlyPaidThis({ ...hand, hasBankRow: true }, [{ invoiceId: "drop", amountMinor: 204_30 }], "drop")).toBe(false);
    expect(onlyPaidThis({ ...hand, hasDocument: true }, [{ invoiceId: "drop", amountMinor: 204_30 }], "drop")).toBe(false);
    expect(onlyPaidThis(hand, [], "drop")).toBe(false);
  });
});

describe("duplicateWhy و handDuplicateKey", () => {
  it("يسمّي الفاتورتين والتوأم", () => {
    expect(duplicateWhy({ release: merged("x"), twin: { paymentId: "k", day: "2026-09-30", bank: false } }, ["74389"]))
      .toBe("كانت سداد نسخة مكررة من 74389 دُمجت في أختها المسدّدة، وللمورّد سداد آخر مسجّل بالمبلغ نفسه سدّد 74389");
    expect(duplicateWhy({ release: { ...merged("x"), droppedNumber: "0092-006-16895", keptNumber: "B07/2026/17328" }, twin: null }))
      .toBe("كانت سداد 0092-006-16895، وهي نسخة مكررة دُمجت في B07/2026/17328 المسدّدة");
    expect(duplicateWhy({ release: null, twin: { paymentId: "t", day: "2026-09-30", bank: true } }))
      .toBe("للمورّد حوالة في كشف البنك بالمبلغ نفسه سدّدت فاتورته");
  });
  it("المفتاح يوافق قيد 078", () => {
    expect(handDuplicateKey("pay_abc-1")).toMatch(/^[a-z-]{3,24}:[^\s]{1,160}$/);
  });
  it("isHandRecorded", () => {
    expect(isHandRecorded(p({ id: "a", day: "2026-09-01" }))).toBe(true);
    expect(isHandRecorded(p({ id: "a", day: "2026-09-01", method: "CASH" }))).toBe(true);
    expect(isHandRecorded(p({ id: "a", day: "2026-09-01", hasBankRow: true }))).toBe(false);
  });
});
