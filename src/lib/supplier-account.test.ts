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
