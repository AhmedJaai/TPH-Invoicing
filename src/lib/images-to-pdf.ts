/**
 * صورٌ (JPEG) في ملفّ PDF واحد — صفحةٌ لكلّ صورة.
 *
 * فاتورةٌ ورقيّة من صفحتين (البنودُ في الأولى والإجماليُّ في الثانية) كانت تُصوَّر
 * مستندَين يُقرآن ناقصَين. فتُضمّ الصورُ هنا في المتصفّح قبل الإرسال، ويقرؤها
 * الخادمُ مستنداً واحداً.
 *
 * مكتوبٌ باليد بلا مكتبة: PDF الصور أبسطُ أشكاله — كلُّ صفحةٍ كائنُ صورةٍ بترميز
 * `DCTDecode` (وهو JPEG نفسُه بلا إعادة ضغط) ومجرى رسمٍ من سطر. وجدولُ الإزاحات
 * (`xref`) يُحسَب بالبايت. ويُختبَر بقارئ الـPDF الذي يقرأ به الخادم.
 *
 * دالّةٌ خالصة — لا متصفّح.
 */
export interface JpegPage {
  /** بايتاتُ JPEG كما هي (لونٌ RGB/YCbCr أو رماديّ — ما يُخرجه `canvas.toBlob`). */
  jpeg: Uint8Array;
  width: number;
  height: number;
  /** رماديّةٌ؟ (مكوّنٌ واحد) — الأصل ملوّنة. */
  gray?: boolean;
}

/** أطولُ ضلعٍ في الصفحة بالنقاط — ارتفاعُ A4. والنسبةُ نسبةُ الصورة. */
const LONG_SIDE_PT = 842;

export function imagesToPdf(pages: readonly JpegPage[]): Uint8Array<ArrayBuffer> {
  if (pages.length === 0) throw new Error("لا صورةَ تُضمّ.");
  for (const p of pages) {
    if (!(p.width > 0 && p.height > 0) || p.jpeg.length < 4 || p.jpeg[0] !== 0xff || p.jpeg[1] !== 0xd8) {
      throw new Error("إحدى الصور ليست JPEG صالحة.");
    }
  }

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  /** كائنٌ رقمُه `n` — وتُسجَّل إزاحتُه لجدول `xref`. */
  const object = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  /* ١ الفهرس · ٢ شجرةُ الصفحات · ثمّ لكلّ صفحةٍ ثلاثة: الصفحةُ والصورةُ ومجرى الرسم */
  const pageId = (i: number) => 3 + i * 3;
  /* السطرُ الثاني بايتاتٌ فوق ١٢٧: يقول للناقل إنّ الملفّ ثنائيّ لا نصّ */
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] >>`);

  pages.forEach((p, i) => {
    const scale = LONG_SIDE_PT / Math.max(p.width, p.height);
    const w = Math.round(p.width * scale * 100) / 100;
    const h = Math.round(p.height * scale * 100) / 100;
    const id = pageId(i);
    const draw = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(
      id + 1,
      `<< /Type /XObject /Subtype /Image /Width ${Math.round(p.width)} /Height ${Math.round(p.height)} /ColorSpace ${p.gray ? "/DeviceGray" : "/DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`,
      p.jpeg,
    );
    object(id + 2, `<< /Length ${draw.length} >>`, draw);
  });

  const count = 3 + pages.length * 3;
  const xrefAt = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
