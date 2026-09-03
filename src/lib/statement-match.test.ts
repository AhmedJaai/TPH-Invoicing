import { describe, expect, it } from "vitest";
import { buildDiscrepancyMemo, normalizeRef, reconcileStatement, type OurInvoice, type StatementLineInput } from "./statement-match";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** التاريخ نصّ في الاختبار ويصير Date في المدخل — فالنوع يُكتب صراحةً لا بـPartial */
interface LineSpec {
  date: string;
  ref?: string | null;
  description?: string | null;
  debitMinor?: number;
  creditMinor?: number;
}

const line = (o: LineSpec): StatementLineInput => ({
  date: d(o.date),
  ref: o.ref ?? null,
  description: o.description ?? null,
  debitMinor: o.debitMinor ?? 0,
  creditMinor: o.creditMinor ?? 0,
});

const inv = (id: string, number: string, date: string, total: number): OurInvoice => ({
  invoiceId: id, invoiceNumber: number, invoiceDate: d(date), totalMinor: total,
});

describe("normalizeRef", () => {
  it("يوحّد الرموز والحالة", () => {
    expect(normalizeRef("civ-008205250")).toBe("CIV008205250");
    expect(normalizeRef("CIV 008205250")).toBe(normalizeRef("CIV-008205250"));
  });
  it("الفراغ يبقى فراغاً", () => {
    expect(normalizeRef(null)).toBe("");
  });
});

describe("reconcileStatement", () => {
  it("يطابق بالرقم ولو كتبه المورّد داخل نصّ", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "INV CIV-008205250 توريد", debitMinor: 68540 })],
      [inv("a", "CIV-008205250", "2026-05-14", 68540)],
    );
    expect(r.matchedCount).toBe(1);
    expect(r.lines[0].method).toBe("REF");
    expect(r.missingFromArchive).toHaveLength(0);
  });

  it("يطابق بالمبلغ والتاريخ حين لا يكتب المورّد رقماً", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-16", description: "توريد", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.matchedCount).toBe(1);
    expect(r.lines[0].method).toBe("AMOUNT_DATE");
  });

  it("لا يطابق بالمبلغ إذا بعُد التاريخ", () => {
    const r = reconcileStatement(
      [line({ date: "2026-06-30", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.missingFromArchive).toHaveLength(1);
  });

  it("يكشف الفاتورة التي حمّلها ولم تصلنا — وهي الغاية", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 }),
        line({ date: "2026-05-20", ref: "260144", debitMinor: 99000 }),
      ],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.missingFromArchive).toHaveLength(1);
    expect(r.missingFromArchive[0].line.ref).toBe("260144");
    expect(r.findings.some((f) => f.code === "INVOICE_IN_STATEMENT_NOT_ARCHIVED")).toBe(true);
  });

  it("يكشف فرق المبلغ ويحسب اتجاهه", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 45000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.amountMismatches).toHaveLength(1);
    expect(r.amountMismatches[0].differenceMinor).toBe(3000);
    expect(r.matchedCount).toBe(0);
  });

  it("يتسامح بهللة واحدة لفرق التقريب", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42001 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.matchedCount).toBe(1);
  });

  it("يذكر فواتيرنا التي لم ترد في كشفه", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000), inv("b", "260140", "2026-05-18", 15000)],
    );
    expect(r.notInStatement).toHaveLength(1);
    expect(r.notInStatement[0].invoiceNumber).toBe("260140");
  });

  it("لا يخصّص الفاتورة الواحدة لسطرين", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-05-14", debitMinor: 42000 }),
        line({ date: "2026-05-15", debitMinor: 42000 }),
      ],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.matchedCount).toBe(1);
    expect(r.missingFromArchive).toHaveLength(1);
  });

  it("السطر الدائن سداد لا فاتورة", () => {
    const r = reconcileStatement(
      [line({ date: "2026-06-02", creditMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.lines[0].status).toBe("PAYMENT");
    expect(r.theirPaidMinor).toBe(42000);
    expect(r.notInStatement).toHaveLength(1);
  });

  it("يجمع المحمَّل والمسدَّد ويقارنه بما عندنا", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 }),
        line({ date: "2026-06-02", creditMinor: 20000 }),
      ],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.theirBilledMinor).toBe(42000);
    expect(r.theirPaidMinor).toBe(20000);
    expect(r.ourBilledMinor).toBe(42000);
    expect(r.billedDifferenceMinor).toBe(0);
  });

  it("يفحص حساب الكشف نفسه ويكشف اختلاله", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
      { openingBalanceMinor: 10000, closingBalanceMinor: 60000 },
    );
    expect(r.computedClosingMinor).toBe(52000);
    expect(r.balanceArithmeticOk).toBe(false);
    expect(r.findings.some((f) => f.message.includes("لا يستقيم"))).toBe(true);
  });

  it("يقبل الحساب المستقيم", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
      { openingBalanceMinor: 10000, closingBalanceMinor: 52000 },
    );
    expect(r.balanceArithmeticOk).toBe(true);
  });

  it("بلا رصيد ختامي لا يُدّعى فحص لم يجرِ", () => {
    const r = reconcileStatement([], []);
    expect(r.balanceArithmeticOk).toBeNull();
  });

  it("المرجع القصير لا يطابق كل شيء", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "7", debitMinor: 500 })],
      [inv("a", "137", "2026-05-14", 99999)],
    );
    expect(r.missingFromArchive).toHaveLength(1);
  });
});

describe("buildDiscrepancyMemo", () => {
  it("يذكر الناقص والمختلف والزائد بأرقامها", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-05-14", ref: "260137", debitMinor: 45000 }),
        line({ date: "2026-05-20", ref: "260144", debitMinor: 99000 }),
      ],
      [inv("a", "260137", "2026-05-14", 42000), inv("b", "260150", "2026-05-25", 7000)],
    );
    const memo = buildDiscrepancyMemo("أوراق الزيتون", "مايو ٢٠٢٦", r);
    expect(memo).toContain("أوراق الزيتون");
    expect(memo).toContain("260144");
    expect(memo).toContain("260137");
    expect(memo).toContain("260150");
    expect(memo).toContain("1,440.00");
  });

  it("الكشف المتطابق لا يولّد مطالبات", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    const memo = buildDiscrepancyMemo("مورّد", "مايو", r);
    expect(memo).not.toContain("نرجو إرسالها");
    expect(memo).not.toContain("يختلف مبلغها");
  });
});
