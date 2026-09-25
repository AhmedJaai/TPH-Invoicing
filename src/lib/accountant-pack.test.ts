import { describe, expect, it } from "vitest";
import { buildAccountantPack, expensesByCategory, invoiceOpenMinor, outflowByCategory, summarize, vatByStatus, type PackInput } from "./accountant-pack";

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

describe("ضريبةُ المدخلات بحالها — مصدرُ الورقة والحزمة المطبوعة", () => {
  it("يجمع المقروء ويعدّ المجهول ولا يجمعه صفراً", () => {
    const p = {
      ...base,
      invoices: [
        inv(),
        inv({ number: "B", vatMinor: 900 }),
        inv({ number: "C", vatMinor: null, inputVatStatus: "UNKNOWN" }),
        inv({ number: "D", inputVatStatus: "NOT_ELIGIBLE", vatMinor: 300 }),
      ],
    };
    expect(vatByStatus(p)).toEqual([
      { status: "ELIGIBLE", count: 2, vatKnownMinor: 2_400, unknownVat: 0 },
      { status: "NOT_ELIGIBLE", count: 1, vatKnownMinor: 300, unknownVat: 0 },
      { status: "UNKNOWN", count: 1, vatKnownMinor: 0, unknownVat: 1 },
    ]);
  });

  it("الباقي على الفاتورة لا يقلّ عن صفر — الزائدُ رصيدٌ لا دينٌ سالب", () => {
    expect(invoiceOpenMinor(inv({ paidMinor: 4_000 }))).toBe(7_500);
    expect(invoiceOpenMinor(inv({ paidMinor: 20_000 }))).toBe(0);
  });
});

describe("صادرُ البنك في الحزمة", () => {
  const row = (over: Partial<PackInput["bank"][number]>): PackInput["bank"][number] => ({
    date: "2026-08-05", description: "—", direction: "DEBIT", amountMinor: 1_000, category: "POS_FEE", matched: false, ...over,
  });

  it("رسومُ الشبكة والرواتبُ مفسَّرةٌ ببابها — لا «لم يُطابَق»", () => {
    const p = {
      ...base,
      bank: [
        row({}),
        row({ category: "SALARY" }),
        row({ category: "UNKNOWN" }),
        row({ category: "SUPPLIER" }),
        row({ category: "SUPPLIER", matched: true }),
        row({ direction: "CREDIT", category: "UNKNOWN" }),
      ],
    };
    expect(summarize(p).bankUnexplainedCount).toBe(2);
  });

  it("الصادرُ بأبوابه، الأكبرُ أوّلاً، والواردُ لا يدخله", () => {
    const p = {
      ...base,
      bank: [row({ amountMinor: 100 }), row({ amountMinor: 200 }), row({ category: "RENT", amountMinor: 4_750_000 }), row({ direction: "CREDIT", amountMinor: 9 })],
    };
    expect(outflowByCategory(p)).toEqual([
      { category: "RENT", count: 1, totalMinor: 4_750_000 },
      { category: "POS_FEE", count: 2, totalMinor: 300 },
    ]);
  });
});

describe("المصروفاتُ بأبوابها", () => {
  it("تُجمع بالباب، الأكبرُ أوّلاً", () => {
    const e = (category: string, amountMinor: number) => ({ date: "2026-08-01", category, label: "—", amountMinor, source: "BANK" });
    const p = { ...base, expenses: [e("POS_FEE", 40), e("POS_FEE", 60), e("RENT", 4_750_000)] };
    expect(expensesByCategory(p)).toEqual([
      { category: "RENT", count: 1, totalMinor: 4_750_000 },
      { category: "POS_FEE", count: 2, totalMinor: 100 },
    ]);
  });
});
