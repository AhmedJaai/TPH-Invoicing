import { describe, expect, it } from "vitest";
import { signatureMatches, sniffMimeType } from "./file-signature";

const bytes = (hex: string) => Buffer.from(hex.padEnd(32, "0"), "hex");

describe("نوع الملفّ من بصمته", () => {
  it("يعرف الأنواع المقبولة", () => {
    expect(sniffMimeType(Buffer.from("%PDF-1.7\n....."))).toBe("application/pdf");
    expect(sniffMimeType(bytes("ffd8ffe0"))).toBe("image/jpeg");
    expect(sniffMimeType(bytes("89504e470d0a1a0a"))).toBe("image/png");
    expect(sniffMimeType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffMimeType(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1"))).toBe("image/heic");
  });

  it("ما ليس منها لا نوعَ له — ولو سُمّي PDF", () => {
    expect(sniffMimeType(Buffer.from("PK\x03\x04 zip archive!!", "latin1"))).toBeNull();
    expect(sniffMimeType(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
  });

  it("المعلَن يُقابَل بالبصمة", () => {
    expect(signatureMatches("application/pdf", Buffer.from("%PDF-1.4 ......."))).toBe(true);
    expect(signatureMatches("application/pdf", bytes("ffd8ffe0"))).toBe(false);
    expect(signatureMatches("image/heif", Buffer.from("\0\0\0\x18ftypmif1\0\0\0\0", "latin1"))).toBe(true);
    expect(signatureMatches("image/jpeg", Buffer.from("MZ executable...."))).toBe(false);
  });
});
