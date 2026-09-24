import { describe, expect, it } from "vitest";
import { buildAccountantPack, summarize, type PackInput } from "./accountant-pack";

const base: PackInput = {
  month: "2026-08",
  monthLabel: "أغسطس 2026",
  generatedAt: "2026-09-24",
  closed: false,
  invoices: [],
  payments: [],
  expenses: [],
  bank: [],
};

const inv = (over: Partial<PackInput["invoices"][number]> = {}): PackInput["invoices"][number] => ({
  number: "INV-1",
  date: "2026-08-03",
  supplier: "مورّد",
  sellerVat: "300000000000003",
  subtotalMinor: 10_000,
  vatMinor: 1_500,
  totalMinor: 11_500,
  taxStatus: "VALID",
  inputVatStatus: "ELIGIBLE",
  paidMinor: 0,
  ...over,
});

describe("حزمة المحاسب", () => {
  it("ستُّ أوراقٍ بترتيب ما يُسأل عنه", () => {
    expect(buildAccountantPack(base).map((s) => s.name)).toEqual([
      "الملخّص", "الفواتير", "الضريبة", "الدفعات", "المصروفات", "حركات البنك",
    ]);
  });

  it("الضريبةُ المجهولة «غير معروف» لا صفر — وتُعَدّ في الملخّص", () => {
    const p = { ...base, invoices: [inv(), inv({ number: "INV-2", vatMinor: null, subtotalMinor: null, inputVatStatus: "UNKNOWN" })] };
    const sheet = buildAccountantPack(p).find((s) => s.name === "الفواتير")!;
    expect(sheet.rows[2][5]).toBe("غير معروف");
    expect(summarize(p).vatUnknownCount).toBe(1);
    expect(summarize(p).vatKnownMinor).toBe(1_500);
  });

  it("الضريبة القابلة للخصم من «تُخصم» وحدها", () => {
    const p = { ...base, invoices: [inv(), inv({ number: "X", inputVatStatus: "NOT_ELIGIBLE", vatMinor: 900 })] };
    expect(summarize(p).deductibleVatMinor).toBe(1_500);
  });

  it("المبالغ تُكتب ريالاتٍ بمنزلتين من هللاتٍ صحيحة — لا قسمةَ عائمة", () => {
    const sheet = buildAccountantPack({ ...base, invoices: [inv({ totalMinor: 1_234_567 })] }).find((s) => s.name === "الفواتير")!;
    expect(sheet.rows[1][6]).toEqual({ riyals: "12345.67" });
  });

  it("الدفعةُ المردودة والملغاة لا تُجمعان في «دفعات الشهر»", () => {
    const pay = (status: string) => ({ date: "2026-08-05", supplier: "م", amountMinor: 1_000, feeMinor: 0, method: "BANK_TRANSFER", status, invoices: [], fromBank: true });
    expect(summarize({ ...base, payments: [pay("APPLIED"), pay("REVERSED"), pay("VOID")] }).paymentsMinor).toBe(1_000);
  });

  it("المسدَّد لا يتجاوز الإجماليّ والباقي لا يصير سالباً", () => {
    const s = summarize({ ...base, invoices: [inv({ paidMinor: 20_000 })] });
    expect(s.paidMinor).toBe(11_500);
    expect(s.openMinor).toBe(0);
  });
});
