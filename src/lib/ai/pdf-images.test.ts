import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { extractEmbeddedJpegs } from "./pdf-images";
import { hasHiddenOcrLayer, producerLooksScanned, renderScaleFor, resolveDocumentInput } from "./document-input";

/** JPEG حقيقيّ بضجيجٍ يتجاوز به حدّ «شعار» */
async function jpeg(width: number, height: number, seed: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let s = seed;
  for (let i = 0; i < raw.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = s % 256;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 70 }).toBuffer();
}

/** يحشر مقطع EXIF (APP1) فيه مصغَّرةٌ لها FFD8…FFD9 خاصّة — كما تكتبه الكاميرا */
function withExifThumbnail(image: Buffer, thumbnail: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from("Exif\0\0"), thumbnail]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([image.subarray(0, 2), app1, payload, image.subarray(2)]);
}

function wrap(...images: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Filter /DCTDecode >>\nstream\n"),
    ...images.flatMap((img) => [img, Buffer.from("\nendstream\nendobj\nstream\n")]),
    Buffer.from("%%EOF"),
  ]);
}

describe("extractEmbeddedJpegs", () => {
  it("صورةُ كاميرا فيها مصغَّرة EXIF تُنتزَع كاملةً لا عند نهاية المصغَّرة", async () => {
    const page = await jpeg(600, 800, 7);
    const thumb = await jpeg(64, 64, 3);
    const withThumb = withExifThumbnail(page, thumb);

    const found = extractEmbeddedJpegs(wrap(withThumb));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ width: 600, height: 800 });
    expect(found[0].data.length).toBe(withThumb.length);
    /* وتفتحها sharp — أي أنّها لم تُقصّ */
    expect((await sharp(found[0].data).metadata()).width).toBe(600);
  });

  it("الصفحات بترتيب ظهورها في الملفّ لا «الأكبر أوّلاً»", async () => {
    const header = await jpeg(400, 500, 1); // الصفحة الأولى أصغر
    const lines = await jpeg(700, 900, 2);
    const found = extractEmbeddedJpegs(wrap(header, lines));
    expect(found.map((f) => f.width)).toEqual([400, 700]);
  });

  it("السقف يأخذ الأكبر ويُسقط الأصغر، ثمّ يعيد الترتيب", async () => {
    const pages = await Promise.all([300, 620, 640, 660, 680].map((w, i) => jpeg(w, w + 100, i + 10)));
    const found = extractEmbeddedJpegs(wrap(...pages));
    expect(found.map((f) => f.width)).toEqual([620, 640, 660, 680]);
  });

  it("بدايةٌ بلا نهايةٍ لا تُسقط ما بعدها", async () => {
    const page = await jpeg(500, 700, 5);
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]);
    const found = extractEmbeddedJpegs(Buffer.concat([Buffer.from("%PDF-1.4\n"), broken, Buffer.from("\nxx\n"), page]));
    expect(found).toHaveLength(1);
  });
});

/** PDF من صفحةٍ واحدة: صورةٌ صغيرة مرسومة، ونصٌّ بنمط رسمٍ يُختار */
function pdfWithText(renderMode: number, withImage: boolean, producer?: string): Buffer {
  const words = Array.from({ length: 70 }, (_, i) => `word${i}`);
  const text = words.map((w, i) => `1 0 0 1 ${40 + (i % 7) * 70} ${780 - Math.floor(i / 7) * 14} Tm (${w}) Tj`).join("\n");
  const stream =
    (withImage ? "q 595 0 0 842 0 0 cm /Im0 Do Q\n" : "") +
    `BT /F1 10 Tf ${renderMode} Tr\n${text}\nET`;
  const image = "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >>${withImage ? " /XObject << /Im0 6 0 R >>" : ""} >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    image,
    ...(producer ? [`<< /Producer (${producer}) >>`] : []),
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${producer ? " /Info 7 0 R" : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/* pdf.js يحمّل الخطوط بـ`ArrayBuffer.transfer` — غائبةٌ قبل Node 22، فتنقص قائمةُ العمليّات */
const CAN_LIST_TEXT_OPS = typeof Reflect.get(ArrayBuffer.prototype, "transfer") === "function";

describe("hasHiddenOcrLayer — نصُّ ماسحٍ فوق صورة ليس «نصّاً مكتوباً»", () => {
  it.runIf(CAN_LIST_TEXT_OPS)("نصٌّ مخفيّ (3 Tr) فوق صورة: طبقة OCR", async () => {
    expect(await hasHiddenOcrLayer(pdfWithText(3, true))).toBe(true);
  });

  it("منتجُ الملفّ تطبيقُ مسح: طبقة OCR ولو كُتب النصّ مرئيّاً", async () => {
    expect(await hasHiddenOcrLayer(pdfWithText(0, true, "Adobe Scan for iOS 24.01"))).toBe(true);
    expect(await hasHiddenOcrLayer(pdfWithText(0, true, "CamScanner"))).toBe(true);
  });

  it("منتجٌ هو نظامُ فوترةٍ أو طابعةٌ بلا صورةِ صفحة: ليس مسحاً", async () => {
    expect(await hasHiddenOcrLayer(pdfWithText(0, true, "Odoo wkhtmltopdf 0.12"))).toBe(false);
    expect(await hasHiddenOcrLayer(pdfWithText(0, true, "Canon iR-ADV"))).toBe(false);
    expect(producerLooksScanned("Canon iR-ADV C5535", true)).toBe(true);
    expect(producerLooksScanned("Microsoft: Print To PDF", true)).toBe(false);
  });

  it("نصٌّ مرئيّ كتبه نظامُ المورّد — ولو مع شعار — ليس طبقة OCR", async () => {
    expect(await hasHiddenOcrLayer(pdfWithText(0, true))).toBe(false);
    expect(await hasHiddenOcrLayer(pdfWithText(0, false))).toBe(false);
  });

  it("ملفٌّ تالف لا يرمي ويبقى على مساره", async () => {
    expect(await hasHiddenOcrLayer(Buffer.from("not a pdf"))).toBe(false);
  });

  it("الملفّ ذو الطبقة المخفيّة يُقرأ صورةً لا نصّاً، ويُعلَّم", async () => {
    const input = await resolveDocumentInput(pdfWithText(3, true, "Adobe Scan"), "application/pdf");
    expect(input).toMatchObject({ mode: "IMAGE", ocrLayer: true, pagesRead: 1, pagesTotal: 1 });
  }, 20_000);

  it("والنصّيّ الحقيقيّ يبقى نصّاً ويحمل عدد صفحاته", async () => {
    const input = await resolveDocumentInput(pdfWithText(0, false), "application/pdf");
    expect(input).toMatchObject({ mode: "TEXT", pageCount: 1, pagesRead: 1 });
  });
});

describe("renderScaleFor", () => {
  it("A4 يُرسَم ليبلغ أطولُ ضلعه ٢٠٠٠ بكسل", () => {
    expect(Math.round(842 * renderScaleFor(595, 842))).toBe(2000);
  });
  it("صفحةٌ كبيرة لا تُصغَّر دون أصلها، وصغيرةٌ لا تُكبَّر فوق ٤", () => {
    expect(renderScaleFor(3000, 4000)).toBe(1);
    expect(renderScaleFor(200, 300)).toBe(4);
    expect(renderScaleFor(0, 0)).toBe(2);
  });
});
