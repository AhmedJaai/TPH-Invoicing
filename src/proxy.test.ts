import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

/**
 * حارسُ الطلب الكاتب: من موقعٍ آخر يُردّ، ومن الصفحة نفسها يمرّ — وصاحبُ
 * الجلسة لا يُحبَس خارج تطبيقه.
 */
const SESSION = "authjs.session-token=abc";

function post(headers: Record<string, string>, path = "/api/payments") {
  return new NextRequest(`https://app.example.com${path}`, { method: "POST", headers });
}

describe("الطلب الكاتب على /api", () => {
  it("من الصفحة نفسها يمرّ", () => {
    const res = proxy(post({
      cookie: SESSION, origin: "https://app.example.com", "sec-fetch-site": "same-origin", "content-type": "application/json",
    }));
    expect(res.status).toBe(200);
  });

  it("متصفّح بلا Sec-Fetch-Site يمرّ بأصله الصحيح", () => {
    const res = proxy(post({ cookie: SESSION, origin: "https://app.example.com", "content-type": "application/json" }));
    expect(res.status).toBe(200);
  });

  it("من أصل آخر يردّ", () => {
    const res = proxy(post({ cookie: SESSION, origin: "https://evil.example", "content-type": "application/json" }));
    expect(res.status).toBe(403);
  });

  it("«cross-site» يردّ ولو غاب Origin", () => {
    const res = proxy(post({ cookie: SESSION, "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
  });

  it("بكعكة جلسة ولا يعرف مصدره يردّ", () => {
    const res = proxy(post({ cookie: SESSION, "content-type": "application/json" }));
    expect(res.status).toBe(403);
  });

  it("بلا كعكة ولا مصدر (نصّ محلّيّ) يبلغ فحص الدخول لا فحص المصدر", () => {
    const res = proxy(post({ "content-type": "application/json" }));
    expect(res.status).toBe(401);
  });

  it("مسارات Auth.js لا يمسّها هذا الحارس", () => {
    const res = proxy(post({ cookie: SESSION }, "/api/auth/signout"));
    expect(res.status).toBe(200);
  });

  it("والقراءة لا يسأل عن مصدرها", () => {
    const res = proxy(new NextRequest("https://app.example.com/api/search?q=x", { headers: { cookie: SESSION } }));
    expect(res.status).toBe(200);
  });
});

describe("رابطُ تصوير الباريستا", () => {
  it("صفحتُه وإرسالُه بلا جلسة — الرمزُ إذنُه ويفحصه المسار", () => {
    expect(proxy(new NextRequest("https://app.example.com/c/abcdefghijklmnopqrstuvwxyz12")).status).toBe(200);
    const send = proxy(post({ origin: "https://app.example.com", "content-type": "multipart/form-data; boundary=x" }, "/api/capture/scan/submit"));
    expect(send.status).toBe(200);
  });

  it("ولا يفتح ما سواه: ملفُّ الصورة ورفضُها يحتاجان جلسة", () => {
    expect(proxy(new NextRequest("https://app.example.com/api/capture/file?id=x")).status).toBe(401);
    expect(proxy(post({ origin: "https://app.example.com", "content-type": "application/json" }, "/api/capture/decide")).status).toBe(401);
  });

  it("والإرسالُ من موقعٍ آخر يُردّ ولو بلا جلسة", () => {
    expect(proxy(post({ origin: "https://evil.example", "content-type": "multipart/form-data; boundary=x" }, "/api/capture/scan/submit")).status).toBe(403);
  });
});

describe("الخروج يمسح خزين المتصفّح", () => {
  it("صفحة الدخول تحمل Clear-Site-Data، وصفحات التطبيق لا تحملها", () => {
    const login = proxy(new NextRequest("https://app.example.com/login"));
    expect(login.headers.get("clear-site-data")).toBe('"cache"');
    const inside = proxy(new NextRequest("https://app.example.com/suppliers", { headers: { cookie: SESSION } }));
    expect(inside.headers.get("clear-site-data")).toBeNull();
  });
});

