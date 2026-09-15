import { describe, expect, it } from "vitest";
import { buildSupplierAccount, describeAccount } from "./supplier-account";

const credit = (amountMinor: number, description: string) => ({
  id: "c1", date: new Date("2026-08-10"), amountMinor,
  description, reference: null,
});

describe("حسابُ المورّد — ما نعرفه مقابل ما يقول", () => {
  it("بلا كشفٍ لا مقارنة — والمجهول لا يصير صفراً", () => {
    const a = buildSupplierAccount({ billedMinor: 5_000_00, paidMinor: 2_000_00 });
    expect(a.knownBalanceMinor).toBe(3_000_00);
    expect(a.reportedBalanceMinor).toBeNull();
    expect(a.differenceMinor).toBeNull();
    expect(a.status).toBe("NO_STATEMENT");
  });

  it("الكشف يوافق ← متّفقان", () => {
    const a = buildSupplierAccount({
      billedMinor: 5_000_00, paidMinor: 2_000_00, reportedBalanceMinor: 3_000_00,
    });
    expect(a.status).toBe("AGREED");
    expect(a.differenceMinor).toBe(0);
  });

  it("ويُتسامح بريال — المورّد يُسقط الكسور", () => {
    const a = buildSupplierAccount({
      billedMinor: 5_000_00, paidMinor: 2_000_00, reportedBalanceMinor: 3_000_60,
    });
    expect(a.status).toBe("AGREED");
  });

  it("يطالب بأكثر ← الفرق موجب ويُفسَّر", () => {
    const a = buildSupplierAccount({
      billedMinor: 5_000_00, paidMinor: 2_000_00, reportedBalanceMinor: 4_000_00,
    });
    expect(a.status).toBe("DIFFERS");
    expect(a.differenceMinor).toBe(1_000_00);
    expect(describeAccount(a)).toContain("يطالب بأكثر");
  });

  it("نعرف أكثر ممّا يطالب ← الفرق سالب", () => {
    const a = buildSupplierAccount({
      billedMinor: 5_000_00, paidMinor: 2_000_00, reportedBalanceMinor: 1_000_00,
    });
    expect(a.differenceMinor).toBe(-2_000_00);
    expect(describeAccount(a)).toContain("نعرف أكثر");
  });

  it("الإشعار الدائن يخفض المستحقّ ولا يُعدّ سداداً", () => {
    const a = buildSupplierAccount({
      billedMinor: 5_000_00,
      paidMinor: 0,
      credits: [credit(700_00, "إشعار دائن عن مرتجع")],
      reportedBalanceMinor: 4_300_00,
    });
    expect(a.creditNoteMinor).toBe(700_00);
    expect(a.knownBalanceMinor).toBe(4_300_00);
    /* والمسدَّد باقٍ صفراً — لم يخرج مال */
    expect(a.paidMinor).toBe(0);
    expect(a.status).toBe("AGREED");
  });

  it("والسداد في الكشف ليس إشعاراً دائناً", () => {
    const a = buildSupplierAccount({
      billedMinor: 5_000_00, paidMinor: 0,
      credits: [credit(700_00, "تحويل بنكي")],
    });
    expect(a.creditNoteMinor).toBe(0);
    expect(a.knownBalanceMinor).toBe(5_000_00);
  });

  it("الرصيد السالب خبرٌ لا يُصفَّر — دفعنا أكثر ممّا فوتر", () => {
    const a = buildSupplierAccount({
      billedMinor: 1_000_00, paidMinor: 3_000_00, reportedBalanceMinor: -2_000_00,
    });
    expect(a.knownBalanceMinor).toBe(-2_000_00);
    expect(a.status).toBe("AGREED");
  });

  it("التسوية اليدويّة تدخل الحساب", () => {
    const a = buildSupplierAccount({
      billedMinor: 5_000_00, paidMinor: 2_000_00, adjustmentMinor: 250_00,
    });
    expect(a.knownBalanceMinor).toBe(3_250_00);
    expect(a.adjustmentMinor).toBe(250_00);
  });
});

/* ═══════════════════════════════════════════════════════════════
   ولا فاتورة ≠ ولا دَين

   وُجد على بيانات أحمد: ستّةُ موردين بلا فاتورةٍ ولا كشف، كانوا
   يُعرَضون «نعرف 0.00» — وهي جملةٌ تقول «لا شيء عليك له». ومورّدو
   المقهى فيهم من يعطي ورقةً باليد ومن لا يعطي شيئاً، فغيابُ الفاتورة
   عندنا غيابُ علمٍ لا غيابُ دَين.
   ═══════════════════════════════════════════════════════════════ */
