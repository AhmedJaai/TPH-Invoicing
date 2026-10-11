import { describe, expect, it } from "vitest";
import {
  daysLeft, describeDaysLeft, dueObligations, expiryLevel, isObligationKind, isRealDay, obligationKey, type Obligation,
} from "./obligations";

const doc = (id: string, expiresOn: string, remindDays = 30): Obligation =>
  ({ id, kind: "MUNICIPAL_LICENCE", title: id, issuer: null, reference: null, holder: null, expiresOn, remindDays, note: null });

describe("obligations", () => {
  it("التاريخُ يُفحص: شكلُه ووجودُه", () => {
    expect(isRealDay("2026-02-28")).toBe(true);
    expect(isRealDay("2026-02-30")).toBe(false);
    expect(isRealDay("28-02-2026")).toBe(false);
    expect(isObligationKind("IQAMA")).toBe(true);
    expect(isObligationKind("PASSPORT")).toBe(false);
  });

  it("الأيّامُ الباقية تعبر الشهر والسنة", () => {
    expect(daysLeft("2027-01-02", "2026-12-30")).toBe(3);
    expect(daysLeft("2026-10-10", "2026-10-10")).toBe(0);
    expect(daysLeft("2026-10-09", "2026-10-10")).toBe(-1);
  });

  it("المستوى: انتهت · هذا الأسبوع · داخل مهلتها · سارية", () => {
    const today = "2026-10-10";
    expect(expiryLevel(doc("a", "2026-10-09"), today)).toBe("EXPIRED");
    expect(expiryLevel(doc("a", "2026-10-10"), today)).toBe("URGENT");
    expect(expiryLevel(doc("a", "2026-10-17"), today)).toBe("URGENT");
    expect(expiryLevel(doc("a", "2026-10-18"), today)).toBe("SOON");
    expect(expiryLevel(doc("a", "2026-11-09"), today)).toBe("SOON");
    expect(expiryLevel(doc("a", "2026-11-10"), today)).toBe("OK");
    /* المهلةُ تُكتب لكلّ وثيقة: عقدُ الإيجار قبل تسعين */
    expect(expiryLevel(doc("a", "2026-12-20", 90), today)).toBe("SOON");
  });

  it("ما حان تذكيرُه: المنتهي أوّلاً ثمّ الأقرب، والساري لا يظهر", () => {
    const due = dueObligations([doc("ok", "2027-06-01"), doc("soon", "2026-10-25"), doc("gone", "2026-09-01"), doc("week", "2026-10-12")], "2026-10-10");
    expect(due.map((d) => [d.id, d.level])).toEqual([["gone", "EXPIRED"], ["week", "URGENT"], ["soon", "SOON"]]);
  });

  it("المؤجَّلُ يصمت — والمنتهي لا يُسكَت", () => {
    const soon = doc("soon", "2026-10-25");
    const gone = doc("gone", "2026-09-01");
    const silenced = new Set([obligationKey(soon), obligationKey(gone)]);
    expect(dueObligations([soon, gone], "2026-10-10", silenced).map((d) => d.id)).toEqual(["gone"]);
  });

  it("التجديدُ يغيّر المفتاح فيعود التذكيرُ لموعده الجديد", () => {
    const before = doc("x", "2026-10-25");
    const after = { ...before, expiresOn: "2027-10-25" };
    expect(obligationKey(before)).not.toBe(obligationKey(after));
  });

  it("بلا وثائق لا شيء يُقال", () => {
    expect(dueObligations([], "2026-10-10")).toEqual([]);
  });

  it("الوصفُ بلا أرقامٍ سالبة", () => {
    expect(describeDaysLeft(0)).toBe("تنتهي اليوم");
    expect(describeDaysLeft(2)).toBe("بعد يومين");
    expect(describeDaysLeft(12)).toBe("بعد 12 يوماً");
    expect(describeDaysLeft(-3)).toBe("انتهت منذ 3 أيّام");
  });
});
