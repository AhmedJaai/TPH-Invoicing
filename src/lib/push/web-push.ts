/**
 * إشعارُ الصباح (Web Push) — توقيعُ VAPID بـ`node:crypto` وحده، **وبلا محتوى**.
 *
 * - **خاملٌ بلا مفتاحين:** `pushConfig` يردّ `null` ما لم يوجد `VAPID_PUBLIC_KEY`
 *   و`VAPID_PRIVATE_KEY` صالحين (`npx web-push generate-vapid-keys`) — فلا زرَّ يُعرض
 *   ولا اشتراكَ يُكتب ولا نداء.
 * - **بلا محتوى:** الإشعارُ نداءٌ فارغ، وعاملُ الخدمة يسأل الخادمَ بجلسة صاحبه عن
 *   نصّه (`/api/push/brief`). فلا يمرّ رقمٌ بخوادم جوجل وأبل، ولا يلزم تشفيرُ المحتوى
 *   (RFC 8291) — والتوقيعُ (RFC 8292) وحده يكفي، فلا حزمةَ تُضاف.
 * - **إلى مزوّدي الإشعار المعروفين وحدهم:** العنوانُ يأتي من المتصفّح، والخادمُ يرسل
 *   إليه — فلا يُقبل إلّا مضيفٌ معروف، وإلّا صار الخادمُ يطرق أيَّ عنوانٍ يُعطاه.
 */
import { createECDH, createPrivateKey, sign, type KeyObject } from "node:crypto";
import { ITEM, countNoun } from "@/lib/arabic";

export interface PushConfig {
  publicKey: string;
  key: KeyObject;
  /** `mailto:` أو `https:` — يطلبه مزوّدُ أبل ليعرف من يراسله. */
  subject: string;
}

/** `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` (اختياريّ) · `VERCEL_PROJECT_PRODUCTION_URL`. */
type PushEnv = Readonly<Record<string, string | undefined>>;

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
const b64url = (b: Buffer | Uint8Array | string) => Buffer.from(b).toString("base64url");

/** المفتاحان صالحان أو لا إشعار — مفتاحٌ مقطوعٌ في اللصق يُردّ هنا لا عند أوّل صباح. */
export function pushConfig(env: PushEnv): PushConfig | null {
  const pub = env.VAPID_PUBLIC_KEY?.trim();
  const priv = env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return null;
  const point = fromB64url(pub);
  const d = fromB64url(priv);
  if (point.length !== 65 || point[0] !== 0x04 || d.length !== 32) return null;
  const subject = env.VAPID_SUBJECT?.trim()
    || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  try {
    /* السرُّ يشتقّ نقطتَه — وإن لم تطابق المعلنةَ فالزوجان من توليدين مختلفين */
    const derived = createECDH("prime256v1");
    derived.setPrivateKey(d);
    if (!derived.getPublicKey().equals(point)) return null;
    const key = createPrivateKey({
      key: { kty: "EC", crv: "P-256", d: b64url(d), x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)) },
      format: "jwk",
    });
    return { publicKey: pub, key, subject };
  } catch {
    /* سرٌّ خارج المنحنى */
    return null;
  }
}

/** مزوّدو الإشعار في المتصفّحات — وما سواهم يُردّ عند الاشتراك. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];

export function isPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.port && !url.username && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

/** رمزُ VAPID (ES256) لمزوّدٍ بعينه — صالحٌ اثنتي عشرة ساعة. */
export function vapidJwt(endpoint: string, config: PushConfig, now: Date): string {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
    sub: config.subject,
  }));
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input), { key: config.key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

/** النداءُ الفارغ — يبقى في المزوّد اثنتي عشرة ساعة، وإحاطةٌ أحدث تحلّ محلّ أقدم لم تصل. */
export function pushRequest(endpoint: string, config: PushConfig, now: Date): RequestInit {
  return {
    method: "POST",
    headers: {
      TTL: String(12 * 3600),
      Urgency: "normal",
      Topic: "morning-brief",
      "Content-Length": "0",
      Authorization: `vapid t=${vapidJwt(endpoint, config, now)}, k=${config.publicKey}`,
    },
  };
}

/** ما يعنيه ردُّ المزوّد: وصل · انتهى الاشتراك (يُمحى) · تعذّر (يُعاد غداً). */
export function pushOutcome(status: number): "sent" | "gone" | "failed" {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  return "failed";
}

/**
 * نصُّ الإشعار — **بلا مبالغ**: يظهر على شاشة القفل، ويراه من يمسك الجوّال.
 * فيقول ما ينتظر ويدعو إلى «اليوم»؛ والأرقامُ هناك بعد الدخول.
 */
export function pushBriefText(f: { knowsNothing: boolean; pending: number; runReady: boolean }): { title: string; body: string } {
  const title = "إحاطة الصباح";
  if (f.knowsNothing) return { title, body: "لم يقرأ النظام بعد أي مستند أو كشف. افتح التطبيق لتبدأ." };
  const parts = [
    /* الجملةُ نفسُها التي على «اليوم» */
    f.pending === 0 ? "لا شيء يحتاج قرارك اليوم." : `${countNoun(f.pending, ITEM)} بانتظار قرارك.`,
    f.runReady ? "ودفعة المورّدين جاهزة للتحويل." : null,
  ];
  return { title, body: parts.filter(Boolean).join(" ") };
}
