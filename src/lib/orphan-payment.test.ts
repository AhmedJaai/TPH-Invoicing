import { describe, expect, it } from "vitest";
import { parseOrphanPaymentRequest } from "./orphan-payment";

describe("طلبُ حسم دفعةٍ بلا مورّد", () => {
  it("النسبةُ إلى مورّد", () => {
    const r = parseOrphanPaymentRequest({ action: "assign", paymentId: "p1", supplierId: "s1" });
    expect(r).toEqual({ ok: true, request: { action: "assign", paymentId: "p1", supplierId: "s1" } });
  });

  it("الإلغاءُ يطلب سبباً", () => {
    const r = parseOrphanPaymentRequest({ action: "void", paymentId: "p1", reason: " " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("اكتب");
  });

  it("الإلغاءُ بسببه", () => {
    const r = parseOrphanPaymentRequest({ action: "void", paymentId: "p1", reason: "أجرة سالم — ليست لمورّد" });
    expect(r.ok).toBe(true);
  });

  it("لا مبلغ يُقبَل من المتصفّح", () => {
    const r = parseOrphanPaymentRequest({ action: "assign", paymentId: "p1", supplierId: "s1", amountMinor: 100 });
    expect(r.ok).toBe(false);
  });

  it("فعلٌ غير معروف", () => {
    expect(parseOrphanPaymentRequest({ action: "delete", paymentId: "p1" }).ok).toBe(false);
  });
});
