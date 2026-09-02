import { describe, expect, it } from "vitest";
import {
  drivePathFor, monthOf, nextMonth, previousMonth,
  resolveInvoiceFiling, resolveReceiptFiling,
} from "./filing";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("حساب الأشهر", () => {
  it("يعبر حدّ السنة في الاتجاهين", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(monthOf(d("2026-08-29"))).toBe("2026-08");
  });
});

describe("الشهر = تاريخ الفاتورة لا تاريخ السداد", () => {
  it("فاتورة ٢٩ أغسطس تبقى في أغسطس ولو سُدّدت في سبتمبر", () => {
    const r = resolveInvoiceFiling({ invoiceDate: d("2026-08-29"), isPaid: true });
    expect(r.periodMonth).toBe("2026-08");
    expect(r.carriedForwardFrom).toBeUndefined();
  });
});

describe("ترحيل الفاتورة المتأخرة عن كشف موردها", () => {
  it("غير مسددة ووصلت بعد الكشف — تُرحَّل مع حفظ الأثر", () => {
    const r = resolveInvoiceFiling({
      invoiceDate: d("2026-08-31"),
      supplierStatementDate: d("2026-08-28"),
      isPaid: false,
    });
    expect(r.periodMonth).toBe("2026-09");
    expect(r.carriedForwardFrom).toBe("2026-08");
  });

  it("مسددة — لا تُرحَّل مهما تأخرت", () => {
    const r = resolveInvoiceFiling({
      invoiceDate: d("2026-08-31"),
      supplierStatementDate: d("2026-08-28"),
      isPaid: true,
    });
    expect(r.periodMonth).toBe("2026-08");
  });

  it("سبقت الكشف — تبقى في شهرها", () => {
    const r = resolveInvoiceFiling({
      invoiceDate: d("2026-08-10"),
      supplierStatementDate: d("2026-08-28"),
      isPaid: false,
    });
    expect(r.periodMonth).toBe("2026-08");
  });

  it("لا كشف بعد — تبقى في شهرها", () => {
    const r = resolveInvoiceFiling({ invoiceDate: d("2026-08-31"), isPaid: false });
    expect(r.periodMonth).toBe("2026-08");
  });
});

describe("إيصال السداد يتبع شهر فواتيره لا شهر التحويل", () => {
  it("حُوّل ٢ سبتمبر عن فواتير أغسطس ← مجلد أغسطس", () => {
    expect(resolveReceiptFiling({
      paidAt: d("2026-09-02"),
      settledInvoiceMonths: ["2026-08", "2026-08"],
    })).toBe("2026-08");
  });

  it("عند تعدّد الأشهر يأخذ الأقدم", () => {
    expect(resolveReceiptFiling({
      paidAt: d("2026-09-02"),
      settledInvoiceMonths: ["2026-08", "2026-07"],
    })).toBe("2026-07");
  });

  it("بلا تخصيصات يرجع للشهر السابق حسب منطق السداد المعتاد", () => {
    expect(resolveReceiptFiling({ paidAt: d("2026-09-02") })).toBe("2026-08");
    expect(resolveReceiptFiling({ paidAt: d("2027-01-03") })).toBe("2026-12");
  });
});

describe("مسار المجلد المعروض قبل الحفظ", () => {
  it("يبني المسار الكامل", () => {
    expect(drivePathFor("2026-08", "Olive Leaves"))
      .toBe("ACCOUNTS / 2026 / 2026-08 / Olive Leaves");
  });
});
