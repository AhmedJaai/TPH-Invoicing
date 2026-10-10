/**
 * كيف يبلغ المستندُ النموذجَ؟
 *
 * ثلاثة أجوبة، والقرار يُتَّخذ هنا مرّةً واحدة فلا يتكرّر في كل مستدعٍ:
 *
 *   TEXT   — الـPDF نصّيّ: نصّه مكتوبٌ فيه بمواضعه. يُقرأ حسابياً
 *            ويُرسَل نصّاً إلى النموذج الرخيص. لا رؤية، ولا كلفة صورة،
 *            ولا خطأ قراءةٍ بصريّ أصلاً.
 *   IMAGE  — مصوَّر: تُنتزَع صورته وتُرسَل إلى نموذج الرؤية.
 *   UNREADABLE — لا نصّ ولا صورةَ تُنتزَع. يُعلَن ولا يُخمَّن.
 *
 * ── ولماذا النصّ أوّلاً ──
 *
 * ليس توفيراً وحده. **الرقم المكتوب في الـPDF مقروءٌ يقيناً، والرقم
 * المرسوم في صورةٍ مقروءٌ ظنّاً.** فحين يكون النصّ موجوداً تكون قراءتُه
 * أدقّ من أيّ نموذج رؤية مهما جوّد — لأنّها ليست قراءة، هي نقل.
 *
 * وهذه القاعدة مكتوبة في `bank/parsers/pdf-text.ts` منذ بُني قارئ
 * كشوف البنك: «لا يُرمى الملفّ كاملاً إلى نموذج لغويّ ويُقال له افهمه».
 * وهي هنا نفسها، مطبَّقةً على الفواتير.
 */
import { extractPdfWords, MAX_TEXT_PAGES, ROW_TOLERANCE, type PdfWord } from "@/lib/bank/parsers/pdf-text";
import { extractEmbeddedJpegs, type EmbeddedImage } from "./pdf-images";
import { isDeepseekImageType } from "./models";
import { assertHeifOpenable, MAX_IMAGE_PIXELS } from "@/lib/file-signature";

export const PDF_TYPE = "application/pdf";

/**
 * أقلّ عدد كلماتٍ يُعدّ الملفّ بها نصّياً.
 *
 * أعلى من عتبة كشوف البنك (٤٠) عمداً: الفاتورة الممسوحة قد تحمل نصّاً
 * قليلاً في ترويسةٍ رقميّة — رقم ملفٍّ أو ختم زمنيّ — بينما جسدُها كلّه
 * صورة. فقبولُها «نصّية» بأربعين كلمة يعني إرسال ترويسةٍ إلى النموذج
 * وكتمانَ الفاتورة.
 */
export const MIN_INVOICE_WORDS = 60;

/**
 * `pagesRead` و`pagesTotal`: كم صفحةً بلغت النموذجَ من كم. كان الاقتطاع صامتاً —
 * فاتورةُ جملةٍ من خمس صفحات تُقرأ ثلاثٌ منها ثمّ «مجموع البنود لا يوافق الصافي»
 * بلا تفسير. `null` حين لا يُعرف عددُ صفحات الملفّ (بنيةٌ تعذّرت قراءتُها).
 */
export type DocumentInput =
  | { mode: "TEXT"; text: string; pageCount: number; wordCount: number; pagesRead: number }
  | {
      mode: "IMAGE";
      images: EmbeddedImage[];
      source: "PDF_EMBEDDED" | "PDF_RENDERED" | "DIRECT";
      pagesRead: number;
      pagesTotal: number | null;
      /** في الملفّ نصٌّ مخفيّ وضعه ماسحٌ فوق الصورة — لم يُؤخَذ به */
      ocrLayer?: boolean;
    }
  | { mode: "UNREADABLE"; reason: string };

