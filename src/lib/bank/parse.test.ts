import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseBankDate, parseBankStatement } from "./parse";

/** يبني ملفاً كما يُصدّره البنك: ترويسة ثمّ رؤوس ثمّ حركات. */
function book(sheets: Record<string, (string | number)[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const HEADER = ["التاريخ", "نوع العملية", "الوصف", "اسم المستفيد", "المبلغ", "الرصيد"];

describe("parseBankDate", () => {
  it("يقرأ صيغة الكشوف السعودية", () => {
    expect(parseBankDate("17/08/2026")?.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("يقرأ الصيغة العالمية", () => {
    expect(parseBankDate("2026-08-17")?.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("يتجاهل الوقت في سطر ثانٍ", () => {
    expect(parseBankDate("17/08/2026\n14:32")?.toISOString().slice(0, 10)).toBe("2026-08-17");
  });

  it("يرفض ما ليس تاريخاً ولا يخمّن", () => {
    expect(parseBankDate("32/13/2026")).toBeNull();
    expect(parseBankDate("الإجمالي")).toBeNull();
  });
});

describe("parseBankStatement — عمود المستفيد", () => {
  it("يلتقط المستفيد كما كتبه البنك", () => {
    const buf = book({
      Sheet1: [
        ["حساب رقم", "12600000942005"],
        HEADER,
        ["17/08/2026", "حوالة فورية محلية صادرة", "شراء بضاعة", "لوريفا كيك", "-3500.00", "1000.00"],
      ],
    });
    const r = parseBankStatement(buf);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].beneficiaryRaw).toBe("لوريفا كيك");
    expect(r.accountNumber).toBe("12600000942005");
  });

  it("العمود الغائب يترك الحقل غائباً لا نصّاً فارغاً", () => {
    const buf = book({
      Sheet1: [
        ["التاريخ", "الوصف", "المبلغ"],
        ["17/08/2026", "تحويل", "-100.00"],
      ],
    });
    expect(parseBankStatement(buf).rows[0].beneficiaryRaw).toBeUndefined();
  });

  it("العمود الموجود والفارغ كذلك", () => {
    const buf = book({
      Sheet1: [HEADER, ["17/08/2026", "حوالة", "تحويل", "   ", "-100.00", "0"]],
    });
    expect(parseBankStatement(buf).rows[0].beneficiaryRaw).toBeUndefined();
  });

  it("يقبل صيغ اسم العمود المختلفة", () => {
    for (const header of ["المستفيد", "Beneficiary", "beneficiary name", "الطرف الآخر", "payee"]) {
      const buf = book({
        Sheet1: [
          ["التاريخ", "الوصف", header, "المبلغ"],
          ["17/08/2026", "تحويل", "بدر", "-100.00"],
        ],
      });
      expect(parseBankStatement(buf).rows[0].beneficiaryRaw).toBe("بدر");
    }
  });
});

describe("parseBankStatement — رؤوس الأعمدة", () => {
  it("يوحّد الهمزة والتاء المربوطة في الرؤوس", () => {
    const buf = book({
      Sheet1: [
        ["تاريخ العمليه", "نوع العمليه", "الوصف", "المبلغ"],
        ["17/08/2026", "حواله", "تحويل", "-100.00"],
      ],
    });
    expect(parseBankStatement(buf).rows).toHaveLength(1);
  });

  it("«تاريخ القيد» لا يُلتقَط مكان «التاريخ»", () => {
    const buf = book({
      Sheet1: [
        ["تاريخ القيد", "التاريخ", "الوصف", "المبلغ"],
        ["16/08/2026", "17/08/2026", "تحويل", "-100.00"],
      ],
    });
    const r = parseBankStatement(buf);
    expect(r.rows[0].valueDate.toISOString().slice(0, 10)).toBe("2026-08-17");
    expect(r.rows[0].postingDate?.toISOString().slice(0, 10)).toBe("2026-08-16");
  });

  it("يقرأ عمودَي مدين ودائن حين لا يوجد عمود مبلغ", () => {
    const buf = book({
      Sheet1: [
        ["التاريخ", "الوصف", "مدين", "دائن"],
        ["17/08/2026", "صادر", "500.00", ""],
        ["18/08/2026", "وارد", "", "900.00"],
      ],
    });
    const r = parseBankStatement(buf);
    expect(r.rows[0].direction).toBe("DEBIT");
    expect(r.rows[1].direction).toBe("CREDIT");
    expect(r.rows[1].amountMinor).toBe(900_00);
  });
});

describe("parseBankStatement — أوراق متعدّدة", () => {
  it("يتخطّى ورقة الغلاف إلى ورقة الحركات", () => {
    const buf = book({
      "ملخص": [["كشف حساب"], ["الفترة", "أغسطس"]],
      "الحركات": [HEADER, ["17/08/2026", "حوالة", "تحويل", "بدر", "-250.00", "10.00"]],
    });
    const r = parseBankStatement(buf);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].beneficiaryRaw).toBe("بدر");
  });

  it("ملفٌ بلا رؤوس يُعلن ذلك ولا يرجع صفوفاً كاذبة", () => {
    const buf = book({ Sheet1: [["مرحباً"], ["لا شيء هنا"]] });
    const r = parseBankStatement(buf);
    expect(r.rows).toEqual([]);
    expect(r.warnings[0].reason).toContain("لم يُعثر على صفّ الرؤوس");
  });
});

describe("parseBankStatement — الصفوف", () => {
  it("يتخطّى صفوف الإجماليات بلا شكوى", () => {
    const buf = book({
      Sheet1: [
        HEADER,
        ["17/08/2026", "حوالة", "تحويل", "بدر", "-100.00", "0"],
        ["", "", "الإجمالي", "", "-100.00", ""],
      ],
    });
    const r = parseBankStatement(buf);
    expect(r.rows).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });

  it("يشتقّ فترة الكشف من تواريخ صفوفه", () => {
    const buf = book({
      Sheet1: [
        HEADER,
        ["05/08/2026", "حوالة", "أ", "بدر", "-100.00", "0"],
        ["29/08/2026", "حوالة", "ب", "بدر", "-100.00", "0"],
      ],
    });
    const r = parseBankStatement(buf);
    expect(r.periodStart?.toISOString().slice(0, 10)).toBe("2026-08-05");
    expect(r.periodEnd?.toISOString().slice(0, 10)).toBe("2026-08-29");
  });
});
