import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("./rate-limit.service", () => ({
  consume: vi.fn(),
  RateLimitedError: class RateLimitedError extends Error { retryAfterSeconds = 1; },
}));
vi.mock("./validation.service", () => ({ MonthClosedError: class MonthClosedError extends Error {} }));
vi.mock("./payment.service", () => ({
  AlreadyMatchedError: class AlreadyMatchedError extends Error {},
  PaymentTwinError: class PaymentTwinError extends Error {},
}));

import { failWith } from "./guard";
import { ForbiddenError } from "@/lib/permissions";

/**
 * خاتمةُ المسار: رسالتُنا تُقال بنصّها، وعطبُ الخادم لا يُعرَض نصُّه.
 */
describe("failWith", () => {
  it("رسالةٌ كتبناها تبقى بنصّها و400", async () => {
    const res = failWith(new Error("الكمّيّة يجب أن تكون أكبر من صفر"), "inventory-waste");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "الكمّيّة يجب أن تكون أكبر من صفر" });
  });

  it("خطأ Drizzle لا يُعرَض استعلامُه ولا قيمُه", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const e = new Error('Failed query: select "id" from "inventory_items" where "id" = $1\nparams: سرّ,abc');
    const res = failWith(e, "inventory-item");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("select");
    expect(body.error).not.toContain("سرّ");
    expect(body.error).toContain(body.ref);
  });

  it("خطأ الشبكة والقاعدة (بالإنجليزيّة، باسم المضيف) ٥٠٠ برقم مرجع", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = failWith(new Error("getaddrinfo ENOTFOUND ep-x-pooler.us-east-2.aws.neon.tech"), "product");
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toContain("neon");
  });

  it("قيدُ القاعدة المعروف يبقى على ترجمته", () => {
    const e = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(failWith(e, "product").status).toBe(409);
  });

  it("وخطأ الصلاحيّة 403 لا 400", () => {
    expect(failWith(new ForbiddenError("recipe:edit"), "inventory-recipe").status).toBe(403);
  });
});
