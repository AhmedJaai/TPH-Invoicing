/**
 * صور الـPDF — بلا محرّك رسمٍ ولا حزمةٍ جديدة.
 *
 * ── لماذا هذا الملفّ موجود أصلاً ──
 *
 * DeepSeek **لا يقبل PDF**. ردّ خادمه حرفيّاً حين أُرسل إليه واحد:
 * «webp, png, jpeg, and gif». و١٥٧ من ١٥٨ مستنداً في أرشيف المقهى PDF.
 * فبين الأرشيف والنموذج جدارٌ يجب أن يُعبَر.
 *
 * ── ولماذا لا يُرسَم ──
 *
 * الطريق المعتاد: `pdfjs` يرسم الصفحة على لوحة، واللوحةُ في Node تحتاج
 * حزمةً ثنائية (`@napi-rs/canvas` أو `canvas`). وهي تُضيف ميغابايتات
 * إلى حزمة النشر، وثنائيّاً يجب أن يوافق منصّة Vercel، وتحديثاتٍ
 * تُتابَع — كلّ ذلك لأجل حالةٍ واحدة.
 *
 * والملاحظة التي تُغني عنها: **المستند الممسوح ضوئياً صورتُه JPEG
 * موضوعةٌ في الـPDF كما هي.** الماسح يُنتج JPEG ثمّ يلفّه في غلاف PDF،
 * فالبايتات المطلوبة موجودة في الملفّ حرفيّاً — لا تُرسَم، تُنتزَع.
 *
 * فما نحتاجه ليس رسّاماً بل مِقصّاً.
 *
 * ── حدّ هذا المسار، معلَناً ──
 *
 * يعمل على `DCTDecode` (أي JPEG) وحده، وهو الغالب في المسح الملوَّن.
 * ولا يعمل على `JBIG2Decode` و`CCITTFaxDecode` (المسح الأبيض والأسود
 * في بعض الماسحات المكتبية) ولا `JPXDecode` (JPEG 2000). وما لم يُنتزَع
 * **يُعلَن أنّه لم يُقرأ** ويُرفع إلى مراجعةٍ بشرية — ولا يُدَّعى فيه
 * شيء. والحدّ المعلوم سلفاً حدٌّ يُعرَض، لا خطأٌ يقع.
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
 * تُقرأ لسببين: استبعادُ الشعارات الصغيرة، وترتيبُ الصور بالأكبر —
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
  const found: EmbeddedImage[] = [];
  let i = 0;

  while (i < pdf.length - 3) {
    // بداية JPEG: FF D8 FF
    if (pdf[i] === 0xff && pdf[i + 1] === 0xd8 && pdf[i + 2] === 0xff) {
      // النهاية: FF D9 — ويُبحث عنها بعد البداية
      let j = i + 3;
      let end = -1;
      while (j < pdf.length - 1) {
        if (pdf[j] === 0xff && pdf[j + 1] === 0xd9) {
          end = j + 2;
          break;
        }
        j++;
      }
      if (end < 0) break;

      const slice = pdf.subarray(i, end);
      if (slice.length >= MIN_IMAGE_BYTES) {
        const size = jpegSize(slice);
        // ما لا تُقرأ أبعادُه ليس JPEG سليماً — يُترَك ولا يُرسَل
        if (size && size.width >= 200 && size.height >= 200) {
          found.push({ data: Buffer.from(slice), mimeType: "image/jpeg", ...size });
        }
      }
      i = end;
      continue;
    }
    i++;
  }

  /*
    الأكبر أوّلاً.

    الملفّ قد يحمل شعاراً وختماً وصفحة. والصفحة أكبرها بمساحتها —
    فالترتيب بالمساحة يضع ما يُقرأ في المقدّمة، والسقف يقطع ما بعده.
  */
  return found
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, MAX_IMAGES);
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
