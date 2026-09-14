import { afterEach, describe, expect, it } from "vitest";
import { isSealed, openToken, sealToken, tokenEncryptionEnabled } from "./token-crypto";

const KEY = "k".repeat(40);

afterEach(() => { delete process.env.TOKEN_ENCRYPTION_KEY; });

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
});
