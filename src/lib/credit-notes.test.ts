import { describe, expect, it } from "vitest";
import {
  balanceWithCredits, classifyCredit, explainByCredit, type CreditLine,
} from "./credit-notes";

const line = (over: Partial<CreditLine> & { id: string }): CreditLine => ({
  date: new Date("2026-08-12T00:00:00Z"),
  amountMinor: 700_00,
  description: null,
  reference: null,
  ...over,
});

describe("classifyCredit", () => {
  it("يميّز الإشعار الدائن من السداد", () => {
    expect(classifyCredit(line({ id: "a", description: "إشعار دائن" }))).toBe("CREDIT_NOTE");
    expect(classifyCredit(line({ id: "b", description: "مرتجع بضاعة" }))).toBe("CREDIT_NOTE");
    expect(classifyCredit(line({ id: "c", reference: "CN-114" }))).toBe("CREDIT_NOTE");
    expect(classifyCredit(line({ id: "d", description: "سداد" }))).toBe("PAYMENT");
  });

  it("ما لا دليل فيه يُعدّ سداداً — والسداد هو الأصل في الدائن", () => {
    expect(classifyCredit(line({ id: "a" }))).toBe("PAYMENT");
  });
});

describe("balanceWithCredits", () => {
  it("الحالة التي ذكرها المراجع: ٥٬٠٠٠ وإشعار ٧٠٠ ← ٤٬٣٠٠", () => {
    const b = balanceWithCredits({
      billedMinor: 5_000_00,
      paidMinor: 0,
      credits: [line({ id: "cn", amountMinor: 700_00, description: "إشعار دائن" })],
    });
    expect(b.outstandingMinor).toBe(4_300_00);
    expect(b.creditNoteMinor).toBe(700_00);
  });

  it("والإشعار لا يُعدّ سداداً — من ينظر «كم دفعتُ» لا يجد تخفيضاً بلا مال", () => {
    const b = balanceWithCredits({
      billedMinor: 5_000_00, paidMinor: 0,
      credits: [line({ id: "cn", description: "إشعار دائن" })],
    });
    expect(b.paidMinor).toBe(0);
  });

  it("السداد في القائمة لا يُطرَح مرّتين", () => {
    const b = balanceWithCredits({
      billedMinor: 5_000_00, paidMinor: 5_000_00,
      credits: [line({ id: "p", amountMinor: 5_000_00, description: "سداد" })],
    });
    expect(b.outstandingMinor).toBe(0);
    expect(b.creditNoteMinor).toBe(0);
  });

  it("لا يُنتج رصيداً سالباً", () => {
    const b = balanceWithCredits({
      billedMinor: 100_00, paidMinor: 0,
      credits: [line({ id: "cn", amountMinor: 900_00, description: "مرتجع" })],
    });
    expect(b.outstandingMinor).toBe(0);
  });

  it("بلا إشعارات يبقى الحساب كما هو", () => {
    const b = balanceWithCredits({ billedMinor: 1_000_00, paidMinor: 400_00, credits: [] });
    expect(b.outstandingMinor).toBe(600_00);
  });
});

describe("explainByCredit", () => {
  it("الفرق الذي يساوي إشعاراً ليس اختلافاً", () => {
    const cn = line({ id: "cn", amountMinor: 700_00, description: "إشعار دائن" });
    expect(explainByCredit(700_00, [cn])?.id).toBe("cn");
    expect(explainByCredit(-700_00, [cn])?.id).toBe("cn");
  });

  it("ويتسامح بهللة", () => {
    const cn = line({ id: "cn", amountMinor: 700_01, description: "مرتجع" });
    expect(explainByCredit(700_00, [cn])).not.toBeNull();
  });

  it("ولا يفسَّر بسداد", () => {
    expect(explainByCredit(700_00, [line({ id: "p", description: "سداد" })])).toBeNull();
  });

  it("لا فرق فلا تفسير", () => {
    expect(explainByCredit(0, [line({ id: "cn", description: "مرتجع" })])).toBeNull();
  });
});
