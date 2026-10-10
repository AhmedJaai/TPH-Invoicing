import { describe, expect, it } from "vitest";
import { assertHeifOpenable, heifDimensions, MAX_UNZIPPED_BYTES, signatureMatches, sniffMimeType, zipBombReason, zipExpansion } from "./file-signature";

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

/** أرشيفٌ بفهرسٍ يعلن الأحجام المعطاة — بلا محتوى، فالفهرسُ وحده ما يُقرأ. */
function zipDeclaring(sizes: readonly number[]): Buffer {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  const central = sizes.map((size, i) => {
    const name = Buffer.from(`xl/part${i}.xml`);
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt32LE(size, 24);
    h.writeUInt16LE(name.length, 28);
    return Buffer.concat([h, name]);
  });
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(sizes.length, 8);
  eocd.writeUInt16LE(sizes.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, directory, eocd]);
}

describe("ما ينفكّ إليه الملفّ قبل أن يُفكّ", () => {
  it("يجمع أحجامَ الفهرس، وغيرُ الأرشيف لا يُسأل", () => {
    expect(zipExpansion(zipDeclaring([1000, 2500]))).toEqual({ entries: 2, uncompressedBytes: 3500 });
    expect(zipExpansion(Buffer.from("التاريخ,الوصف,المبلغ\n2026-01-01,حوالة,100\n"))).toBeNull();
    expect(zipBombReason(Buffer.from("a,b\n1,2\n"))).toBeNull();
  });

  it("جدولٌ معقول يمرّ، وما ينفكّ إلى جيجابايتات يُردّ بسببه", () => {
    expect(zipBombReason(zipDeclaring([5_000_000, 20_000_000]))).toBeNull();
    const reason = zipBombReason(zipDeclaring([MAX_UNZIPPED_BYTES, 4_000_000_000]));
    expect(reason).toMatch(/ينفكّ إلى/);
  });

  it("وعددُ الأجزاء غير المعقول يُردّ", () => {
    expect(zipBombReason(zipDeclaring(Array.from({ length: 2_001 }, () => 1)))).toMatch(/الأجزاء/);
  });

  it("PDF تسبق ترويستَه بايتاتٌ يُعرف، وما لا ترويسةَ له لا", () => {
    expect(sniffMimeType(Buffer.from("\ufeff\n%PDF-1.4\n"))).toBe("application/pdf");
    expect(sniffMimeType(Buffer.from("PK\u0003\u0004 not a pdf at all"))).toBeNull();
  });
});

describe("أبعاد HEIC قبل تحويلها", () => {
  const heic = (width: number, height: number) => {
    const ispe = Buffer.alloc(16);
    ispe.write("ispe", 0, "latin1");
    ispe.writeUInt32BE(width, 8);
    ispe.writeUInt32BE(height, 12);
    return Buffer.concat([Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1"), ispe]);
  };

  it("تُقرأ من صندوق ispe، وصورةُ الجوّال تمرّ", () => {
    expect(heifDimensions(heic(4032, 3024))).toEqual({ width: 4032, height: 3024 });
    expect(() => assertHeifOpenable(heic(8064, 6048))).not.toThrow();
  });

  it("وأبعادٌ لا تُفتح تُردّ قبل المحوِّل", () => {
    expect(() => assertHeifOpenable(heic(60_000, 60_000))).toThrow(/أكبر من أن تُفتح/);
  });

  it("وبلا صندوق أبعادٍ يُترك الحكمُ للمحوِّل", () => {
    expect(heifDimensions(Buffer.from("no box here"))).toBeNull();
    expect(() => assertHeifOpenable(Buffer.from("no box here"))).not.toThrow();
  });
});
