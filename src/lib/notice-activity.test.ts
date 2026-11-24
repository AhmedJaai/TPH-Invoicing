import { describe, expect, it } from "vitest";
import { activityTarget, isOwnActivity } from "./notice-activity";

const id = "5bcf41bb-9b82-4721-baf6-76b5441d5420";

describe("إشعارُ فعلٍ في السجلّ", () => {
  it("فعلُ القارئ بيده لا يُشعَر به، وفعلُ غيره والنظامِ يُشعَر به", () => {
    expect(isOwnActivity("u1", "u1", false)).toBe(true);
    expect(isOwnActivity("u2", "u1", false)).toBe(false);
    expect(isOwnActivity("u1", "u1", true)).toBe(false);
    expect(isOwnActivity(null, "u1", false)).toBe(false);
  });

  it("يفتح ما وقع عليه ويسمّيه", () => {
    expect(activityTarget("invoice", id).href).toBe(`/purchases/invoices/${id}`);
    expect(activityTarget("bank_transaction", id).href).toBe(`/bank/tx/${id}`);
    expect(activityTarget("employee", id).href).toBe(`/payroll/employee/${id}`);
    expect(activityTarget("month_close", "2026-07")).toEqual({ label: "يوليو 2026", href: "/close" });
  });

  it("ما لا موضع له يفتح السجلّ — ولا يُبنى رابطٌ من معرّفٍ ليس معرّفاً", () => {
    expect(activityTarget("invoice", "INV-12").href).toBe("/settings/audit");
    expect(activityTarget("bank_rule", id).href).toBe("/settings/audit");
  });
});