const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/**
 * ترتيب الكلمات في الصفّ — والمستند ثنائيّ اللغة.
 *
 * ── لماذا لا يُستعمَل `groupIntoRows` ──
 *
 * ذاك مكتوبٌ لكشوف البنك السعودية، ويرتّب الصفّ **من اليمين إلى
 * اليسار** دائماً (`b.x - a.x`) — وهو صوابٌ في كشفٍ عربيّ كلّه.
 * وجُرِّب هنا على فاتورةٍ ثنائية فخرج اسم المورّد مقلوباً:
 * «Est. Trading Leaves Olive» بدل «Olive Leaves Trading Est.»،
 * و«1kg Beans Coffee Arabica» بدل «Arabica Coffee Beans 1kg».
 *
 * والمبالغ سلمت — لأنّ الرقم لا يُقلَب. فالعطب كان **صامتاً في
 * الأسماء وحدها**، وهي بالضبط ما تقوم عليه مطابقة المورّدين وأسماؤهم
 * البديلة. وفواتير المقهى فيها الإنجليزية كثيراً.
 *
 * ── والحلّ ليس قلب الاتجاه ──
 *
 * لو رُتّب من اليسار دائماً لانقلب العربيّ بدل الإنجليزيّ. والصفّ
 * الواحد هنا يحمل الاثنين معاً:
 *   «Seller: Olive Leaves Trading Est.    المورد: مؤسسة أوراق الزيتون»
 *
 * فالترتيب بالموضع أوّلاً (يسارٌ إلى يمين، وهو الترتيب البصريّ)، ثمّ
 * **تُعكَس كلّ سلسلةٍ عربية متّصلة** فتعود إلى ترتيبها المنطقيّ. وبه
 * يصحّ الطرفان في الصفّ الواحد.
 *
 * ولا يُمَسّ `groupIntoRows` نفسه: كشوف البنك مبنيّة عليه، وتغييرُ
 * دالّةٍ يعتمد عليها مسارٌ قائم يُبطل بأثرٍ رجعيّ ما بُني بها.
 */
export function layoutText(words: readonly PdfWord[]): string {
  const byPage = new Map<number, PdfWord[]>();
  for (const w of words) {
    const list = byPage.get(w.page) ?? [];
    list.push(w);
    byPage.set(w.page, list);
  }

  const out: string[] = [];

  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const lines = new Map<number, PdfWord[]>();

    for (const w of byPage.get(page)!) {
      let key: number | undefined;
      for (const existing of lines.keys()) {
        if (Math.abs(existing - w.y) <= ROW_TOLERANCE) {
          key = existing;
          break;
        }
      }
      const at = key ?? w.y;
      const list = lines.get(at) ?? [];
      list.push(w);
      lines.set(at, list);
    }

    // الأعلى أوّلاً: محور الصفحة يصعد والقراءة تنزل
    for (const y of [...lines.keys()].sort((a, b) => b - a)) {
      const visual = lines.get(y)!.sort((a, b) => a.x - b.x);

      const cells: string[] = [];
      let run: string[] = [];
      /*
        العلامات المعلَّقة.

        العلامة وحدها لا لغةَ لها، فلا يُعرَف موضعُها إلّا بما بعدها:
        نقطتان قبل سلسلةٍ عربية جزءٌ منها فتُعكَس معها، وقبل كلمةٍ
        لاتينية تبقى مكانها. فتُؤجَّل حتى تُعرَف صاحبتُها.
      */
      let pending: string[] = [];
      const flush = () => {
        if (run.length > 0) {
          cells.push(...run.reverse());
          run = [];
        }
      };

      for (const w of visual) {
        /*
          التوحيد إلى NFKC.

          ملفّات PDF كثيرة تخزّن العربية بـ«أشكال العرض» (ﻣﺆﺳﺴﺔ) لا
          بحروفها (مؤسسة) — وهما نصّان مختلفان بايتاً وإن تطابقا في
          العين. فلو مرّ شكلُ العرض كما هو لما التقى اسمُ المورّد باسمه
          المسجَّل عندنا أبداً، والمطابقة كلّها على الأسماء.

          وهذا توحيدُ **مدخَلٍ يُقرأ**، لا كتابةٌ فوق دليل: النصّ الخام
          يبقى في الملفّ، وهذا ما يُرسَل إلى النموذج وحده.
        */
        const text = w.text.normalize("NFKC");

        // العلامات وحدها محايدة: تُؤجَّل حتى يتبيّن ما بعدها
        if (!/\p{L}|\p{N}/u.test(text)) {
          pending.push(text);
          continue;
        }

        if (ARABIC_RE.test(text)) {
          // المعلَّق يلتحق بالسلسلة العربية فيُعكَس معها
          run.push(...pending, text);
        } else {
          flush();
          cells.push(...pending, text);
        }
        pending = [];
      }

      // ما بقي معلَّقاً في آخر الصفّ يلتحق بسلسلته إن كانت مفتوحة
      if (run.length > 0) run.push(...pending);
      else cells.push(...pending);
      flush();

      out.push(cells.join("  "));
    }
  }

  return out.join("\n");
}

