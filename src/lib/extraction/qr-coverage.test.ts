import { describe, expect, it } from "vitest";
import { checkedCount, isStoredQrStatus, qrCoverage } from "./qr-coverage";

describe("تغطية رمز QR لفواتير مورّد", () => {
  it("يعدّ كلَّ حالٍ في بابها، والمرحلةُ الثانية من ذوات الرمز", () => {
    const c = qrCoverage([
      { status: "FOUND", phase2: true }, { status: "FOUND", phase2: false },
      { status: "NONE", phase2: false }, { status: "NOT_ZATCA", phase2: false },
      { status: "SKIPPED", phase2: false }, { status: null, phase2: false },
    ]);
    expect(c).toEqual({ invoices: 6, withQr: 2, phase2: 1, withoutQr: 1, foreignQr: 1, unchecked: 2 });
    expect(checkedCount(c)).toBe(4);
  });

  it("ما لا دليلَ محفوظاً له «لم يُفحص» لا «بلا رمز»", () => {
    const c = qrCoverage([{ status: null, phase2: false }, { status: null, phase2: false }]);
    expect(c.withoutQr).toBe(0);
    expect(c.unchecked).toBe(2);
    expect(checkedCount(c)).toBe(0);
  });

  it("حالٌ غير معروفة من القاعدة لا تُقبل", () => {
    expect(isStoredQrStatus("FOUND")).toBe(true);
    expect(isStoredQrStatus("found")).toBe(false);
    expect(isStoredQrStatus(null)).toBe(false);
  });
});
