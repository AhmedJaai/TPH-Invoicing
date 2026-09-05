import { describe, expect, it } from "vitest";
import {
  MAX_ADJUSTMENT, MIN_HISTORY, buildProfile, fitToProfile,
  type PaymentObservation,
} from "./supplier-profile";

const obs = (lagDays: number, invoiceCount = 1, amountMinor = 1_000_00): PaymentObservation =>
  ({ lagDays, invoiceCount, amountMinor });

describe("بناء الملامح", () => {
  /*
    ترجيحٌ مبنيّ على مرّةٍ واحدة أسوأ من لا ترجيح: له ثقةُ الإحصاء بلا
    سنده.
  */
  it("ما دون الحدّ لا يُبنى عليه", () => {
    const p = buildProfile("S1", [obs(2), obs(3)]);
    expect(p.known).toBe(false);
    expect(p.medianLagDays).toBeNull();
    expect(p.sampleSize).toBe(2);
  });

  it("الحدّ خمس دفعات", () => {
    expect(MIN_HISTORY).toBe(5);
    expect(buildProfile("S1", Array.from({ length: 5 }, () => obs(2))).known).toBe(true);
  });

  /* الوسيط لا المتوسّط: دفعةٌ متأخّرة شهرين لا تزيح العادة */
  it("الشاذّ لا يزيح العادة", () => {
    const p = buildProfile("S1", [obs(2), obs(2), obs(3), obs(2), obs(2), obs(120)]);
    expect(p.medianLagDays).toBe(2);
  });

  it("يعرف من يُسدَّد جمعاً", () => {
    const batched = buildProfile("S1", Array.from({ length: 6 }, () => obs(30, 8)));
    expect(batched.batches).toBe(true);
    expect(batched.medianInvoicesPerPayment).toBe(8);

    const single = buildProfile("S2", Array.from({ length: 6 }, () => obs(2, 1)));
    expect(single.batches).toBe(false);
  });
});

describe("موافقة المرشّح للملامح", () => {
  const fast = buildProfile("S1", [obs(2), obs(3), obs(2), obs(1), obs(3), obs(2)]);
  const monthly = buildProfile("S2", Array.from({ length: 6 }, (_, i) => obs(28 + i, 7)));

  it("المجهول لا يُرجّح ولا يخفض", () => {
    const p = buildProfile("S9", [obs(2)]);
    expect(fitToProfile(p, { lagDays: 400, invoiceCount: 9 }).adjustment).toBe(0);
    expect(fitToProfile(p, { lagDays: 2, invoiceCount: 1 }).reason).toBeNull();
  });

  it("ما وافق العادة يُرجَّح", () => {
    const fit = fitToProfile(fast, { lagDays: 2, invoiceCount: 1 });
    expect(fit.adjustment).toBeGreaterThan(0);
    expect(fit.reason).toContain("عادتُه");
  });

  it("ما بَعُد عنها يُخفَّض", () => {
    expect(fitToProfile(fast, { lagDays: 90, invoiceCount: 1 }).adjustment).toBeLessThan(0);
  });

  /*
    ونافذةٌ واحدة للجميع تظلم أحدهما: من يُسدَّد بعد يومين ومن يُسدَّد
    آخرَ الشهر ليسا سواء.
  */
  it("مهلةُ الشهر عاديّة عند صاحبها شاذّة عند غيره", () => {
    expect(fitToProfile(monthly, { lagDays: 30, invoiceCount: 7 }).adjustment)
      .toBeGreaterThan(0);
    expect(fitToProfile(fast, { lagDays: 30, invoiceCount: 1 }).adjustment)
      .toBeLessThanOrEqual(0);
  });

  it("المجموعة تُرجَّح عند من يُسدَّد جمعاً وتُخفَّض عند غيره", () => {
    expect(fitToProfile(monthly, { lagDays: 30, invoiceCount: 7 }).reason)
      .toContain("جمعاً");
    expect(fitToProfile(fast, { lagDays: 2, invoiceCount: 6 }).reason)
      .toContain("لم يُسدَّد جمعاً");
  });

  /* ترجيحٌ لا حسم: الملامح تفصل بين متقاربَين ولا تجعل بعيداً قريباً */
  it("التعديل محدودٌ في الاتّجاهين", () => {
    for (const c of [
      { lagDays: 2, invoiceCount: 1 }, { lagDays: 900, invoiceCount: 40 },
      { lagDays: -50, invoiceCount: 1 },
    ]) {
      const a = fitToProfile(fast, c).adjustment;
      expect(Math.abs(a)).toBeLessThanOrEqual(MAX_ADJUSTMENT);
    }
  });
});
