import { beforeEach, describe, expect, it, vi } from "vitest";

/* الاشتراكُ في إشعار الصباح: بالحارس، وبطلبٍ مفحوص، وخاملٌ بلا مفاتيح — الخدمةُ مُحاكاة */
const guardMock = vi.fn();
vi.mock("@/services/guard", () => ({
  guard: (...a: unknown[]) => guardMock(...a),
  respondTo: (e: unknown) =>
    e instanceof Error && e.message === "forbidden" ? Response.json({ error: "x" }, { status: 403 }) : null,
}));
const saveMock = vi.fn();
const removeMock = vi.fn();
vi.mock("@/services/push.service", async () => {
  class PushUnavailableError extends Error {}
  return {
    PushUnavailableError,
    saveSubscription: (...a: unknown[]) => saveMock(...a),
    removeSubscription: (...a: unknown[]) => removeMock(...a),
  };
});

import { POST } from "./route";
import { PushUnavailableError } from "@/services/push.service";

const post = (body: unknown) => POST(new Request("http://localhost/api/push", {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": "iPhone Safari" },
  body: JSON.stringify(body),
}));
const sub = { endpoint: "https://web.push.apple.com/QAbc", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue({ id: "u1", role: "OWNER" });
  saveMock.mockReset().mockResolvedValue(undefined);
  removeMock.mockReset().mockResolvedValue(undefined);
});

describe("/api/push", () => {
  it("بصلاحية رؤية المبالغ — الإحاطةُ لمن يرى «اليوم»", async () => {
    await post({ action: "subscribe", subscription: sub });
    expect(guardMock).toHaveBeenCalledWith("push", "amounts:view");
  });

  it("من لا يملكها يُردّ ولا يُكتب شيء", async () => {
    guardMock.mockRejectedValue(new Error("forbidden"));
    expect((await post({ action: "subscribe", subscription: sub })).status).toBe(403);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("يحفظ الجهاز باسم صاحب الجلسة لا باسمٍ في الطلب", async () => {
    const res = await post({ action: "subscribe", subscription: sub, userId: "someone-else" });
    expect(res.status).toBe(200);
    expect(saveMock).toHaveBeenCalledWith("u1", { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, "iPhone Safari");
  });

  it("بلا مفاتيح على الخادم: ٤٠٩ بسببه", async () => {
    saveMock.mockRejectedValue(new PushUnavailableError("إشعار الصباح غير مفعّل على الخادم بعد."));
    const res = await post({ action: "subscribe", subscription: sub });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("غير مفعّل");
  });

  it("الإيقافُ يمحو جهازَ صاحبه وحده", async () => {
    await post({ action: "unsubscribe", endpoint: sub.endpoint });
    expect(removeMock).toHaveBeenCalledWith("u1", sub.endpoint);
  });

  it("الطلبُ المشوَّه يُردّ ٤٠٠", async () => {
    expect((await post({ action: "subscribe", subscription: { endpoint: "nope" } })).status).toBe(400);
    expect((await post({ action: "delete-all" })).status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
