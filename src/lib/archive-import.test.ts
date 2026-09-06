import { describe, expect, it } from "vitest";
import { planImport } from "./archive-import";
import { parseFileName } from "./naming";

function plan(fileName: string, hasSupplier = true) {
  const r = parseFileName(fileName, ["OliveLeaves", "Loreva", "PURE-Oska", "SardTrading"]);
  if (!r.ok) throw new Error(r.reason);
  return planImport(r.value, hasSupplier);
}

describe("planImport", () => {
  it("الفاتورة المكتملة تُنشئ قيداً", () => {
    const p = plan("2026-08-14_OliveLeaves_Invoice_260200_SAR420.00.pdf");
    expect(p.documentKind).toBe("TAX_INVOICE");
    expect(p.createsInvoice).toBe(true);
    expect(p.notes).toHaveLength(0);
  });

  it("الفاتورة بلا رقم تُسجَّل مستنداً وتُذكر في الملاحظات", () => {
    const p = plan("2026-05-21_OliveLeaves_Invoice_SAR405.00.pdf");
    expect(p.createsInvoice).toBe(false);
    expect(p.notes.some((n) => n.includes("بلا رقم"))).toBe(true);
  });

  /*
    كان هذا الاختبار يُثبّت العطب: الكشف بلا مبلغٍ في اسمه يسقط من
    الجدول كلّه. فسقطت ثلاثة كشوف مؤرشفة فعلاً — منها هذا — وظهر
    «أوراق الزيتون» في «لم يصل كشفه» وقد أرسله مرّتين.

    والفاتورة بلا مبلغ لا معنى لها فلا تُقيَّد، أمّا الكشف فهويّته
    مورّدُه وفترتُه؛ ورصيده يُملأ حين يُطابَق ويُعلَن مجهولاً حتّى ذلك.
  */
  it("الكشف بلا مبلغ يُقيَّد ويُذكر أنّ مبلغه لم يُقرأ", () => {
    const p = plan("2026-07-31_OliveLeaves_Statement_to-31-07.pdf");
    expect(p.documentKind).toBe("STATEMENT");
    expect(p.createsStatement).toBe(true);
    expect(p.notes.some((n) => n.includes("لا مبلغ"))).toBe(true);
  });

  it("الفاتورة بلا مبلغ تبقى غير مقيَّدة — الفرق مقصود", () => {
    const p = plan("2026-05-21_OliveLeaves_Invoice_260137.pdf");
    expect(p.createsInvoice).toBe(false);
  });

  it("الإيصال يُنشئ دفعة", () => {
    const p = plan("2026-08-02_Receipt_Loreva-MaqamAlThiqa_SAR1200.00.pdf");
    expect(p.createsPayment).toBe(true);
    expect(p.paymentMethod).toBe("BANK_TRANSFER");
  });

  it("الإيصال النقدي دفعة نقدية", () => {
    const p = plan("2026-08-02_Cash_ChangeBox_SAR300.00.jpg");
    expect(p.createsPayment).toBe(true);
    expect(p.paymentMethod).toBe("CASH");
  });

  it("المورد غير المسجّل يمنع القيد ويُذكر", () => {
    const p = plan("2026-08-14_OliveLeaves_Invoice_260200_SAR420.00.pdf", false);
    expect(p.createsInvoice).toBe(false);
    expect(p.notes.some((n) => n.includes("غير مسجّل"))).toBe(true);
  });

  it("الفاتورة الصادرة لا تدخل المشتريات", () => {
    const p = plan("2026-07-01_SalesInvoice_SabeaJar_S00011_SAR1100.00.pdf");
    expect(p.documentKind).toBe("UNKNOWN");
    expect(p.createsInvoice).toBe(false);
  });

  it("الشهر بلا يوم يُذكر لا يُبتلَع", () => {
    const p = plan("2026-05_OliveLeaves_Invoice_INVA-02527_SAR240.00.pdf");
    expect(p.notes.some((n) => n.includes("بلا يوم"))).toBe(true);
  });
});
