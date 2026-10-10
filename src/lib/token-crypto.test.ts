import { afterEach, describe, expect, it } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { isSealed, openToken, resealToken, sealedWithCurrentKey, sealToken, tokenEncryptionEnabled } from "./token-crypto";

const KEY = "k".repeat(40);

afterEach(() => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
  delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
});

/** ما كان يُكتب قبل v2: `enc:v1:` بمفتاح sha256(السرّ) — يُبنى هنا بيدٍ ليُثبَت أنّه ما زال يُقرأ. */
function sealV1(plain: string, secret: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "enc:v1:" + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

describe("رمز الدرايف في القاعدة", () => {
  it("بلا مفتاح: يُحفَظ كما هو ويُقرأ كما هو — لا ينكسر الدخول قبل ضبطه", () => {
    expect(tokenEncryptionEnabled()).toBe(false);
    expect(sealToken("1//abc")).toBe("1//abc");
    expect(openToken("1//abc")).toBe("1//abc");
  });

  it("بالمفتاح: يُشفَّر فلا يُقرأ من القاعدة، ويُفكّ إلى أصله", () => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    const sealed = sealToken("1//secret-refresh-token");
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("secret");
    expect(openToken(sealed)).toBe("1//secret-refresh-token");
  });

  it("والتشفير لا يتكرّر على المشفَّر، والخامّ القديم يُقرأ", () => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    const sealed = sealToken("1//x");
    expect(sealToken(sealed)).toBe(sealed);
    expect(openToken("1//legacy")).toBe("1//legacy");
  });

  it("المشفَّر بلا مفتاح يُعلَن ولا يُرسَل إلى جوجل مشفَّراً", () => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    const sealed = sealToken("1//x");
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => openToken(sealed)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("والعبث بالمشفَّر يُكشَف", () => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    const sealed = sealToken("1//x");
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(() => openToken(tampered)).toThrow();
  });

  it("ما خُتم بالصيغة الأولى يُقرأ كما كان — لا ينقطع الدرايف بالترقية", () => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    const old = sealV1("1//old-token", KEY);
    expect(isSealed(old)).toBe(true);
    expect(openToken(old)).toBe("1//old-token");
    expect(sealedWithCurrentKey(old)).toBe(false);
    const fresh = resealToken(old);
    expect(fresh.startsWith("enc:v2:")).toBe(true);
    expect(openToken(fresh)).toBe("1//old-token");
    expect(resealToken(fresh)).toBe(fresh);
  });

  it("تدويرُ المفتاح: ما خُتم بالسابق يُقرأ بـTOKEN_ENCRYPTION_KEY_PREVIOUS ويُعاد ختمُه بالجديد", () => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    const v2 = sealToken("1//rotating");
    const v1 = sealV1("1//rotating-v1", KEY);

    process.env.TOKEN_ENCRYPTION_KEY = "n".repeat(40);
    /* بلا السابق: يُعلَن ولا يُفكّ خطأً */
    expect(() => openToken(v2)).toThrow(/TOKEN_ENCRYPTION_KEY_PREVIOUS/);
    expect(() => openToken(v1)).toThrow();

    process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
    expect(openToken(v2)).toBe("1//rotating");
    expect(openToken(v1)).toBe("1//rotating-v1");
    expect(sealedWithCurrentKey(v2)).toBe(false);
    const moved = resealToken(v2);
    expect(sealedWithCurrentKey(moved)).toBe(true);

    /* وبعد إعادة الختم يُستغنى عن السابق */
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    expect(openToken(moved)).toBe("1//rotating");
  });

  it("بلا مفتاح: إعادةُ الختم لا تغيّر شيئاً", () => {
    expect(resealToken("1//raw")).toBe("1//raw");
  });
});
