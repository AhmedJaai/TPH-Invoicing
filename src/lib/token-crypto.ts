/**
 * رمزُ الدرايف مشفَّراً في القاعدة (SEC-011).
 *
 * كان `accounts.refresh_token` نصّاً خامّاً بصلاحية الدرايف كلّه — فمن
 * قرأ القاعدة (كلُّ من يحمل `DATABASE_URL`) ملك درايف أحمد كاملاً، لا
 * الأرشيف وحده. فيُشفَّر بـAES-256-GCM بمفتاحٍ لا يسكن القاعدة.
 *
 * **والمفتاح متغيّرٌ مستقلّ** (`TOKEN_ENCRYPTION_KEY`) لا `AUTH_SECRET`:
 * النصوص المحلّية تقرأ الرمز نفسه، و`AUTH_SECRET` المحلّيّ غيرُ الإنتاج.
 * وبلا مفتاحٍ لا يتغيّر شيء — يُحفَظ كما كان — فلا ينكسر الدخول قبل ضبطه.
 * والرمز القديم الخامّ يُقرأ كما هو، ويُشفَّر في أوّل دخولٍ بعد ضبط المفتاح.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) return null;
  return createHash("sha256").update(raw).digest();
}

export function tokenEncryptionEnabled(): boolean {
  return key() !== null;
}

export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** يُشفِّر إن ضُبط المفتاح، ويُعيد النصّ كما هو إن لم يُضبط. */
export function sealToken(plain: string): string {
  const k = key();
  if (!k || isSealed(plain)) return plain;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

/** يفكّ المشفَّر، ويُعيد الخامّ القديم كما هو. */
export function openToken(stored: string): string {
  if (!isSealed(stored)) return stored;
  const k = key();
  if (!k) {
    throw new Error("رمز الدرايف مشفَّر و TOKEN_ENCRYPTION_KEY غير مضبوط في هذه البيئة — اضبطه بالقيمة نفسها التي في الإنتاج");
  }
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64url");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