describe("لا فاتورة ولا كشف ← مجهول لا صفر", () => {
  it("بلا شيءٍ أصلاً ← UNKNOWN و`null`", () => {
    const a = buildSupplierAccount({ billedMinor: 0, paidMinor: 0 });
    expect(a.knownBalanceMinor).toBeNull();
    expect(a.status).toBe("UNKNOWN");
    expect(describeAccount(a)).toContain("مجهول");
  });

  it("وكشفٌ وصل بلا فاتورةٍ عندنا ← لا يُقارَن", () => {
    const a = buildSupplierAccount({
      billedMinor: 0, paidMinor: 0, reportedBalanceMinor: 3_000_00,
    });
    expect(a.knownBalanceMinor).toBeNull();
    expect(a.differenceMinor).toBeNull();
    expect(a.status).toBe("NO_STATEMENT");
  });

  it("وفاتورةٌ مسدَّدة بالكامل ← صفرٌ حقيقيّ لا مجهول", () => {
    const a = buildSupplierAccount({ billedMinor: 3_000_00, paidMinor: 3_000_00 });
    expect(a.knownBalanceMinor).toBe(0);
    expect(a.status).toBe("NO_STATEMENT");
  });

  it("وسدادٌ بلا فاتورة ← معلومٌ سالب لا مجهول", () => {
    const a = buildSupplierAccount({ billedMinor: 0, paidMinor: 500_00 });
    expect(a.knownBalanceMinor).toBe(-500_00);
    expect(a.status).not.toBe("UNKNOWN");
  });
});

/* ═══════════════════════════════════════════════════════════════
   «فاتورةٌ لم تصلنا» تُنفى بالحساب قبل أن تُكتب — مصنع الكوب الذهبي

   فاتورتان: مايو INV263287 بـ١٣٬٥٠٦٫٧٥، ويوليو INV264916 بـ١٢٬٠٠٣٫١٣.
   حتى كشفه (١٥ يوليو) دُفع ١٥٢٫٣٧ و٧٬٥٠٠ حوالةً، و١٢٬٠٠٣٫١٣ من حساب
   المالك على يوليو. فنعرف ٥٬٨٥٤٫٣٨ (بقيّة مايو)، ويقول كشفُه ١٢٬٠٠٣٫١٣.
   وبعده خُصّص على مايو ٤٬٥٠٣٫١٣ و١٬١٥٠ و٢٠١٫٢٥ = ٥٬٨٥٤٫٣٨.
   ═══════════════════════════════════════════════════════════════ */
describe("الكوب الذهبي: الفرق ليس فاتورةً غائبة", () => {
  const golden = () => buildSupplierAccount({
    billedMinor: 1_350_675 + 1_200_313,
    paidMinor: 15_237 + 750_000 + 1_200_313,
    reportedBalanceMinor: 1_200_313,
    allocatedAfterStatementMinor: 450_313 + 115_000 + 20_125,
    invoicesAtStatement: [
      { invoiceNumber: "INV263287", totalMinor: 1_350_675 },
      { invoiceNumber: "INV264916", totalMinor: 1_200_313 },
    ],
  });

  it("الأرقام كما في الصفحة", () => {
    const a = golden();
    expect(a.knownBalanceMinor).toBe(585_438);
    expect(a.differenceMinor).toBe(614_875);
    expect(a.allocatedAfterStatementMinor).toBe(585_438);
    expect(a.status).toBe("DIFFERS");
  });

  it("رصيدُ كشفه فاتورةٌ عندنا — فلا يُكتب «لم تصلنا»", () => {
    const a = golden();
    expect(a.explanation).toEqual({ kind: "INVOICE_ON_FILE", invoiceNumber: "INV264916" });
    expect(describeAccount(a)).not.toContain("لم تصلنا");
    expect(describeAccount(a)).toContain("INV264916");
  });

  it("وإن ساوى الفرقُ ما خُصّص بعد الكشف فهو ترتيبُ تخصيص", () => {
    const a = buildSupplierAccount({
      billedMinor: 1_350_675, paidMinor: 765_237,
      reportedBalanceMinor: 585_438 + 585_438,
      allocatedAfterStatementMinor: 585_438,
    });
    expect(a.explanation).toEqual({ kind: "ALLOCATED_AFTER_STATEMENT" });
    expect(describeAccount(a)).toContain("ترتيبُ تخصيص");
    expect(describeAccount(a)).not.toContain("لم تصلنا");
  });

  it("وبلا تفسيرٍ يُثبَت يبقى الاحتمال مكتوباً", () => {
    const a = buildSupplierAccount({
      billedMinor: 5_000_00, paidMinor: 2_000_00, reportedBalanceMinor: 4_000_00,
      allocatedAfterStatementMinor: 300_00,
      invoicesAtStatement: [{ invoiceNumber: "X1", totalMinor: 5_000_00 }],
    });
    expect(a.explanation).toBeNull();
    expect(describeAccount(a)).toContain("لم تصلنا");
  });

  it("وبلا كشفٍ لا يُحسَب ما بعده — مجهول لا صفر", () => {
    const a = buildSupplierAccount({ billedMinor: 5_000_00, paidMinor: 2_000_00 });
    expect(a.allocatedAfterStatementMinor).toBeNull();
    expect(a.explanation).toBeNull();
  });
});
