import { describe, expect, it } from "vitest";
import { driveWritesAllowed } from "./drive-readonly";

describe("الكتابة على الدرايف", () => {
  it("تُسمح في إنتاج Vercel", () => {
    expect(driveWritesAllowed({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("تُمنع في معاينة Vercel — والأرشيف لا نسخةَ له", () => {
    expect(driveWritesAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
  });

  it("تُمنع في التطوير ما لم تُطلَب صراحةً", () => {
    expect(driveWritesAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(driveWritesAllowed({ NODE_ENV: "development", DRIVE_ALLOW_WRITE: "true" })).toBe(true);
  });

  it("لا يكفي بناءٌ إنتاجيّ داخل معاينة Vercel", () => {
    // `NODE_ENV=production` صحيحٌ في المعاينة أيضاً — فلا يُقرأ وحده
    expect(driveWritesAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production", DRIVE_ALLOW_WRITE: "false" })).toBe(false);
  });
});
