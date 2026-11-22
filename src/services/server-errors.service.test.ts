import { describe, expect, it } from "vitest";
import { errorFingerprint } from "./server-errors.service";

describe("مفتاح عطب الخادم", () => {
  const base = { source: "ROUTE" as const, route: "/api/archive", name: "TypeError", code: undefined, message: "Cannot read 'total' of undefined" };

  it("العطبُ نفسُه بمعرّفٍ أو رقمٍ آخر صفٌّ واحد", () => {
    expect(errorFingerprint({ ...base, message: "invoice 1234 not found (a1b2c3d4-0000-1111-2222-333344445555)" }))
      .toBe(errorFingerprint({ ...base, message: "invoice 98 not found (ffffffff-9999-8888-7777-666655554444)" }));
  });

  it("مسارٌ آخر أو نوعٌ آخر عطبٌ آخر", () => {
    expect(errorFingerprint(base)).not.toBe(errorFingerprint({ ...base, route: "/api/analyze" }));
    expect(errorFingerprint(base)).not.toBe(errorFingerprint({ ...base, name: "RangeError" }));
    expect(errorFingerprint(base)).not.toBe(errorFingerprint({ ...base, source: "REQUEST" }));
  });
});
