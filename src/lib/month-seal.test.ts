import { describe, expect, it } from "vitest";
import { SEAL_VERSION, diffSealedFigures, driftLine, driftMagnitude, readDriftCheck, readSealedFigures, type SealedFigures } from "./month-seal";

const base = (): SealedFigures => ({
  v: SEAL_VERSION,
  owed: { totalMinor: 1_500_00, suppliers: [{ id: "s1", name: "المراعي", owedMinor: 1_000_00 }, { id: "s2", name: "نادك", owedMinor: 500_00 }] },
  bank: [{ accountId: "a1", label: "الجاري", closingMinor: 9_000_00, creditsMinor: 20_000_00, debitsMinor: 11_000_00 }],
  vat: { outputVatMinor: 2_600_00, inputVatMinor: 1_100_00, netMinor: 1_500_00 },
  notSealed: ["الربح"],
});

describe("ما تغيّر من أرقام الشهر بعد ختمه", () => {
  it("الحسابُ نفسُه: لا فرق", () => {
    expect(diffSealedFigures("2026-08", base(), base())).toEqual([]);
  });

  it("فاتورةٌ متأخّرة: المجموعُ والمورّدُ معاً بقيمتيهما", () => {
    const now = base();
    now.owed.totalMinor = 1_730_00;
    now.owed.suppliers[0].owedMinor = 1_230_00;
    expect(diffSealedFigures("2026-08", base(), now)).toEqual([
      { month: "2026-08", figure: "عليك للمورّدين في آخر الشهر", sealedMinor: 1_500_00, nowMinor: 1_730_00 },
      { month: "2026-08", figure: "عليك لـ«المراعي» في آخر الشهر", sealedMinor: 1_000_00, nowMinor: 1_230_00 },
    ]);
  });

  it("مورّدٌ سُدّد كلُّه بعد الختم يُقال صفراً محسوباً، ومورّدٌ جديد يظهر من صفر", () => {
    const now = base();
    now.owed.suppliers = [{ id: "s1", name: "المراعي", owedMinor: 1_000_00 }, { id: "s3", name: "الكوب الذهبي", owedMinor: 500_00 }];
    const d = diffSealedFigures("2026-08", base(), now);
    expect(d).toContainEqual(expect.objectContaining({ figure: "عليك لـ«نادك» في آخر الشهر", sealedMinor: 500_00, nowMinor: 0 }));
    expect(d).toContainEqual(expect.objectContaining({ figure: "عليك لـ«الكوب الذهبي» في آخر الشهر", sealedMinor: 0, nowMinor: 500_00 }));
    /* والمجموعُ لم يتغيّر فلا يُقال */
    expect(d.some((x) => x.figure.startsWith("عليك للمورّدين"))).toBe(false);
  });

  it("الرصيدُ الختاميّ المجهول يبقى مجهولاً — فإن عُرف أو جُهل فذلك فرق", () => {
    const sealed = base();
    sealed.bank[0].closingMinor = null;
    const d = diffSealedFigures("2026-08", sealed, base());
    expect(d).toEqual([{ month: "2026-08", figure: "رصيد ختام الجاري", sealedMinor: null, nowMinor: 9_000_00 }]);
    expect(driftLine(d[0])).toBe("عند الإقفال غير معروف · الآن 9,000.00");
  });

  it("حسابٌ ظهر بعد الختم: وارده من صفر، ورصيده من مجهول", () => {
    const now = base();
    now.bank.push({ accountId: null, label: "حساب غير محدَّد", closingMinor: null, creditsMinor: 5_00, debitsMinor: 0 });
    expect(diffSealedFigures("2026-08", base(), now)).toEqual([
      { month: "2026-08", figure: "الوارد إلى حساب غير محدَّد", sealedMinor: 0, nowMinor: 5_00 },
    ]);
  });

  it("اختيارٌ ضريبيّ بعد الإقفال يحرّك ضريبة المدخلات", () => {
    const now = base();
    now.vat.inputVatMinor = 1_250_00;
    expect(diffSealedFigures("2026-08", base(), now)).toEqual([
      { month: "2026-08", figure: "ضريبة المدخلات", sealedMinor: 1_100_00, nowMinor: 1_250_00 },
    ]);
  });

  it("البصمةُ مجموعُ التغيّر، والمجهولُ يُعدّ تغيّراً", () => {
    expect(driftMagnitude([{ sealedMinor: 100, nowMinor: 40 }, { sealedMinor: null, nowMinor: 5 }])).toBe(61);
  });
});

describe("قراءةُ ما حُفظ", () => {
  it("ختمٌ بنسخةٍ أخرى أو مبلغٍ عشريّ لا يُقرأ — فلا يُخترَع له فرق", () => {
    expect(readSealedFigures(base())).toEqual(base());
    expect(readSealedFigures({ ...base(), v: 2 })).toBeNull();
    expect(readSealedFigures({ ...base(), vat: { outputVatMinor: 1.5, inputVatMinor: 0, netMinor: 0 } })).toBeNull();
    expect(readSealedFigures(null)).toBeNull();
  });

  it("فحصُ الصباح يُقرأ بشكله", () => {
    const check = { months: 2, findings: [{ sealId: "x", month: "2026-08", figure: "ضريبة المخرجات", sealedMinor: 1, nowMinor: 2 }] };
    expect(readDriftCheck(check)).toEqual(check);
    expect(readDriftCheck({ months: 1 })).toBeNull();
  });
});