/**
 * يقرّر المسار.
 *
 * ولا يرمي: كلّ عطبٍ يعود `UNREADABLE` بسببه. لأنّ المستدعي مسارُ
 * رفعٍ يواجه المستخدم، ورميُ استثناءٍ فيه يُنتج صفحةً بيضاء بدل رسالةٍ
 * تقول ما العمل.
 */
const HEIF_TYPES = new Set(["image/heic", "image/heif"]);
/** أطولُ ضلعٍ يُرسَل إلى النموذج — يكفي لقراءة فاتورة، ويُبقي الطلب صغيراً */
const MAX_IMAGE_SIDE = 2000;

/**
 * صورةُ المستند كما يقرؤها النموذج: JPEG، معتدلة الحجم، مستقيمة.
 *
 * كانت تُرسَل كما وصلت ويُكتب نوعُها «image/jpeg» أيّاً كان — فالـPNG يُوسَم JPEG،
 * وصورةُ الجوّال بأربعة ميجابايت تُرسَل كاملة، وHEIC (كاميرا الآيفون) لا تُفتح أصلاً.
 * و`rotate()` يطبّق اتّجاه الكاميرا (EXIF): فاتورةٌ مصوَّرة بالطول لا تصل مستلقية.
 */
export async function normalizeImage(data: Buffer, mimeType: string): Promise<EmbeddedImage> {
  const { default: sharp } = await import("sharp");
  let source = data;
  if (HEIF_TYPES.has(mimeType)) {
    /* sharp المبنيّ سلفاً لا يفكّ HEVC — فيُفكّ بـlibheif المترجَم إلى WebAssembly */
    const { default: convert } = await import("heic-convert");
    /* المحوِّل يفكّ الصورةَ كلَّها في الذاكرة — فأبعادُها تُسأل قبله */
    assertHeifOpenable(data);
    source = Buffer.from(await convert({ buffer: data, format: "JPEG", quality: 0.92 }));
  }
  const { data: jpeg, info } = await sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { data: jpeg, mimeType: "image/jpeg", width: info.width, height: info.height };
}

/** أقصى ما يُرسَم: صفحاتُ الفاتورة الأولى تكفي */
const MAX_RENDERED_PAGES = 3;
/** حدّا مقياس الرسم: لا تصغيرَ دون الأصل، ولا تكبيرَ يملأ الذاكرة لصفحةٍ صغيرة */
const MIN_RENDER_SCALE = 1;
const MAX_RENDER_SCALE = 4;

/**
 * مقياسٌ يبلغ بأطول ضلعٍ ما يُرسَل (٢٠٠٠ بكسل) مباشرةً.
 *
 * كان ٢ ثابتاً: صفحة A4 تخرج ١٦٨٤ بكسلاً (~١٤٤ نقطة في البوصة) وهو حدٌّ أدنى
 * لأرقام جدولٍ صغيرة، وصفحةٌ كبيرة تُكبَّر ثمّ تُصغَّر بلا فائدة.
 */
