/**
 * قراءة رمز الفاتورة الضريبيّ (QR) من الملفّ نفسه — حتميّاً، وبلا نموذج.
 *
 * الصفحة تُرسَم (أو الصورة تُفتَح) ثمّ يُفكّ الرمز بحزمة `qr` — جافاسكربت
 * خالصة بلا تبعيّات، فلا ثنائيّ يوافق المنصّة ولا ملفّ wasm يُتتبَّع — ثمّ
 * يُحلَّل TLV في `zatca-tlv.ts`. ولا يخرج الملفّ من الخادم.
 *
 * **ولا يرمي ولا يُعطّل**: هو شاهدٌ يُضاف إلى القراءة، فإن تعذّر قيل
 * «لم يُقرأ رمز» ومضت القراءة كما كانت. وعدمُ القراءة ليس عدمَ الوجود:
 * الرمز الباهت أو المطويّ قد لا يُفكّ وهو على الورقة.
 */
import { isDeepseekImageType } from "@/lib/ai/models";
import { assertHeifOpenable, MAX_IMAGE_PIXELS } from "@/lib/file-signature";
import { parseZatcaQrText, type ZatcaQrFacts } from "./zatca-tlv";

export type QrReading =
  /** رمزٌ فُكّ وحُلِّل: حقوله الخمسة */
  | { status: "FOUND"; facts: ZatcaQrFacts; page: number }
  /** رمزٌ فُكّ وليس رمزَ فاتورةٍ ضريبيّة (رابط موقعٍ أو دفع) */
  | { status: "NOT_ZATCA"; reason: string }
  /** لم يُفكّ رمزٌ في ما فُحص — وقد يكون على الورقة ولم يُقرأ */
  | { status: "NONE" }
  /** لم يُفحص: نوعٌ لا يُرسَم، أو عطبٌ في الرسم */
  | { status: "SKIPPED"; reason: string };

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const PDF_TYPE = "application/pdf";
const HEIF_TYPES = new Set(["image/heic", "image/heif"]);

/**
 * مقياس رسم الصفحة لفكّ الرمز.
 *
 * رمز المرحلة الثانية نحو ٩٠ خانةً في ضلعه، ويُطبع بسنتيمترين ونصف:
 * بمقياس ٢ (ما يُرسَم للنموذج) تصير الخانة بكسلاً ونصفاً فلا تُفكّ.
 * وبمقياس ٤ ثلاثة بكسلات فأكثر.
 */
const QR_RENDER_SCALE = 4;
/** أطول ضلعٍ يُفحص — يحدّ الذاكرة والزمن */
const MAX_QR_SIDE = 3600;
/** ما يُمنَح لمحاولات الفكّ الإضافيّة في الصورة الواحدة (مِلّي ثانية) */
const DECODE_TIME_LIMIT_MS = 1200;

/** يفكّ أوّل رمزٍ في صورة RGBA — `null` إن لم يُعثر على رمز. */
export async function decodeQrText(image: RgbaImage): Promise<string | null> {
  const { default: decodeQR } = await import("qr/decode.js");
  try {
    return decodeQR(image, { timeLimit: DECODE_TIME_LIMIT_MS });
  } catch {
    /* الحزمة ترمي حين لا رمز — وذلك جوابٌ لا عطب */
    return null;
  }
}

async function toRgba(data: Buffer, mimeType: string): Promise<RgbaImage> {
  const { default: sharp } = await import("sharp");
  let source = data;
  if (HEIF_TYPES.has(mimeType)) {
    const { default: convert } = await import("heic-convert");
    assertHeifOpenable(data);
    source = Buffer.from(await convert({ buffer: data, format: "JPEG", quality: 0.92 }));
  }
  const { data: raw, info } = await sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({ width: MAX_QR_SIDE, height: MAX_QR_SIDE, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) };
}

/** الصفحة الأولى ثمّ الأخيرة: الرمز في ذيل الفاتورة أو رأسها، لا في وسط صفحاتها. */
async function pdfPagesForQr(data: Buffer): Promise<{ page: number; image: RgbaImage }[]> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const pages = pdf.numPages > 1 ? [1, pdf.numPages] : [1];
  const out: { page: number; image: RgbaImage }[] = [];
  for (const page of pages) {
    const png = await renderPageAsImage(pdf, page, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: QR_RENDER_SCALE,
    });
    out.push({ page, image: await toRgba(Buffer.from(png), "image/png") });
  }
  return out;
}

/**
 * يحكم في ما فُكّ من الصفحات: رمزُ فاتورةٍ يغلب رمزاً لغيرها (الفاتورة قد
 * تحمل رمز دفعٍ أو موقعٍ إلى جانب رمزها الضريبيّ في صفحةٍ أخرى).
 */
export function judgeDecoded(decoded: readonly { page: number; text: string | null }[]): QrReading {
  let other: QrReading | null = null;
  for (const d of decoded) {
    if (d.text === null) continue;
    const parsed = parseZatcaQrText(d.text);
    if (parsed.ok) return { status: "FOUND", facts: parsed.facts, page: d.page };
    other ??= { status: "NOT_ZATCA", reason: parsed.reason };
  }
  return other ?? { status: "NONE" };
}

export async function readZatcaQr(data: Buffer, mimeType: string): Promise<QrReading> {
  try {
    let pages: { page: number; image: RgbaImage }[];
    if (mimeType === PDF_TYPE) {
      pages = await pdfPagesForQr(data);
    } else if (isDeepseekImageType(mimeType) || HEIF_TYPES.has(mimeType)) {
      pages = [{ page: 1, image: await toRgba(data, mimeType) }];
    } else {
      return { status: "SKIPPED", reason: `نوع ملفٍّ لا يُفحص فيه رمز: ${mimeType}` };
    }

    const decoded: { page: number; text: string | null }[] = [];
    for (const p of pages) {
      const text = await decodeQrText(p.image);
      decoded.push({ page: p.page, text });
      /* رمزُ فاتورةٍ في الصفحة الأولى يكفي — لا تُفحص الأخيرة */
      if (text !== null && parseZatcaQrText(text).ok) break;
    }
    return judgeDecoded(decoded);
  } catch (e) {
    return { status: "SKIPPED", reason: `تعذّر فحص الرمز: ${e instanceof Error ? e.message : String(e)}` };
  }
}
