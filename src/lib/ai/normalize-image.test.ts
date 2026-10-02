import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeImage, resolveDocumentInput } from "./document-input";
import { isSupportedUpload, uploadMimeType } from "@/lib/extraction";

describe("صورُ الجوّال تُقرأ", () => {
  it("PNG كبيرة تصل JPEG بأطولِ ضلعٍ ٢٠٠٠ — لا PNG موسومةً JPEG", async () => {
    const png = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: "#fff" } }).png().toBuffer();
    const img = await normalizeImage(png, "image/png");
    expect(img.mimeType).toBe("image/jpeg");
    expect([img.width, img.height]).toEqual([2000, 800]);
    expect((await sharp(img.data).metadata()).format).toBe("jpeg");
  });

  it("صورةٌ لا تُفتح تُقال سبباً لا عطباً", async () => {
    const out = await resolveDocumentInput(Buffer.from("not an image"), "image/jpeg");
    expect(out.mode).toBe("UNREADABLE");
  });

  it("HEIC بنوعٍ فارغ (كروم) يُعرف من امتداده ويُقبل", () => {
    expect(uploadMimeType("", "IMG_2041.HEIC")).toBe("image/heic");
    expect(isSupportedUpload(uploadMimeType("", "IMG_2041.HEIC"))).toBe(true);
    expect(uploadMimeType("image/jpg", "a.jpg")).toBe("image/jpeg");
  });
});
