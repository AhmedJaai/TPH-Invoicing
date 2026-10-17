import { describe, expect, it } from "vitest";
import { isReadableFile, queueCapture, takeCaptured } from "./capture-queue";

describe("isReadableFile — شرط القبول واحد لكلّ باب", () => {
  it("PDF وصورة بنوعهما", () => {
    expect(isReadableFile({ name: "a.pdf", type: "application/pdf" })).toBe(true);
    expect(isReadableFile({ name: "a", type: "image/jpeg" })).toBe(true);
    expect(isReadableFile({ name: "IMG_1.HEIC", type: "image/heic" })).toBe(true);
  });

  it("صورة الآيفون بنوع فارغ تقبل بامتدادها — كانت تردّ من زرّ الالتقاط والإفلات", () => {
    expect(isReadableFile({ name: "IMG_0042.HEIC", type: "" })).toBe(true);
    expect(isReadableFile({ name: "IMG_0042.heif", type: "" })).toBe(true);
    expect(isReadableFile({ name: "scan.JPG", type: "" })).toBe(true);
    expect(isReadableFile({ name: "invoice.pdf", type: "application/octet-stream" })).toBe(true);
  });

  it("ما ليس ورقةً يردّ: جدول، نصّ، وامتداد يخالف نوعاً معلناً", () => {
    expect(isReadableFile({ name: "sales.xlsx", type: "" })).toBe(false);
    expect(isReadableFile({ name: "notes.txt", type: "text/plain" })).toBe(false);
    expect(isReadableFile({ name: "trick.pdf", type: "text/html" })).toBe(false);
    expect(isReadableFile({ name: "noext", type: "" })).toBe(false);
  });

  it("الطابور يحمل المقبول وحده ويفرغ بالأخذ", () => {
    takeCaptured();
    const heic = new File([new Uint8Array([1])], "IMG_1.HEIC", { type: "" });
    const xlsx = new File([new Uint8Array([1])], "x.xlsx", { type: "" });
    expect(queueCapture([heic, xlsx])).toBe(1);
    expect(takeCaptured().map((f) => f.name)).toEqual(["IMG_1.HEIC"]);
    expect(takeCaptured()).toEqual([]);
  });
});
