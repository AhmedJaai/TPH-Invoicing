import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("./rate-limit.service", () => ({
  consume: vi.fn(),
  RateLimitedError: class RateLimitedError extends Error { retryAfterSeconds = 1; },
}));

import { answer, failWith, respondTo } from "./guard";
import { ForbiddenError } from "@/lib/permissions";
import { Conflict, DomainError, NotFound, Refused, Unreadable } from "@/lib/domain-error";
import { MonthClosedError } from "./validation.service";
import { AlreadyMatchedError, PaymentTwinError } from "./payment.service";
import { ImportNotRecordedError } from "./bank-import.service";

/**
 * خاتمةُ المسار: رسالتُنا تُقال بنصّها، وعطبُ الخادم لا يُعرَض نصُّه.
 */
describe("failWith", () => {
  it("رسالة كتبناها تبقى بنصّها و400", async () => {
    const res = failWith(new Error("الكمّيّة يجب أن تكون أكبر من صفر"), "inventory-waste");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "الكمّيّة يجب أن تكون أكبر من صفر" });
  });

  it("خطأ Drizzle لا يعرض استعلامه ولا قيمه", async () => {
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

  it("قيد القاعدة المعروف يبقى على ترجمته", () => {
    const e = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(failWith(e, "product").status).toBe(409);
  });

  it("وخطأ الصلاحيّة 403 لا 400", () => {
    expect(failWith(new ForbiddenError("recipe:edit"), "inventory-recipe").status).toBe(403);
  });
});

/**
 * أخطاءُ العمل تُترجَم في موضعٍ واحد — والشكلُ والرمز هما ما كانت المسارات تكتبه
 * بيدها، فالشاشاتُ (`http-client.ts`) تقرأ `error` كما كانت.
 */
describe("respondTo: أخطاءُ العمل", () => {
  const read = async (e: unknown) => {
    const res = respondTo(e);
    if (!res) throw new Error("لم يُترجَم");
    return { status: res.status, body: await res.json() };
  };

  it("كلُّ صنفٍ برمزه ونصّه", async () => {
    expect(await read(new Refused("حدّد الحركة"))).toEqual({ status: 400, body: { error: "حدّد الحركة" } });
    expect(await read(new NotFound("هذه الحركة غير موجودة"))).toEqual({ status: 404, body: { error: "هذه الحركة غير موجودة" } });
    expect(await read(new Conflict("سُجّل من قبل"))).toEqual({ status: 409, body: { error: "سُجّل من قبل" } });
  });

  it("والحمولةُ بجانب `error` — كشفٌ مصوَّر يقول مصدره", async () => {
    expect(await read(new Unreadable("الكشف مصوَّر", { source: "PDF_VISION" })))
      .toEqual({ status: 422, body: { error: "الكشف مصوَّر", source: "PDF_VISION" } });
  });

  it("أخطاءُ المال المعروفة ما زالت ٤٠٩ بنصّها", async () => {
    const month = new MonthClosedError("2026-08");
    expect(await read(month)).toEqual({ status: 409, body: { error: month.message } });
    expect(await read(new AlreadyMatchedError())).toEqual({ status: 409, body: { error: new AlreadyMatchedError().message } });
    const twin = new PaymentTwinError({ id: "p", documentId: null, hasBankRow: false, allocatedMinor: 0 });
    expect(await read(twin)).toEqual({ status: 409, body: { error: twin.message } });
    expect(twin.status).toBe(409);
  });

  it("وصفُّ الاستيراد الذي لم يُكتب ٥٠٠ بنصّه كما كان", async () => {
    expect(await read(new ImportNotRecordedError())).toEqual({ status: 500, body: { error: "تعذّر تسجيل الاستيراد. حاول مرة أخرى." } });
  });

  it("والصنفُ يبقى خطأً يُعرَف باسمه", () => {
    const e = new Conflict("x");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(DomainError);
    expect(e.name).toBe("Conflict");
    expect(new MonthClosedError("2026-08").name).toBe("MonthClosedError");
  });
});

describe("answer", () => {
  it("النجاحُ ٢٠٠ بجسمه", async () => {
    const res = await answer(async () => ({ ok: true, message: "حُفظ" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "حُفظ" });
  });

  it("والرفضُ المعروف برمزه", async () => {
    const res = await answer(async () => { throw new NotFound("هذه الحركة غير موجودة"); });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "هذه الحركة غير موجودة" });
  });

  it("وما لا يُعرَف يُرمى كما كان — لا يُبدَّل برسالة", async () => {
    const boom = new Error("connection reset");
    await expect(answer(async () => { throw boom; })).rejects.toBe(boom);
  });
});