export function renderScaleFor(pageWidth: number, pageHeight: number): number {
  const longest = Math.max(pageWidth, pageHeight);
  if (!(longest > 0)) return 2;
  return Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, MAX_IMAGE_SIDE / longest));
}

/** يرسم صفحاتِ الـPDF صوراً — حين لا نصَّ فيه ولا صورةَ موضوعة. ومعها عددُ صفحات الملفّ. */
export async function renderPdfPages(data: Buffer): Promise<{ images: EmbeddedImage[]; pageCount: number }> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const pages = Math.min(pdf.numPages, MAX_RENDERED_PAGES);
  const out: EmbeddedImage[] = [];
  for (let n = 1; n <= pages; n++) {
    const viewport = (await pdf.getPage(n)).getViewport({ scale: 1 });
    const png = await renderPageAsImage(pdf, n, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: renderScaleFor(viewport.width, viewport.height),
    });
    out.push(await normalizeImage(Buffer.from(png), "image/png"));
  }
  return { images: out, pageCount: pdf.numPages };
}

/** تطبيقاتُ مسحٍ وقراءةٍ آليّة: اسمُها في «منتج الملفّ» يكفي وحده */
const SCAN_APP_RE = /adobe scan|camscanner|scanner|scansnap|genius scan|turboscan|office lens|microsoft lens|paperstream|naps2|vuescan|ocrmypdf|tesseract|abbyy|finereader|readiris|\bocr\b/i;
/** أجهزةٌ تمسح وتطبع: اسمُها لا يكفي إلّا ومعه صورةٌ بحجم صفحة */
const SCAN_DEVICE_RE = /canon|epson|ricoh|xerox|kyocera|konica|minolta|brother|lexmark|toshiba|sharp mx|hp scan|scanjet|officejet|laserjet|workcentre|imagerunner/i;
/** أطولُ ضلعٍ يُعدّ به المضمَّنُ «صورةَ صفحة» لا شعاراً */
const PAGE_IMAGE_SIDE = 1000;

/** أيدلّ «منتج الملفّ» على أنّه مسحٌ ضوئيّ؟ */
export function producerLooksScanned(producer: string, hasPageImage: boolean): boolean {
  if (SCAN_APP_RE.test(producer)) return true;
  return hasPageImage && SCAN_DEVICE_RE.test(producer);
}

/**
 * أنصُّ هذا الملفّ قراءةُ ماسحٍ فوق صورة؟
 *
 * تطبيقات المسح (Adobe Scan · CamScanner · الماسحات المكتبيّة) تضع فوق صورة
 * الورقة نصّاً قرأته هي بـOCR، مكتوباً بنمط «لا يُرسَم» (`3 Tr`) ليُبحث فيه.
 * وذاك النصّ قراءةٌ آليّة رديئة للعربيّة والأرقام — لا «نصٌّ مكتوبٌ يقيناً».
 * وكان يُعدّ نصّاً متى بلغ ستّين كلمة، فيُعفى من الشاهد المستقلّ ويدخل آلياً.
 *
 * علامتان، وتكفي إحداهما:
 *   ١. **نمط الرسم**: نظامُ المورّد يكتب نصّه مرئيّاً والماسح يكتبه مخفيّاً —
 *      فإن كان جُلّ ما يُكتب في الصفحة الأولى مخفيّاً وفيها صورة فهي ممسوحة.
 *   ٢. **منتج الملفّ** في بياناته: اسمُ تطبيق مسح، أو اسمُ جهازٍ ومعه صورةٌ
 *      بحجم صفحة.
 * وأيّ عطبٍ في الفحص يعود `false`: يبقى الملفّ على مساره كما كان.
 */
