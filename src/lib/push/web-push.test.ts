import { describe, expect, it } from "vitest";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { isPushEndpoint, pushBriefText, pushConfig, pushOutcome, pushRequest, vapidJwt } from "./web-push";

/* زوجٌ بصيغة `npx web-push generate-vapid-keys`: النقطةُ غيرُ المضغوطة (٦٥ بايتاً) والسرُّ (٣٢) */
function vapidPair() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  return { pub: point.toString("base64url"), priv: jwk.d!, jwk };
}

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const NOW = new Date("2026-10-24T02:30:00Z");

describe("pushConfig — خاملٌ حتى يوجد المفتاحان", () => {
  it("بلا مفتاحين أو بأحدهما: لا إشعار", () => {
    const { pub, priv } = vapidPair();
    expect(pushConfig({})).toBeNull();
    expect(pushConfig({ VAPID_PUBLIC_KEY: pub, VAPID_SUBJECT: "mailto:a@b.c" })).toBeNull();
    expect(pushConfig({ VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: "mailto:a@b.c" })).toBeNull();
  });

  it("مفتاحٌ مقطوعٌ أو من زوجٍ آخر يُردّ هنا لا عند أوّل صباح", () => {
    const a = vapidPair();
    const b = vapidPair();
    expect(pushConfig({ VAPID_PUBLIC_KEY: a.pub.slice(0, 40), VAPID_PRIVATE_KEY: a.priv, VAPID_SUBJECT: "mailto:a@b.c" })).toBeNull();
    expect(pushConfig({ VAPID_PUBLIC_KEY: a.pub, VAPID_PRIVATE_KEY: b.priv, VAPID_SUBJECT: "mailto:a@b.c" })).toBeNull();
  });

  it("المرسِلُ من `VAPID_SUBJECT` أو عنوانِ الإنتاج، ولا يُقبل غيرُ mailto/https", () => {
    const { pub, priv } = vapidPair();
    expect(pushConfig({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VERCEL_PROJECT_PRODUCTION_URL: "tph.example.com" })?.subject).toBe("https://tph.example.com");
    expect(pushConfig({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv })).toBeNull();
    expect(pushConfig({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: "ahmed" })).toBeNull();
  });
});

describe("vapidJwt — توقيعٌ يتحقّق منه المزوّد بالمفتاح العامّ", () => {
  it("ES256 على أصل المزوّد، صالحٌ اثنتي عشرة ساعة", () => {
    const { pub, priv, jwk } = vapidPair();
    const config = pushConfig({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: "mailto:a@b.c" })!;
    const jwt = vapidJwt(ENDPOINT, config, NOW);
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: NOW.getTime() / 1000 + 43200, sub: "mailto:a@b.c" });
    const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("النداءُ فارغ: لا جسمَ يحمل رقماً، والمفتاحُ العامّ في الترويسة", () => {
    const { pub, priv } = vapidPair();
    const config = pushConfig({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: "mailto:a@b.c" })!;
    const init = pushRequest(ENDPOINT, config, NOW);
    const headers = init.headers as Record<string, string>;
    expect(init.body).toBeUndefined();
    expect(headers["Content-Length"]).toBe("0");
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${pub}$`));
    expect(headers.TTL).toBe("43200");
  });
});

describe("isPushEndpoint — لا يطرق الخادمُ إلّا مزوّدي الإشعار", () => {
  it("المعروفون يُقبلون", () => {
    for (const u of [ENDPOINT, "https://web.push.apple.com/QAbc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) {
      expect(isPushEndpoint(u)).toBe(true);
    }
  });
  it("ما سواهم يُردّ: عنوانٌ داخليّ، أو http، أو منفذ، أو مضيفٌ يتنكّر", () => {
    for (const u of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com:8443/x", "https://fcm.googleapis.com.evil.com/x", "https://evilpush.apple.com.attacker.io/", "not a url", "https://user@fcm.googleapis.com/x"]) {
      expect(isPushEndpoint(u)).toBe(false);
    }
  });
});

describe("pushOutcome", () => {
  it("٢٠١ وصل، و٤٠٤/٤١٠ انتهى الاشتراك، وغيرُهما تعذّر", () => {
    expect(pushOutcome(201)).toBe("sent");
    expect(pushOutcome(410)).toBe("gone");
    expect(pushOutcome(404)).toBe("gone");
    expect(pushOutcome(429)).toBe("failed");
    expect(pushOutcome(500)).toBe("failed");
  });
});

describe("pushBriefText — يظهر على شاشة القفل، فلا مبالغ فيه", () => {
  it("يقول ما ينتظر بالجملة التي على «اليوم»", () => {
    expect(pushBriefText({ knowsNothing: false, pending: 0, runReady: false }).body).toBe("لا شيء يحتاج قرارك اليوم.");
    expect(pushBriefText({ knowsNothing: false, pending: 5, runReady: true }).body).toBe("5 بنود بانتظار قرارك. ودفعة المورّدين جاهزة للتحويل.");
    expect(pushBriefText({ knowsNothing: true, pending: 0, runReady: false }).body).toContain("لم يقرأ");
  });
  it("لا رقمَ بالريال", () => {
    expect(pushBriefText({ knowsNothing: false, pending: 12, runReady: true }).body).not.toMatch(/ريال|SAR|\d+\.\d\d/);
  });
});
