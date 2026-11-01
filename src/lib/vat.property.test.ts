import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_AMOUNT_MINOR } from "./money";
import {
  grossOfVat, netInsideGross, netOfVat, vatInsideGross, vatMatchesStandardRate, vatOnNet,
} from "./vat";

/**
 * خصائصُ الضريبة — قوانينُ على كلّ مبلغٍ في مدى عمود المال لا على أمثلةٍ مختارة.
 *
 * ── ما كشفه هذا الملفّ (١ نوفمبر ٢٠٢٦) ──
 *
 * ‏`vatOnNet` كانت تقرّب بـ`Math.round`: صافي ١٠ هللات ضريبتُه ١٫٥ ← ٢، وصافي
 * −١٠ (إشعارٌ دائن بالمبلغ نفسه) ← −١. فالفاتورةُ ومرتجعُها الكامل لا يتقاصّان
 * إلى صفر. وهي القاعدةُ نفسُها التي جعلت `milliMinorToMinor` و`microToMinor`
 * تقرّبان النصفَ بعيداً عن الصفر في الجهتين.
 */
const RUNS = { numRuns: 3000, seed: 20261101 };
const minor = fc.integer({ min: -MAX_AMOUNT_MINOR, max: MAX_AMOUNT_MINOR });

const ROUNDERS = { vatInsideGross, vatOnNet, netInsideGross, netOfVat, grossOfVat };

describe("الضريبة — خصائص", () => {
  it("كلُّ دالّةٍ تعطي هللاتٍ صحيحة", () => {
    fc.assert(fc.property(minor, (m) => {
      for (const f of Object.values(ROUNDERS)) expect(Number.isSafeInteger(f(m))).toBe(true);
    }), RUNS);
  });

  it("السالبُ مرآةُ الموجب — الإشعارُ الدائن يقاصّ فاتورتَه هللةً بهللة", () => {
    fc.assert(fc.property(minor, (m) => {
      for (const [name, f] of Object.entries(ROUNDERS)) {
        expect(f(-m) + f(m), `${name}(${m})`).toBe(0);
      }
    }), RUNS);
  });

  it("الضريبةُ والصافي داخل الشامل يجمعان الشاملَ نفسَه بلا هللةٍ ضائعة", () => {
    fc.assert(fc.property(minor, (g) => {
      expect(vatInsideGross(g) + netInsideGross(g)).toBe(g);
    }), RUNS);
  });

  it("ضريبةُ الصافي تطابق النسبةَ الأساسيّة بلا تسامح فوق نصف هللة", () => {
    fc.assert(fc.property(minor, (n) => {
      const v = vatOnNet(n);
      expect(Math.abs(v * 100 - n * 15)).toBeLessThanOrEqual(50);
      expect(vatMatchesStandardRate(n, v, 1)).toBe(true);
    }), RUNS);
  });

  it("والمثالُ الذي كسرها: صافي ±١٠ هللات ضريبتُه ±٢", () => {
    expect(vatOnNet(10)).toBe(2);
    expect(vatOnNet(-10)).toBe(-2);
  });
});
