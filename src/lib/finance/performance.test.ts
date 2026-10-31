import { describe, expect, it } from "vitest";
import { BENCHMARKS, FORGOTTEN_SEC, formatDuration, formatShare, monthKpi, serviceSpeed, verdictOf, type KpiInput } from "./performance";

const base: KpiInput = {
  month: "2026-09", revenueMinor: 100_000_00, paidMinor: 115_000_00, cardMinor: 110_000_00, orders: 2_300,
  cogsMinor: 30_000_00, opex: new Map([["SALARY", 28_000_00], ["RENT", 9_000_00], ["POS_FEE", 900_00], ["POS_VAT", 135_00]]),
  missing: new Set(), profitMinor: 12_000_00, profitLabel: "صافي الربح", complete: true, open: false,
  discountMinor: 230_00, refundsMinor: 115_00, staffListMinor: 1_500_00,
};

describe("مؤشّراتُ الشهر", () => {
  it("كلُّ نسبةٍ من الإيراد بلا ضريبة، ومتوسّطُ الطلب بما دفعه الزبائن", () => {
    const k = monthKpi(base);
    expect(k).toMatchObject({ cogsBp: 3000, labourBp: 2800, rentBp: 900, primeBp: 5800, netMarginBp: 1200, ticketMinor: 5000 });
    /* الرسومُ وضريبتُها من مقبوض البطاقة: 1035 / 110000 */
    expect(k.cardFeeBp).toBe(94);
  });

  it("بابٌ منتظَرٌ غائب مجهولٌ لا صفر — والتكلفةُ الأساسيّة مجهولةٌ معه", () => {
    const k = monthKpi({ ...base, opex: new Map([["RENT", 9_000_00]]), missing: new Set(["SALARY"]) });
    expect(k.labourBp).toBeNull();
    expect(k.primeBp).toBeNull();
    expect(k.rentBp).toBe(900);
  });

  it("بلا إيرادٍ لا نسبة، وبلا رسومٍ في الكشف لا «صفر٪»", () => {
    const k = monthKpi({ ...base, revenueMinor: null, opex: new Map() });
    expect(k.cogsBp).toBeNull();
    expect(k.netMarginBp).toBeNull();
    expect(k.cardFeeBp).toBeNull();
  });
});

describe("المرجعُ العامّ", () => {
  it("الأدنى خيرٌ للتكلفة، والأعلى خيرٌ للهامش", () => {
    expect(verdictOf(3000, BENCHMARKS.cogs)).toBe("WITHIN");
    expect(verdictOf(4200, BENCHMARKS.cogs)).toBe("WORSE");
    expect(verdictOf(2000, BENCHMARKS.cogs)).toBe("BETTER");
    expect(verdictOf(600, BENCHMARKS.netMargin)).toBe("WORSE");
    expect(verdictOf(1800, BENCHMARKS.netMargin)).toBe("BETTER");
    expect(verdictOf(null, BENCHMARKS.rent)).toBeNull();
  });
});

describe("الأفضلُ بكثير سؤالٌ لا بشرى", () => {
  it("هامشُ 42٪ في مقهى «تحقّق» لا «أفضل»، وكذلك رواتبُ دون نصف المعتاد", () => {
    expect(verdictOf(4220, BENCHMARKS.netMargin)).toBe("SUSPECT");
    expect(verdictOf(1200, BENCHMARKS.labour)).toBe("SUSPECT");
    expect(verdictOf(1960, BENCHMARKS.labour)).toBe("BETTER");
  });
});

describe("سرعةُ الخدمة", () => {
  it("الوسيطُ والعُشرُ الأبطأ، وما نُسي على الشاشة يُعَدّ ولا يُحسَب", () => {
    const samples = [...Array.from({ length: 20 }, (_, i) => ({ hour: 9, seconds: 200 + i * 10 })), { hour: 9, seconds: FORGOTTEN_SEC + 5 }];
    const s = serviceSpeed(samples);
    expect(s.measured).toBe(20);
    expect(s.forgotten).toBe(1);
    expect(s.medianSec).toBe(300);
    expect(s.p90Sec).toBe(380);
    expect(s.slowBp).toBe(0);
    expect(s.byHour).toEqual([{ hour: 9, orders: 20, medianSec: 300, p90Sec: 380 }]);
  });

  it("الساعاتُ بترتيب يوم العمل: منتصفُ الليل بعد الحادية عشرة لا قبل السابعة", () => {
    const samples = [0, 7, 23].flatMap((hour) => Array.from({ length: 15 }, () => ({ hour, seconds: 300 })));
    expect(serviceSpeed(samples).byHour.map((h) => h.hour)).toEqual([7, 23, 0]);
  });

  it("ساعةٌ بعيّنةٍ صغيرة لا يُقال وسيطُها، وبلا قياسٍ لا رقم", () => {
    expect(serviceSpeed([{ hour: 3, seconds: 120 }]).byHour).toEqual([]);
    expect(serviceSpeed([]).medianSec).toBeNull();
  });

  it("الزمنُ بكلماتٍ قصيرة", () => {
    expect(formatDuration(432)).toBe("7 د 12 ث");
    expect(formatDuration(45)).toBe("45 ث");
    expect(formatDuration(300)).toBe("5 د");
  });
});

describe("الحصّة", () => {
  it("بلا إشارة، وبخانةٍ واحدة، والمجهولُ يُقال", () => {
    expect(formatShare(2843)).toBe("⁦28.4٪⁩");
    expect(formatShare(null)).toBe("غير معروف");
  });
});
