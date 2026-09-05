import { describe, expect, it } from "vitest";
import {
  BALANCE_TOLERANCE_MINOR, checkBalance, describeReconciliation, reconcileAccount,
} from "./balance-equation";

describe("معادلة الكشف", () => {
  it("الافتتاحي والحركات يعطيان الختامي", () => {
    const r = checkBalance({
      openingMinor: 100_000_00, closingMinor: 80_000_00,
      creditsMinor: 30_000_00, debitsMinor: 50_000_00,
    });
    expect(r.status).toBe("BALANCED");
    expect(r.differenceMinor).toBe(0);
  });

  /*
    هذا هو الخطأ الذي لا تكشفه مطابقةُ الحركات: كل حركة قُرئت طُوبقت،
    لكن في الكشف حركةً لم تُقرأ أصلاً. فالمطابقة تامّة على ناقص.
  */
  it("حركة لم تُقرأ من الملفّ تظهر في الفرق", () => {
    const r = checkBalance({
      openingMinor: 100_000_00, closingMinor: 68_400_00,
      creditsMinor: 30_000_00, debitsMinor: 50_000_00,
    });
    expect(r.status).toBe("UNEXPLAINED");
    expect(r.differenceMinor).toBe(-11_600_00);
    expect(r.reason).toContain("صادرة لم تُقرأ");
  });

  it("فرقٌ موجب يعني واردةً لم تُقرأ", () => {
    const r = checkBalance({
      openingMinor: 0, closingMinor: 500_00, creditsMinor: 0, debitsMinor: 0,
    });
    expect(r.status).toBe("UNEXPLAINED");
    expect(r.reason).toContain("واردة لم تُقرأ");
  });

  it("هللةٌ واحدة تُتسامَح، وهللتان لا", () => {
    expect(BALANCE_TOLERANCE_MINOR).toBe(1);
    expect(checkBalance({ openingMinor: 0, closingMinor: 1, creditsMinor: 0, debitsMinor: 0 }).status)
      .toBe("WITHIN_TOLERANCE");
    expect(checkBalance({ openingMinor: 0, closingMinor: 2, creditsMinor: 0, debitsMinor: 0 }).status)
      .toBe("UNEXPLAINED");
  });

  /* المجهول ليس صفراً: افتراضُه يخترع فرقاً بحجم الرصيد كلِّه */
  it("رصيدٌ غير معروف لا يُفترَض صفراً", () => {
    const r = checkBalance({
      openingMinor: null, closingMinor: 80_000_00, creditsMinor: 0, debitsMinor: 0,
    });
    expect(r.status).toBe("UNKNOWN");
    expect(r.differenceMinor).toBeNull();
    expect(r.reason).toContain("الافتتاحي");
  });

  it("الختامي غير المعروف كذلك", () => {
    expect(checkBalance({ openingMinor: 0, closingMinor: null, creditsMinor: 0, debitsMinor: 0 }).status)
      .toBe("UNKNOWN");
  });
});

describe("تسوية الحساب", () => {
  const row = (amount: number, dir: "DEBIT" | "CREDIT", explained: boolean) =>
    ({ amountMinor: amount, direction: dir, explained });

  it("كل الحركات مفسَّرة والمعادلة صحيحة → مسوّى", () => {
    const r = reconcileAccount(
      [row(50_000_00, "DEBIT", true), row(30_000_00, "CREDIT", true)],
      { openingMinor: 100_000_00, closingMinor: 80_000_00 },
    );
    expect(r.reconciled).toBe(true);
    expect(r.unexplainedMinor).toBe(0);
  });

  /*
    الشرط الثاني وحده لا يكفي — وهذا لبّ الفرق بين «طوبقت ٣٠١ حركة»
    و«الحساب مضبوط».
  */
  it("كل الحركات مطابَقة والمعادلة مختلّة → غير مسوّى", () => {
    const r = reconcileAccount(
      [row(50_000_00, "DEBIT", true)],
      { openingMinor: 100_000_00, closingMinor: 38_400_00 },
    );
    expect(r.explainedCount).toBe(1);
    expect(r.unexplainedCount).toBe(0);
    expect(r.reconciled).toBe(false);
    expect(r.balance.status).toBe("UNEXPLAINED");
  });

  it("حركةٌ بلا تفسير تمنع التسوية ويُعرَض مبلغها", () => {
    const r = reconcileAccount(
      [row(50_000_00, "DEBIT", true), row(11_600_00, "DEBIT", false)],
      { openingMinor: 100_000_00, closingMinor: 38_400_00 },
    );
    expect(r.reconciled).toBe(false);
    expect(r.unexplainedMinor).toBe(11_600_00);
    expect(describeReconciliation(r)).toContain("11,600.00");
  });

  it("المعادلة المجهولة تُعلَن ولا تُحسَب نجاحاً", () => {
    const r = reconcileAccount(
      [row(50_000_00, "DEBIT", true)],
      { openingMinor: null, closingMinor: null },
    );
    expect(r.reconciled).toBe(false);
    expect(describeReconciliation(r)).toContain("لا تُفحَص");
  });
});
