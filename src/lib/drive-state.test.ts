import { describe, expect, it } from "vitest";
import { driveState } from "./drive-state";

const t = (iso: string) => new Date(iso);

describe("driveState", () => {
  it("وضعُ التجربة يغلب كلَّ شيء — لا تفويضَ فيه عمداً", () => {
    expect(driveState({ previewMode: true, connected: null, checkedAt: null, failedAt: t("2026-09-25T10:00:00Z") })).toBe("preview");
  });

  it("غيابُ التفويض قبل أيّ حكمٍ بالوقت", () => {
    expect(driveState({ previewMode: false, connected: false, checkedAt: t("2026-09-25T10:00:00Z"), failedAt: null })).toBe("disconnected");
  });

  it("التعثّرُ الأحدث من آخر نجاح توقّف", () => {
    expect(driveState({ previewMode: false, connected: true, checkedAt: t("2026-09-25T09:00:00Z"), failedAt: t("2026-09-25T10:00:00Z") })).toBe("failing");
    expect(driveState({ previewMode: false, connected: true, checkedAt: null, failedAt: t("2026-09-25T10:00:00Z") })).toBe("failing");
  });

  it("نجاحٌ بعد التعثّر يمحوه", () => {
    expect(driveState({ previewMode: false, connected: true, checkedAt: t("2026-09-25T11:00:00Z"), failedAt: t("2026-09-25T10:00:00Z") })).toBe("ok");
  });

  it("لا يُقال «يعمل» بلا فحصٍ نجح — الجهلُ ليس سلامة", () => {
    expect(driveState({ previewMode: false, connected: true, checkedAt: null, failedAt: null })).toBe("unchecked");
    expect(driveState({ previewMode: false, connected: null, checkedAt: null, failedAt: null })).toBe("unchecked");
  });
});