export async function hasHiddenOcrLayer(data: Buffer): Promise<boolean> {
  try {
    const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
    const { OPS } = await getResolvedPDFJS();
    const pdf = await getDocumentProxy(new Uint8Array(data));
    try {
      const meta = await pdf.getMetadata().catch(() => null);
      const info: unknown = meta?.info;
      const producer = info && typeof info === "object"
        ? ["Producer", "Creator"].map((k) => {
            const v: unknown = Reflect.get(info, k);
            return typeof v === "string" ? v : "";
          }).join(" ")
        : "";
      if (producer.trim() !== "") {
        const hasPageImage = extractEmbeddedJpegs(data).some((i) => Math.max(i.width, i.height) >= PAGE_IMAGE_SIDE);
        if (producerLooksScanned(producer, hasPageImage)) return true;
      }

      /* قد يتعثّر تحميلُ الخطوط في بيئةٍ قديمة فتنقص القائمة — فلا يُحكم إلّا بما ظهر */
      const ops = await (await pdf.getPage(1)).getOperatorList();
      const showOps = new Set<number>([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
      const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]);
      let mode = 0;
      const saved: number[] = [];
      let hidden = 0;
      let visible = 0;
      let images = 0;
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn === OPS.save) saved.push(mode);
        else if (fn === OPS.restore) mode = saved.pop() ?? 0;
        else if (fn === OPS.setTextRenderingMode) mode = Number(ops.argsArray[i]?.[0] ?? 0);
        else if (imageOps.has(fn)) images++;
        else if (showOps.has(fn)) {
          /* ٣: لا يُرسَم · ٧: قصٌّ بلا رسم */
          if (mode === 3 || mode === 7) hidden++;
          else visible++;
        }
      }
      return images > 0 && hidden > 0 && hidden >= visible * 4;
    } finally {
      await pdf.destroy().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

/**
 * صور الملفّ الممسوح: الموضوعةُ فيه أوّلاً (بدقّتها الأصليّة) ثمّ الرسم.
 *
 * وكلُّ صورةٍ منتزَعة تمرّ بـ`normalizeImage` كما يمرّ المرسوم: كانت تُرسَل
 * خاماً بحجمها الكامل (مسحُ ٣٠٠ نقطةٍ بأربع صفحات ميجابايتاتٌ في الطلب).
 * وما لا تفتحه `sharp` منها ليس صورةً سليمة — فيُترَك المسار كلُّه للرسم،
 * وهو يحترم ترتيب الصفحات ودورانَها ويفكّ كلَّ ضغط.
 */
async function scannedImages(
  data: Buffer,
  pageCount: number | null,
): Promise<Extract<DocumentInput, { mode: "IMAGE" }> | null> {
  const embedded = extractEmbeddedJpegs(data);
  if (embedded.length > 0) {
    try {
      const images: EmbeddedImage[] = [];
      for (const img of embedded) images.push(await normalizeImage(img.data, img.mimeType));
      return { mode: "IMAGE", images, source: "PDF_EMBEDDED", pagesRead: images.length, pagesTotal: pageCount };
    } catch {
      /* صورةٌ قُصّت خطأً — يُجرَّب الرسم */
    }
  }
  const rendered = await renderPdfPages(data).catch(() => null);
  if (rendered && rendered.images.length > 0) {
    return { mode: "IMAGE", images: rendered.images, source: "PDF_RENDERED", pagesRead: rendered.images.length, pagesTotal: rendered.pageCount };
  }
  return null;
}

export async function resolveDocumentInput(
  data: Buffer,
  mimeType: string,
): Promise<DocumentInput> {
  if (isDeepseekImageType(mimeType) || HEIF_TYPES.has(mimeType)) {
    try {
      const image = await normalizeImage(data, mimeType);
      return { mode: "IMAGE", source: "DIRECT", images: [image], pagesRead: 1, pagesTotal: 1 };
    } catch (e) {
      return { mode: "UNREADABLE", reason: `تعذّر فتح الصورة: ${(e as Error).message}` };
    }
  }

  if (mimeType !== PDF_TYPE) {
    return { mode: "UNREADABLE", reason: `نوع ملف لا يُقرأ: ${mimeType}` };
  }

  let words: Awaited<ReturnType<typeof extractPdfWords>>;
  try {
    words = await extractPdfWords(data);
  } catch (e) {
    /*
      تعذّرت قراءة بنية الـPDF — وقد يكون مع ذلك صورةً تُنتزَع.
      فلا يُيأس هنا؛ يُجرَّب المسار الثاني.
    */
    const salvaged = await scannedImages(data, null);
    if (salvaged) return salvaged;
    return { mode: "UNREADABLE", reason: `تعذّرت قراءة الملفّ: ${(e as Error).message}` };
  }

  const asText = (): DocumentInput => ({
    mode: "TEXT",
    text: layoutText(words.words),
    pageCount: words.pageCount,
    wordCount: words.words.length,
    pagesRead: Math.min(words.pageCount, MAX_TEXT_PAGES),
  });

  if (words.words.length >= MIN_INVOICE_WORDS) {
    /*
      نصٌّ كثير — أكتبه نظامُ المورّد أم قرأه ماسح؟ النصّ المخفيّ فوق صورةٍ
      قراءةُ OCR لا نقل: يُقرأ الملفّ صورةً ويُطلَب له شاهدٌ كأيّ ممسوح.
      وإن لم تُنتزَع له صورةٌ ولا رُسم بقي نصّه — القليل خيرٌ من لا شيء.
    */
    if (await hasHiddenOcrLayer(data)) {
      const scanned = await scannedImages(data, words.pageCount);
      if (scanned) return { ...scanned, ocrLayer: true };
    }
    return asText();
  }

  const embedded = extractEmbeddedJpegs(data);
  if (embedded.length > 0) {
    const scanned = await scannedImages(data, words.pageCount);
    if (scanned) return scanned;
  }

  /*
    نصٌّ قليل، ولا صورةَ بديلة — فالقليل خيرٌ من لا شيء.

    كانت العتبة تُسقط الملفّ إلى «لا يُقرأ» متى قلّ نصّه عن ستّين كلمة،
    ولو لم يكن ثمّ بديل. وقياسُ الأرشيف كشفها: فاتورتا لافا كمبوتشا
    (٤٩ و٥٥ كلمة) نصّهما مكتوبٌ كاملاً وفيه الرقم والمبلغ، فرُدَّتا
    بلا سبب. والفاتورة الصغيرة — سطرٌ أو سطران — فاتورةٌ تامّة.

    فالعتبة تفاضلٌ بين مسارين حين يوجد المساران، لا شرطُ قبولٍ حين لا
    بديل. و«لا يُقرأ» تبقى لمن لا نصّ له ولا صورة.
  */
  if (words.words.length > 0) return asText();

  /*
    لا نصّ ولا صورةٌ موضوعة — فتُرسَم الصفحة.

    فاتورةُ زاكوباك 3068 (٣ أكتوبر ٢٠٢٦) طُبعت بـ«Microsoft Print To PDF»: الصفحةُ أشكالٌ
    مرسومة، لا نصَّ يُنتزَع ولا JPEG يُقصّ — فقيل «لم يُقرأ» عن فاتورةٍ واضحةٍ تماماً،
    وأُرشفت بلا قيد. والرسمُ (`unpdf` على `@napi-rs/canvas`) يُخرج صورتَها كما تُرى —
    ومعه ما ضُغط بـ`CCITTFax` و`JBIG2` و`JPX`، فمحرّك الرسم يفكّها.
  */
  const rendered = await scannedImages(data, words.pageCount);
  if (rendered) return rendered;

  /* لا نصّ يُقرأ ولا صورةَ تُنتزَع ولا رسمٌ خرج — يُعلَن ولا تُرسَل صفحةٌ فارغة */
  return {
    mode: "UNREADABLE",
    reason: "ملفّ PDF لا نصَّ فيه ولم تُرسَم صفحتُه — يحتاج قراءةً يدوية، أو صوّر الورقة وارفع الصورة",
  };
}
