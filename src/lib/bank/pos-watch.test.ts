import { describe, expect, it } from "vitest";
import {
  batchDay, feeRose, missingSettlementKey, missingSettlements, monthlyFees, rateBp, schemeLabel, settlementDays,
  type PosTx,
} from "./pos-watch";

/** صفوفٌ بصيغة كشف الأهلي الحقيقيّة — بقطع البنك داخل الكلمات. */
let seq = 0;
function settle(saleDay: string, amountMinor: number, scheme = "MC", valueDay?: string): PosTx {
  const yymmdd = saleDay.slice(2).replaceAll("-", "");
  return {
    id: `s${seq++}`, day: valueDay ?? saleDay, amountMinor, direction: "CREDIT", kind: "POS_SETTLEMENT",
    description: `81140155-${yymmdd}-POS ${scheme} Se ttlem 125207`, transactionType: null,
  };
}
function fee(saleDay: string, amountMinor: number, valueDay?: string): PosTx {
  const yymmdd = saleDay.slice(2).replaceAll("-", "");
  return {
    id: `f${seq++}`, day: valueDay ?? saleDay, amountMinor, direction: "DEBIT", kind: "POS_FEE",
    description: `81140155-${yymmdd}-POS FV Fe es 825258`, transactionType: null,
  };
}
function vat(saleDay: string, amountMinor: number): PosTx {
  const yymmdd = saleDay.slice(2).replaceAll("-", "");
  return {
    id: `v${seq++}`, day: saleDay, amountMinor, direction: "DEBIT", kind: "POS_VAT",
    description: `81140155-${yymmdd}-POS VM VA T 607110`, transactionType: null,
  };
}
function days(from: string, count: number): string[] {
  const [y, m, d] = from.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

describe("batchDay · rateBp · schemeLabel", () => {
  it("يومُ الدفعة من رمزها، وما ليس تاريخاً null", () => {
    expect(batchDay("260718")).toBe("2026-07-18");
    expect(batchDay("261340")).toBeNull();
    expect(batchDay(undefined)).toBeNull();
  });

  it("النسبة بنقاط الأساس عدداً صحيحاً، وبلا مقامٍ null لا صفر", () => {
    expect(rateBp(1_50, 100_00)).toBe(150);
    expect(rateBp(0, 100_00)).toBe(0);
    expect(rateBp(1_50, 0)).toBeNull();
  });

  it("لا يُخمَّن اسمُ شبكةٍ لم يثبت رمزُها", () => {
    expect(schemeLabel("MC")).toBe("ماستركارد (MC)");
    expect(schemeLabel("SM")).toBe("رمز SM");
    expect(schemeLabel(undefined)).toBe("رمزٌ لم يُقرأ");
  });
});

describe("monthlyFees", () => {
  it("الرسمُ ÷ التسوية لكلّ شهر، والضريبةُ لا تدخل النسبة", () => {
    const [m] = monthlyFees([settle("2026-07-18", 1000_00), fee("2026-07-18", 12_00), vat("2026-07-18", 1_80)]);
    expect(m.month).toBe("2026-07");
    expect(m.settlementMinor).toBe(1000_00);
    expect(m.feeMinor).toBe(12_00);
    expect(m.vatMinor).toBe(1_80);
    expect(m.rateBp).toBe(120);
  });

  it("الرسمُ الشهريّ للجهاز (بلا دفعة) يُعزل ولا يرفع النسبة", () => {
    const monthly: PosTx = {
      id: "m", day: "2026-07-30", amountMinor: 60_00, direction: "DEBIT", kind: "POS_FEE",
      description: "PoSMonthlyFeeJul81140156", transactionType: "رسوم نقاط بيع شهرية",
    };
    const [m] = monthlyFees([settle("2026-07-18", 1000_00), fee("2026-07-18", 10_00), monthly]);
    expect(m.feeMinor).toBe(10_00);
    expect(m.fixedFeeMinor).toBe(60_00);
    expect(m.rateBp).toBe(100);
  });

  it("شهرٌ بلا تسوياتٍ نسبتُه مجهولة لا صفر", () => {
    const [m] = monthlyFees([fee("2026-07-18", 10_00)]);
    expect(m.rateBp).toBeNull();
    expect(m.excessMinor).toBeNull();
  });

  it("التسوياتُ تُعرض برمز شبكتها", () => {
    const [m] = monthlyFees([settle("2026-07-18", 700_00, "MC"), settle("2026-07-18", 300_00, "VC"), settle("2026-07-19", 100_00, "MC")]);
    expect(m.schemes.map((s) => [s.code, s.settlementMinor, s.count])).toEqual([["MC", 800_00, 2], ["VC", 300_00, 1]]);
  });

  it("العادةُ وسيطُ ثلاثة أشهرٍ سابقة على الأقلّ — ودونها «لا عادة»", () => {
    const rows = [
      settle("2026-04-10", 1000_00), fee("2026-04-10", 10_00),
      settle("2026-05-10", 1000_00), fee("2026-05-10", 10_00),
      settle("2026-06-10", 1000_00), fee("2026-06-10", 12_00),
      settle("2026-07-10", 2000_00), fee("2026-07-10", 30_00),
    ];
    const months = monthlyFees(rows);
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-06", "2026-05", "2026-04"]);
    const july = months[0];
    expect(july.rateBp).toBe(150);
    expect(july.usualBp).toBe(100);
    /* ٥٠ نقطة على ٢٠٠٠ ريال = ١٠ ريالات */
    expect(july.excessMinor).toBe(10_00);
    expect(months[1].usualBp).toBeNull();
  });

  it("يُقال الارتفاعُ حين يبلغ خمسَ نقاطٍ وخمسين ريالاً معاً", () => {
    expect(feeRose({ rateBp: 150, usualBp: 100, excessMinor: 10_00 })).toBe(false);
    expect(feeRose({ rateBp: 150, usualBp: 100, excessMinor: 400_00 })).toBe(true);
    expect(feeRose({ rateBp: 102, usualBp: 100, excessMinor: 400_00 })).toBe(false);
    expect(feeRose({ rateBp: 150, usualBp: null, excessMinor: null })).toBe(false);
  });
});

describe("settlementDays", () => {
  it("اليومُ يومُ البيع من الوصف لا يومُ القيمة، والصافي بعد الرسم والضريبة", () => {
    const out = settlementDays([
      settle("2026-07-18", 1000_00, "MC", "2026-07-19"),
      settle("2026-07-18", 200_00, "VC", "2026-07-20"),
      fee("2026-07-18", 12_00, "2026-07-21"),
      vat("2026-07-18", 1_80),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      day: "2026-07-18", settlementMinor: 1200_00, feeMinor: 12_00, vatMinor: 1_80, netMinor: 1186_20, batches: 2, byValueDate: false,
    });
  });

  it("الوصفُ الصامت يُنسب إلى يوم قيمته ويُعلَن", () => {
    const silent: PosTx = {
      id: "x", day: "2026-07-20", amountMinor: 500_00, direction: "CREDIT", kind: "POS_SETTLEMENT",
      description: null, transactionType: "ايداع نقاط بيع",
    };
    const [d] = settlementDays([silent]);
    expect(d).toMatchObject({ day: "2026-07-20", settlementMinor: 500_00, byValueDate: true, batches: 1 });
  });
});

describe("missingSettlements", () => {
  const all = days("2026-06-01", 60);
  const rows = (skip: readonly string[]) => all.filter((d) => !skip.includes(d)).map((d) => settle(d, 900_00));

  it("يومٌ معتادٌ بلا تسوية يُسأل عنه، بوسيط مثله", () => {
    const out = missingSettlements(rows(["2026-07-20"]), { lastBankDay: "2026-07-30" });
    expect(out).toEqual([{ day: "2026-07-20", usualMinor: 900_00, seenWeeks: 6 }]);
  });

  it("لا يُسأل عن يومٍ لم يغطِّ الكشفُ ما بعده بالمهلة", () => {
    expect(missingSettlements(rows(["2026-07-28"]), { lastBankDay: "2026-07-30" })).toEqual([]);
    expect(missingSettlements(rows(["2026-07-26"]), { lastBankDay: "2026-07-30" })).toHaveLength(1);
  });

  it("يومُ عطلةٍ أسبوعيّة (لا تسويةَ في مثله) ليس غياباً", () => {
    /* كلُّ جمعة بلا تسوية: 2026-06-05 جمعة */
    const fridays = all.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 5);
    expect(missingSettlements(rows(fridays), { lastBankDay: "2026-07-30" })).toEqual([]);
  });

  it("ما حسمه صاحبُه لا يعود", () => {
    const ignored = new Set([missingSettlementKey("2026-07-20")]);
    expect(missingSettlements(rows(["2026-07-20"]), { lastBankDay: "2026-07-30", ignored })).toEqual([]);
  });

  it("بلا كشفٍ أو بلا تسوياتٍ لا يُقال شيء — لا «كلُّ الأيّام غائبة»", () => {
    expect(missingSettlements(rows([]), { lastBankDay: null })).toEqual([]);
    expect(missingSettlements([], { lastBankDay: "2026-07-30" })).toEqual([]);
  });

  it("تاريخٌ أقصر من أربعة أسابيع لا يكفي ليُعرف المعتاد", () => {
    const short = days("2026-07-01", 20).filter((d) => d !== "2026-07-15").map((d) => settle(d, 900_00));
    expect(missingSettlements(short, { lastBankDay: "2026-07-30" })).toEqual([]);
  });

  it("تسويةٌ بلا يومِ بيعٍ تغطّي يومَ قيمتها واليومين قبله", () => {
    const silent: PosTx = {
      id: "x", day: "2026-07-21", amountMinor: 900_00, direction: "CREDIT", kind: "POS_SETTLEMENT",
      description: null, transactionType: "ايداع نقاط بيع",
    };
    expect(missingSettlements([...rows(["2026-07-20"]), silent], { lastBankDay: "2026-07-30" })).toEqual([]);
  });

  it("النافذةُ تحدّ ما يُنظر فيه", () => {
    const out = missingSettlements(rows(["2026-06-25", "2026-07-20"]), { lastBankDay: "2026-07-30", lookbackDays: 14 });
    expect(out.map((m) => m.day)).toEqual(["2026-07-20"]);
  });
});
