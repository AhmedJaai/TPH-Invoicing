/**
 * صور الـPDF الموضوعة فيه — تُنتزَع كما هي، بلا رسم.
 *
 * ── لماذا هذا الملفّ موجود أصلاً ──
 *
 * DeepSeek **لا يقبل PDF**. ردّ خادمه حرفيّاً حين أُرسل إليه واحد:
 * «webp, png, jpeg, and gif». و١٥٧ من ١٥٨ مستنداً في أرشيف المقهى PDF.
 * فبين الأرشيف والنموذج جدارٌ يجب أن يُعبَر.
 *
 * ── المقصّ أوّلاً، ثمّ الرسم ──
 *
 * **المستند الممسوح ضوئياً صورتُه JPEG موضوعةٌ في الـPDF كما هي.** الماسح
 * يُنتج JPEG ثمّ يلفّه في غلاف PDF، فالبايتات المطلوبة موجودة في الملفّ
 * حرفيّاً بدقّتها الأصليّة — تُنتزَع ولا تُرسَم.
 *
 * ── حدّ هذا المسار، وما يسدّه ──
 *
 * يعمل على `DCTDecode` (أي JPEG) وحده. وما ضُغط بـ`JBIG2Decode` أو
 * `CCITTFaxDecode` (المسح الأبيض والأسود) أو `JPXDecode` لا يُنتزَع هنا —
 * فيُرسَم: منذ ٣ أكتوبر ٢٠٢٦ يرسم `renderPdfPages` (في `document-input.ts`)
 * الصفحةَ بـ`unpdf` على `@napi-rs/canvas`، ومحرّكه يفكّ الضغوط كلَّها.
 */

/** أقلّ حجمٍ يُعتدّ به صورةَ مستند — ما دونه شعارٌ أو أيقونة. */
const MIN_IMAGE_BYTES = 12_000;

/** سقف ما يُرسَل: صفحاتٌ قليلة تكفي لقراءة فاتورة. */
const MAX_IMAGES = 4;

export interface EmbeddedImage {
  data: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

/**
 * أبعاد JPEG من علاماته.
 *
 * تُقرأ لسببين: استبعادُ الشعارات الصغيرة، واختيارُ الأكبر —
 * فصفحةُ الفاتورة أكبر ما في الملفّ.
 */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2; // بعد FFD8
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // علامات SOF التي تحمل الأبعاد — وليست كلّ FFCx منها
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * ينتزع صور JPEG المضمَّنة.
 *
 * المسح على علامتَي البداية والنهاية لا على بنية الـPDF: البنية فيها
 * مراجع غير مباشرة و`/Length` قد يكون إشارةً إلى كائنٍ آخر، فقراءتها
 * صحيحةً تعني كاتب PDF كاملاً. وعلامتا JPEG (`FFD8FF` … `FFD9`)
 * مميّزتان بما يكفي، وكلّ ما يُنتزَع **يُتحقَّق منه** بقراءة أبعاده —
 * فما ليس JPEG سليماً يسقط هنا لا عند المزوّد.
 */
export function extractEmbeddedJpegs(pdf: Buffer): EmbeddedImage[] {
  const found: (EmbeddedImage & { order: number })[] = [];
  let i = 0;

  while (i < pdf.length - 3) {
    // بداية JPEG: FF D8 FF
    if (pdf[i] === 0xff && pdf[i + 1] === 0xd8 && pdf[i + 2] === 0xff) {
      const end = jpegEnd(pdf, i);
      if (end < 0) {
        /* بدايةٌ بلا نهايةٍ سليمة — تُتخطّى ولا يُترَك ما بعدها */
        i += 3;
        continue;
      }

      const slice = pdf.subarray(i, end);
      if (slice.length >= MIN_IMAGE_BYTES) {
        const size = jpegSize(slice);
        // ما لا تُقرأ أبعادُه ليس JPEG سليماً — يُترَك ولا يُرسَل
        if (size && size.width >= 200 && size.height >= 200) {
          found.push({ data: Buffer.from(slice), mimeType: "image/jpeg", ...size, order: found.length });
        }
      }
      i = end;
      continue;
    }
    i++;
  }

  /*
    الأكبر يُختار، وبترتيب ظهوره يُرسَل.

    الملفّ قد يحمل شعاراً وختماً وصفحات. والصفحات أكبرها بمساحتها — فالسقف
    يأخذ الأكبر. لكنّ الإرسال «الأكبر أوّلاً» كان يضع صفحة البنود قبل
    الترويسة في فاتورةٍ من صفحتين؛ فيُعاد ما اختير إلى ترتيبه في الملفّ.
  */
  return found
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, MAX_IMAGES)
    .sort((a, b) => a.order - b.order)
    .map((img) => ({ data: img.data, mimeType: img.mimeType, width: img.width, height: img.height }));
}

/**
 * نهاية JPEG يبدأ عند `start` — موضعُ ما بعد `FFD9`، أو ‎-1.
 *
 * يمشي على المقاطع بأطوالها حتى بدء المسح (`SOS`) ثمّ يبحث عن النهاية في
 * بيانات المسح. كان يأخذ أوّل `FFD9` بعد البداية — وصورةُ الكاميرا تحمل في
 * مقطع EXIF مصغَّرةً لها `FFD8…FFD9` خاصّة، فتُقصّ الصورة عند نهاية المصغَّرة
 * وتُرمى. والمشي بالأطوال يتخطّى المصغَّرة مع مقطعها.
 */
function jpegEnd(buf: Buffer, start: number): number {
  let i = start + 2;
  /* ── المقاطع قبل المسح ── */
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return -1;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // حشو
    if (marker === 0xd9) return i + 2;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return -1;
    i += 2 + len;
    if (marker === 0xda) break; // بدأ المسح
  }
  /* ── بيانات المسح: FF00 حشوٌ و FFD0–D7 إعادةُ بدء، وما سواهما علامة ── */
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
    if (marker === 0xd9) return i + 2;
    /* مقطعٌ داخل صورةٍ تدريجيّة (جدولٌ أو مسحٌ تالٍ) — يُتخطّى بطوله */
    if (i + 3 >= buf.length) return -1;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return -1;
    i += 2 + len;
  }
  return -1;
}

/**
 * أهذه الصورة كبيرةٌ بما يستحقّ تفصيلاً عالياً؟
 *
 * §٨ يطلب ألّا تُرسَل الصور الكبيرة بلا داعٍ. والفاتورة الصغيرة
 * الواضحة تُقرأ بتفصيلٍ تلقائيّ، والممسوحة الكثيفة تحتاج العالي —
 * وإلّا ضاعت أرقامٌ صغيرة في الجدول.
 */
export function detailFor(image: { width: number; height: number }): "high" | "auto" {
  return image.width * image.height > 1_400_000 ? "high" : "auto";
}
