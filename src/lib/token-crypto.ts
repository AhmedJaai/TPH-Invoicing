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
 *
 * **وفي الإنتاج غيابُه عطبٌ يُقال** (`/api/health` للمخوَّل): كان يسقط التشفيرُ بصمت.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/*
  صيغتان تُقرآن، وواحدةٌ تُكتب:

    enc:v1:<iv|tag|data>          المفتاحُ sha256(السرّ) — ما خُتم قبل أكتوبر ٢٠٢٦، يُقرأ ولا يُكتب.
    enc:v2:<kid>:<iv|tag|data>    المفتاحُ HKDF(السرّ) بسياقٍ ثابت، و`kid` يقول بأيّ سرٍّ خُتم.

  كانت البادئة تحمل إصدارَ الصيغة لا معرّفَ المفتاح: فتدويرُ السرّ يكسر كلَّ الرموز
  دفعةً ولا يُعرف أيُّها خُتم بأيّهما. فالتدويرُ الآن خطوتان بلا انقطاع: انقل القديم
  إلى `TOKEN_ENCRYPTION_KEY_PREVIOUS` وضَع الجديد في `TOKEN_ENCRYPTION_KEY` — ما خُتم
  بالقديم يُقرأ به، وكلُّ دخولٍ (أو `scripts/reseal-drive-tokens.ts`) يختم بالجديد.
*/
const PREFIX_V1 = "enc:v1:";
const PREFIX_V2 = "enc:v2:";
const HKDF_INFO = "tph-invoicing/drive-refresh-token/v2";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_SECRET_CHARS = 32;

interface Secret { v1: Buffer; v2: Buffer; kid: string }

function derive(raw: string | undefined): Secret | null {
  if (!raw || raw.length < MIN_SECRET_CHARS) return null;
  const v1 = createHash("sha256").update(raw).digest();
  const v2 = Buffer.from(hkdfSync("sha256", raw, Buffer.alloc(0), HKDF_INFO, 32));
  /* معرّفٌ لا يكشف السرّ: بصمةُ بصمته، ثمانيةُ محارف */
  const kid = createHash("sha256").update("kid:").update(v1).digest("hex").slice(0, 8);
  return { v1, v2, kid };
}

function current(): Secret | null {
  return derive(process.env.TOKEN_ENCRYPTION_KEY);
}

/** السرُّ الجاري ثمّ السابق — للقراءة وحدها. */
function readable(): Secret[] {
  return [current(), derive(process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS)].filter((k): k is Secret => k !== null);
}

export function tokenEncryptionEnabled(): boolean {
  return current() !== null;
}

export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX_V1) || stored.startsWith(PREFIX_V2);
}

/**
 * مختومٌ بالسرّ الجاري وبالصيغة الجارية — وما عداه (خامٌّ، أو v1، أو بسرٍّ سابق)
 * «يحتاج ختماً». بلا مفتاحٍ لا يُسأل: لا ختمَ يُطلب ممّن لا يملك ما يختم به.
 */
export function sealedWithCurrentKey(stored: string): boolean {
  const k = current();
  return k !== null && stored.startsWith(`${PREFIX_V2}${k.kid}:`);
}

/** يُشفِّر إن ضُبط المفتاح، ويُعيد النصّ كما هو إن لم يُضبط. */
export function sealToken(plain: string): string {
  const k = current();
  if (!k || isSealed(plain)) return plain;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k.v2, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX_V2}${k.kid}:` + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

function decrypt(key: Buffer, payload: string): string {
  const buf = Buffer.from(payload, "base64url");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** يفكّ المشفَّر (بالسرّ الجاري أو السابق)، ويُعيد الخامّ القديم كما هو. */
export function openToken(stored: string): string {
  if (!isSealed(stored)) return stored;
  const keys = readable();
  if (keys.length === 0) {
    throw new Error("رمز الدرايف مشفَّر و TOKEN_ENCRYPTION_KEY غير مضبوط في هذه البيئة — اضبطه بالقيمة نفسها التي في الإنتاج");
  }
  if (stored.startsWith(PREFIX_V2)) {
    const rest = stored.slice(PREFIX_V2.length);
    const cut = rest.indexOf(":");
    const kid = rest.slice(0, cut);
    const k = keys.find((x) => x.kid === kid);
    if (cut < 0 || !k) {
      throw new Error("رمز الدرايف مختومٌ بمفتاحٍ غير المضبوط هنا — إن دُوِّر المفتاح فضَع السابق في TOKEN_ENCRYPTION_KEY_PREVIOUS، أو سجّل الخروج ثمّ الدخول");
    }
    return decrypt(k.v2, rest.slice(cut + 1));
  }
  /* v1 بلا معرّف مفتاح: يُجرَّب الجاري ثمّ السابق، والوسمُ (GCM) يفصل بينهما */
  let last: unknown;
  for (const k of keys) {
    try { return decrypt(k.v1, stored.slice(PREFIX_V1.length)); } catch (e) { last = e; }
  }
  throw last;
}

/** يُعيد الختم بالسرّ الجاري وصيغته — للنصّ الذي يُصلح القائم، ولا يمسّ ما خُتم به أصلاً. */
export function resealToken(stored: string): string {
  if (sealedWithCurrentKey(stored) || !tokenEncryptionEnabled()) return stored;
  return sealToken(openToken(stored));
}
