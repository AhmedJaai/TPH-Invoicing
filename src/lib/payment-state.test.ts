import { describe, expect, it } from "vitest";
import {
  availableMinor, canTransition, countsAsPaid, derivePaymentStatus,
  planReversal, STATUS_LABEL, type PaymentFacts,
} from "./payment-state";

const facts = (over: Partial<PaymentFacts> = {}): PaymentFacts => ({
  amountMinor: 5_000_00,
  allocatedMinor: 0,
  feeMinor: 0,
  declaredAdvance: false,
  reversedAt: null,
  voided: false,
  ...over,
});

describe("اشتقاق حال الدفعة", () => {
  it("مالٌ خرج ولم يُنسَب بعد", () => {
    expect(derivePaymentStatus(facts())).toBe("UNAPPLIED");
  });

  /*
    الفرق نيّةٌ لا حساب: «لم تُخصَّص بعد» تنتظر عملاً، و«مقدّمة» تمّ
    عملها. ولذلك تُعلَن ولا تُشتقّ.
  */
  it("المعلَنة مقدّمةً ليست منسيّة", () => {
    expect(derivePaymentStatus(facts({ declaredAdvance: true }))).toBe("ADVANCE");
  });

  it("بعضها مخصَّص", () => {
    expect(derivePaymentStatus(facts({ allocatedMinor: 2_000_00 }))).toBe("PARTIALLY_APPLIED");
  });

  it("كلّها مخصَّصة", () => {
    expect(derivePaymentStatus(facts({ allocatedMinor: 5_000_00 }))).toBe("APPLIED");
  });

  it("هللةٌ لا تمنع الاستقرار", () => {
    expect(derivePaymentStatus(facts({ allocatedMinor: 4_999_99 }))).toBe("APPLIED");
    expect(derivePaymentStatus(facts({ allocatedMinor: 4_999_98 }))).toBe("PARTIALLY_APPLIED");
  });

  it("دُفع أكثر من الفواتير → فائض", () => {
    expect(derivePaymentStatus(facts({ amountMinor: 5_000_00, allocatedMinor: 5_200_00 })))
      .toBe("OVERPAYMENT");
  });

  /*
    هذا هو عطب الرسم: كان يُترك داخل مبلغ الدفعة فتظهر «فائضةً بعشرين
    ريالاً»، ويُفتَح للمورّد رصيدٌ لا وجود له — والعشرون ذهبت للبنك.
  */
  it("الرسم يخرج قبل القسمة فلا يُخترَع فائض", () => {
    const f = facts({ amountMinor: 5_020_00, allocatedMinor: 5_000_00, feeMinor: 20_00 });
    expect(derivePaymentStatus(f)).toBe("APPLIED");
    expect(availableMinor(f)).toBe(0);
  });

  it("بلا فصل الرسم كانت تُقرأ فائضة", () => {
    const f = facts({ amountMinor: 5_020_00, allocatedMinor: 5_000_00, feeMinor: 0 });
    expect(derivePaymentStatus(f)).toBe("PARTIALLY_APPLIED");
  });
});

describe("المردودة والملغاة", () => {
  /*
    كانت الدفعة المردودة تُحسَب مدفوعةً كغيرها — فيظهر المقهى وقد دفع
    ما لم يدفع.
  */
  it("المردودة لا تُحسَب مدفوعة", () => {
    const f = facts({ reversedAt: new Date(), allocatedMinor: 5_000_00 });
    expect(derivePaymentStatus(f)).toBe("REVERSED");
    expect(countsAsPaid("REVERSED")).toBe(false);
    expect(availableMinor(f)).toBe(0);
  });

  it("الملغاة كذلك — وهي لم تقع أصلاً", () => {
    expect(derivePaymentStatus(facts({ voided: true }))).toBe("VOID");
    expect(countsAsPaid("VOID")).toBe(false);
  });

  it("الإلغاء يسبق كل حساب", () => {
    expect(derivePaymentStatus(facts({ voided: true, reversedAt: new Date() }))).toBe("VOID");
  });

  it("لكل حالٍ اسمٌ عربيّ", () => {
    expect(Object.keys(STATUS_LABEL)).toHaveLength(7);
    expect(STATUS_LABEL.OVERPAYMENT).toBe("فائضة");
  });
});

describe("الانتقالات", () => {
  it("المقدّمة تُخصَّص لاحقاً", () => {
    expect(canTransition("ADVANCE", "APPLIED")).toBe(true);
    expect(canTransition("ADVANCE", "PARTIALLY_APPLIED")).toBe(true);
  });

  it("فكّ التخصيص يعيدها بلا تخصيص", () => {
    expect(canTransition("APPLIED", "UNAPPLIED")).toBe(true);
  });

  /* ردُّ الردّ قيدٌ جديد لا انتقال — وإلّا ضاع أنّ المال خرج ورجع وخرج */
  it("المردودة نهاية", () => {
    expect(canTransition("REVERSED", "APPLIED")).toBe(false);
    expect(canTransition("REVERSED", "UNAPPLIED")).toBe(false);
    expect(canTransition("VOID", "APPLIED")).toBe(false);
  });

  it("الحال إلى نفسه مسموح", () => {
    expect(canTransition("REVERSED", "REVERSED")).toBe(true);
  });

  it("كل حالٍ يمكن ردّه أو إلغاؤه", () => {
    for (const s of ["UNAPPLIED", "ADVANCE", "PARTIALLY_APPLIED", "APPLIED", "OVERPAYMENT"] as const) {
      expect(canTransition(s, "REVERSED")).toBe(true);
      expect(canTransition(s, "VOID")).toBe(true);
    }
  });
});

describe("خطّة الردّ", () => {
  /*
    الردّ لا يحذف: الحذف يجعل الفاتورة تعود مستحقّةً بلا سببٍ ظاهر،
    فيُدفَع ثمنها مرّتين.
  */
  it("يفكّ التخصيصات ويعلن ما تحرّر", () => {
    const p = planReversal(
      [{ invoiceId: "i1", amountMinor: 3_000_00 }, { invoiceId: "i2", amountMinor: 2_000_00 }],
      "REVERSED",
      "ارتدّت الحوالة",
    );
    expect(p.freedInvoiceIds).toEqual(["i1", "i2"]);
    expect(p.freedMinor).toBe(5_000_00);
    expect(p.reason).toBe("ارتدّت الحوالة");
  });

  it("بلا سببٍ مكتوب يُكتب سببٌ صريح", () => {
    expect(planReversal([], "VOID", "  ").reason).toContain("لم تقع");
    expect(planReversal([], "REVERSED", "").reason).toContain("رُدَّ مالها");
  });
});

describe("المتاح للتخصيص", () => {
  it("ما بقي بعد الرسم والمخصَّص", () => {
    expect(availableMinor(facts({ amountMinor: 5_000_00, allocatedMinor: 2_000_00 }))).toBe(3_000_00);
    expect(availableMinor(facts({ amountMinor: 5_020_00, feeMinor: 20_00, allocatedMinor: 2_000_00 })))
      .toBe(3_000_00);
  });

  it("الفائضة لا تعطي متاحاً سالباً", () => {
    expect(availableMinor(facts({ allocatedMinor: 6_000_00 }))).toBe(0);
  });
});
