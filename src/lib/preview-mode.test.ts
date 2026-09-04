import { describe, expect, it } from "vitest";
import { isProductionEnv, previewAllowed, refusalReason } from "./preview-mode";

describe("previewAllowed", () => {
  it("مغلق ما لم يُطلب صراحةً", () => {
    expect(previewAllowed({})).toBe(false);
    expect(previewAllowed({ AUTH_BYPASS: "false" })).toBe(false);
    expect(previewAllowed({ AUTH_BYPASS: "1" })).toBe(false);
    expect(previewAllowed({ AUTH_BYPASS: "TRUE" })).toBe(false);
  });

  it("يعمل في التطوير حين يُطلب", () => {
    expect(previewAllowed({ AUTH_BYPASS: "true", NODE_ENV: "development" })).toBe(true);
  });

  it("لا يعمل في إنتاج Vercel ولو فُعِّل المتغيّر", () => {
    expect(
      previewAllowed({ AUTH_BYPASS: "true", VERCEL_ENV: "production", NODE_ENV: "production" }),
    ).toBe(false);
  });

  it("لا يعمل في بناء إنتاجيّ خارج Vercel", () => {
    expect(previewAllowed({ AUTH_BYPASS: "true", NODE_ENV: "production" })).toBe(false);
  });

  it("يعمل في بيئة معاينة Vercel — وهي ليست إنتاجاً", () => {
    // نُبقيها ممكنة عمداً: بيئة المعاينة موضع التجربة
    expect(previewAllowed({ AUTH_BYPASS: "true", VERCEL_ENV: "preview", NODE_ENV: "development" }))
      .toBe(true);
  });

  it("بناء إنتاجيّ في بيئة معاينة يبقى مرفوضاً", () => {
    expect(previewAllowed({ AUTH_BYPASS: "true", VERCEL_ENV: "preview", NODE_ENV: "production" }))
      .toBe(false);
  });
});

describe("isProductionEnv", () => {
  it("تكفي إحدى العلامتين", () => {
    expect(isProductionEnv({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("refusalReason", () => {
  it("تسكت حين لا يُطلب التخطّي", () => {
    expect(refusalReason({})).toBeNull();
    expect(refusalReason({ AUTH_BYPASS: "false", NODE_ENV: "production" })).toBeNull();
  });

  it("تُبيّن السبب حين يُطلب ويُرفض", () => {
    expect(refusalReason({ AUTH_BYPASS: "true", VERCEL_ENV: "production" })).toContain("إنتاج");
    expect(refusalReason({ AUTH_BYPASS: "true", NODE_ENV: "production" })).toContain("إنتاجيّ");
  });

  it("تسكت حين يُطلب ويُسمح", () => {
    expect(refusalReason({ AUTH_BYPASS: "true", NODE_ENV: "development" })).toBeNull();
  });
});
