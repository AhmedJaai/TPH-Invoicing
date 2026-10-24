import { describe, expect, it } from "vitest";
import {
  isStagingUrl, MAX_STAGED_BYTES, STAGED_TYPES, stagingPathname, stagingTokenDecision, storeIdOf,
} from "./blob-staging-policy";

/**
 * المحطّةُ المؤقّتة للملفّ الكبير: الخادمُ لا يجلب إلّا من مخزننا وتحت `staging/`،
 * ولا يأذن برفع إلّا PDF أو صورة وبحدٍّ يُفرض على الإذن نفسه.
 */
describe("رابط المحطّة", () => {
  const store = storeIdOf("vercel_blob_rw_AbC123xyz_secretPart");

  it("معرّفُ المخزن من مفتاحه — وغيابُ المفتاح لا معرّف", () => {
    expect(store).toBe("abc123xyz");
    expect(storeIdOf(undefined)).toBeNull();
    expect(storeIdOf("not-a-token")).toBeNull();
  });

  it("رابطُ مخزننا تحت staging/ مقبول", () => {
    expect(isStagingUrl("https://abc123xyz.private.blob.vercel-storage.com/staging/inv-aB9.pdf", store)).toBe(true);
  });

  it("مخزنٌ آخر، أو خارج staging/، أو غير https، أو موقعٌ آخر — مرفوض", () => {
    expect(isStagingUrl("https://other1.private.blob.vercel-storage.com/staging/x.pdf", store)).toBe(false);
    expect(isStagingUrl("https://abc123xyz.private.blob.vercel-storage.com/archive/x.pdf", store)).toBe(false);
    expect(isStagingUrl("http://abc123xyz.private.blob.vercel-storage.com/staging/x.pdf", store)).toBe(false);
    expect(isStagingUrl("https://evil.example.com/staging/x.pdf", store)).toBe(false);
    expect(isStagingUrl("https://abc123xyz.private.blob.vercel-storage.com.evil.com/staging/x.pdf", store)).toBe(false);
    expect(isStagingUrl("https://u:p@abc123xyz.private.blob.vercel-storage.com/staging/x.pdf", store)).toBe(false);
    expect(isStagingUrl("https://abc123xyz.private.blob.vercel-storage.com:8443/staging/x.pdf", store)).toBe(false);
    expect(isStagingUrl("not a url", store)).toBe(false);
  });
});

describe("إذنُ الرفع", () => {
  it("PDF تحت staging/ يُؤذن له بحدّ ٢٥ ميجابايت وأنواع PDF والصور وحدها", () => {
    const d = stagingTokenDecision("staging/فاتورة.pdf", "application/pdf");
    expect(d).toEqual({ ok: true, allowedContentTypes: [...STAGED_TYPES], maximumSizeInBytes: 25 * 1024 * 1024 });
    expect(MAX_STAGED_BYTES).toBe(25 * 1024 * 1024);
  });

  it("نوعٌ غير PDF ولا صورة يُردّ", () => {
    const d = stagingTokenDecision("staging/x.html", "text/html");
    expect(d.ok).toBe(false);
  });

  it("اسمٌ خارج staging/ أو بمجلّدٍ أو صعودٍ يُردّ", () => {
    expect(stagingTokenDecision("archive/x.pdf", "application/pdf").ok).toBe(false);
    expect(stagingTokenDecision("staging/a/b.pdf", "application/pdf").ok).toBe(false);
    expect(stagingTokenDecision("staging/..", "application/pdf").ok).toBe(false);
  });

  it("نوعٌ لم يُعلَن يُترك لقائمة الإذن نفسها", () => {
    expect(stagingTokenDecision("staging/x.heic", null).ok).toBe(true);
  });

  it("اسمُ الملفّ يصير اسماً واحداً تحت staging/ بلا مجلّدات", () => {
    expect(stagingPathname("a/b\\c.pdf")).toBe("staging/a_b_c.pdf");
    expect(stagingPathname("")).toBe("staging/file");
    /* اسمٌ يبدأ بنقطتين يُنظَّف لا يُردّ — فلا يُحرَم صاحبُه الرفع */
    expect(stagingPathname("../../x.pdf")).toBe("staging/____x.pdf");
    expect(stagingTokenDecision(stagingPathname("../../x.pdf"), "application/pdf").ok).toBe(true);
  });
});
