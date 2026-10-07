/**
 * الرمز يُرسَم حقيقةً ثمّ يُفكّ — لا بديل مصطنع عن القارئ.
 *
 * الصورة: خاناتٌ تُلوَّن في RGBA ثمّ تُضغط JPEG (كما يصل مسحُ الجوّال).
 * والـPDF: مستطيلاتٌ متّجهة في مجرى الصفحة (كما يرسمها نظام المورّد)،
 * فيمرّ الاختبار بالرسم (`unpdf` على `@napi-rs/canvas`) ثمّ الفكّ ثمّ TLV.
 */
import { describe, expect, it } from "vitest";
import encodeQR from "qr";
import sharp from "sharp";
import { judgeDecoded, readZatcaQr } from "./zatca-qr";

function tlvBase64(pairs: [number, string][]): string {
  const chunks: Buffer[] = [];
  for (const [tag, value] of pairs) {
    const bytes = Buffer.from(value, "utf8");
    chunks.push(Buffer.from([tag, bytes.length]), bytes);
  }
  return Buffer.concat(chunks).toString("base64");
}

const INVOICE_QR = tlvBase64([
  [1, "مؤسسة أوراق الزيتون التجارية"],
  [2, "310122393500003"],
  [3, "2026-09-13T15:13:00Z"],
  [4, "1150.00"],
  [5, "150.00"],
]);

/** صفحةٌ بيضاء فيها الرمز — JPEG كما تخرجه الكاميرا أو الماسح. */
async function pageImage(text: string, modulePx = 6): Promise<Buffer> {
  const grid = encodeQR(text, "raw");
  const side = grid.length * modulePx;
  const width = side + 400;
  const height = side + 900;
  const raw = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      if (!grid[y][x]) continue;
      for (let dy = 0; dy < modulePx; dy++) {
        for (let dx = 0; dx < modulePx; dx++) {
          const at = ((700 + y * modulePx + dy) * width + 200 + x * modulePx + dx) * 3;
          raw[at] = raw[at + 1] = raw[at + 2] = 0;
        }
      }
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}

/** PDF من صفحة A4 واحدة فيه الرمز مستطيلاتٍ متّجهة بضلع ٢٫٥ سم — بلا حزمة. */
function vectorPdf(text: string): Buffer {
  const grid = encodeQR(text, "raw");
  const unit = 71 / grid.length; // ٧١ نقطة ≈ ٢٫٥ سم
  const ops: string[] = ["0 g"];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      if (grid[y][x]) {
        ops.push(`${(60 + x * unit).toFixed(3)} ${(160 - (y + 1) * unit).toFixed(3)} ${unit.toFixed(3)} ${unit.toFixed(3)} re`);
      }
    }
  }
  ops.push("f");
  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
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
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

describe("readZatcaQr — من الصورة إلى الحقول", () => {
  it("يفكّ رمز الفاتورة من صورةٍ مضغوطة ويعيد حقوله بالهللات", async () => {
    const r = await readZatcaQr(await pageImage(INVOICE_QR), "image/jpeg");
    expect(r).toMatchObject({
      status: "FOUND",
      page: 1,
      facts: {
        sellerName: "مؤسسة أوراق الزيتون التجارية",
        sellerVatNumber: "310122393500003",
        date: "2026-09-13",
        totalMinor: 115000,
        vatMinor: 15000,
      },
    });
  });

  it("رمزٌ لرابط موقعٍ يُقال إنّه ليس رمز فاتورة — ولا يُخمَّن منه مبلغ", async () => {
    const r = await readZatcaQr(await pageImage("https://example.com/pay/INV-1150"), "image/jpeg");
    expect(r.status).toBe("NOT_ZATCA");
  });

  it("صفحةٌ بلا رمز: «لم يُقرأ رمز» لا عطب", async () => {
    const blank = await sharp({ create: { width: 800, height: 1100, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    expect(await readZatcaQr(blank, "image/jpeg")).toEqual({ status: "NONE" });
  });

  it("ملفٌّ تالف أو نوعٌ لا يُفحص لا يرمي", async () => {
    expect((await readZatcaQr(Buffer.from("not an image"), "image/png")).status).toBe("SKIPPED");
    expect((await readZatcaQr(Buffer.from("%PDF-1.4 broken"), "application/pdf")).status).toBe("SKIPPED");
    expect((await readZatcaQr(Buffer.from("a,b"), "text/csv")).status).toBe("SKIPPED");
  });
});

describe("readZatcaQr — من PDF نصّيّ رمزُه متّجه", () => {
  it("يرسم الصفحة ويفكّ رمزاً بضلع ٢٫٥ سم", async () => {
    const r = await readZatcaQr(vectorPdf(INVOICE_QR), "application/pdf");
    expect(r).toMatchObject({ status: "FOUND", facts: { totalMinor: 115000, vatMinor: 15000, sellerVatNumber: "310122393500003" } });
  }, 20_000);

  it("ورمز المرحلة الثانية (أطول بوسوم التوقيع) بالضلع نفسه", async () => {
    const phase2 = Buffer.concat([
      Buffer.from(INVOICE_QR, "base64"),
      Buffer.from([6, 44]), Buffer.from("NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzk="),
      Buffer.from([7, 96]), Buffer.alloc(96, 0x4d),
      Buffer.from([8, 88]), Buffer.alloc(88, 0xa7),
    ]).toString("base64");
    const r = await readZatcaQr(vectorPdf(phase2), "application/pdf");
    expect(r).toMatchObject({ status: "FOUND", facts: { phase2: true, totalMinor: 115000 } });
  }, 20_000);
});

describe("judgeDecoded", () => {
  it("رمز الفاتورة يغلب رمزاً لغيرها في صفحةٍ أسبق", () => {
    const r = judgeDecoded([{ page: 1, text: "https://shop.example" }, { page: 3, text: INVOICE_QR }]);
    expect(r).toMatchObject({ status: "FOUND", page: 3 });
  });

  it("لا رمز في أيّ صفحة", () => {
    expect(judgeDecoded([{ page: 1, text: null }, { page: 2, text: null }])).toEqual({ status: "NONE" });
  });
});
