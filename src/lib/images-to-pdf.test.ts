import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { imagesToPdf } from "./images-to-pdf";
import { extractEmbeddedJpegs } from "./ai/pdf-images";

/** صورةُ ضجيجٍ — تُضغَط قليلاً فتتجاوز حدَّ «شعار» في مقصّ الخادم (١٢ ك.ب). */
async function noiseJpeg(width: number, height: number, seed: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  let x = seed;
  for (let i = 0; i < raw.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = x & 0xff;
  }
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 80 }).toBuffer());
}

describe("imagesToPdf — صفحتا فاتورةٍ في مستندٍ واحد", () => {
  it("يقرؤه قارئُ الـPDF الذي يقرأ به الخادم: صفحتان بنسبة صورتَيهما", async () => {
    const pdf = imagesToPdf([
      { jpeg: await noiseJpeg(300, 400, 1), width: 300, height: 400 },
      { jpeg: await noiseJpeg(400, 300, 2), width: 400, height: 300 },
    ]);
    expect(new TextDecoder().decode(pdf.slice(0, 8))).toBe("%PDF-1.4");

    const { getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    expect(doc.numPages).toBe(2);
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const second = (await doc.getPage(2)).getViewport({ scale: 1 });
    expect(first.height).toBeCloseTo(842, 0);
    expect(first.width / first.height).toBeCloseTo(300 / 400, 2);
    expect(second.width).toBeCloseTo(842, 0);
    expect(second.width / second.height).toBeCloseTo(400 / 300, 2);
    /* جدولُ الإزاحات صحيح: القارئُ لم يحتج إلى ترميم الملفّ ليجد كائناته */
    const ops = await (await doc.getPage(2)).getOperatorList();
    expect(ops.fnArray.length).toBeGreaterThan(0);
  });

  it("ومقصُّ الخادم ينتزع الصورتَين كما هما — بايتاً ببايت، بلا إعادة ضغط", async () => {
    const a = await noiseJpeg(300, 400, 3);
    const b = await noiseJpeg(320, 420, 4);
    const pdf = imagesToPdf([
      { jpeg: a, width: 300, height: 400 },
      { jpeg: b, width: 320, height: 420 },
    ]);
    const found = extractEmbeddedJpegs(Buffer.from(pdf));
    expect(found.map((f) => [f.width, f.height]).sort()).toEqual([[300, 400], [320, 420]]);
    expect(found.some((f) => Buffer.from(a).equals(f.data))).toBe(true);
    expect(found.some((f) => Buffer.from(b).equals(f.data))).toBe(true);
  });

  it("إزاحاتُ `xref` تشير إلى كائناتها بالبايت", async () => {
    const pdf = imagesToPdf([{ jpeg: await noiseJpeg(64, 64, 5), width: 64, height: 64 }]);
    const text = Buffer.from(pdf).toString("latin1");
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const rows = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    rows.forEach((offset, i) => {
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(rows).toHaveLength(5);
  });

  it("ما ليس JPEG أو بلا أبعادٍ يُرفَض بكلامٍ مفهوم — لا ملفٌّ تالف", () => {
    expect(() => imagesToPdf([])).toThrow("لا صورةَ");
    expect(() => imagesToPdf([{ jpeg: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), width: 10, height: 10 }])).toThrow("JPEG");
    expect(() => imagesToPdf([{ jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), width: 0, height: 10 }])).toThrow("JPEG");
  });
});
