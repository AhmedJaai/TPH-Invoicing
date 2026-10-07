/**
 * رمز الفاتورة الضريبيّ (ZATCA QR) — تحليلُ ما فيه، بلا نموذجٍ ولا حزمة.
 *
 * كلُّ فاتورةٍ ضريبيّة سعوديّة تحمل رمز QR، ونصُّه base64 لسلسلة TLV
 * (وسم · طول · قيمة): اسم البائع (١)، رقمه الضريبيّ (٢)، وقت الإصدار (٣)،
 * الإجماليّ شاملاً الضريبة (٤)، مبلغ الضريبة (٥). والمرحلة الثانية تضيف
 * بصمة الفاتورة وتوقيعها ومفتاحها (٦–٩) — تُعدّ ولا تُقرأ.
 *
 * كتبه **نظامُ المورّد** لا نموذجُنا: فهو شاهدٌ مستقلّ على ما قرأه النموذج،
 * لا قراءةٌ ثانية له. ولا يُتحقَّق هنا من التوقيع: الرمز دليلٌ يُقابَل
 * بالورقة، وليس إثباتاً عند الهيئة.
 *
 * دالّةٌ خالصة. وما لا يُفهَم من حقلٍ يعود `null` — **المجهول ليس صفراً** —
 * وما ليس TLV أصلاً يُردّ بسببه ولا يُخمَّن منه شيء.
 */
import { parseRiyals } from "@/lib/money";
import { normalizeDocumentDate } from "@/lib/document-date";

export interface ZatcaQrFacts {
  /** اسم البائع كما كتبه نظامه — `null` إن كان فارغاً */
  sellerName: string | null;
  /** الرقم الضريبيّ: ١٥ رقماً أوّلها وآخرها ٣ — وإلّا `null` والخامّ في `sellerVatRaw` */
  sellerVatNumber: string | null;
  sellerVatRaw: string;
  /** وقت الإصدار كما كُتب */
  timestampRaw: string;
  /** يوم الإصدار بتوقيت الرياض `YYYY-MM-DD` — `null` إن لم يُفهَم الوقت */
  date: string | null;
  /** الإجماليّ شاملاً الضريبة بالهللات — `null` إن لم يُقرأ */
  totalMinor: number | null;
  /** مبلغ الضريبة بالهللات — `null` إن لم يُقرأ (والصفر المكتوب صفرٌ حقيقيّ) */
  vatMinor: number | null;
  /** أيحمل وسوم المرحلة الثانية (٦ فأعلى)؟ */
  phase2: boolean;
  /** الوسوم التي وُجدت، بترتيبها */
  tags: number[];
}

export type ZatcaTlvResult =
  | { ok: true; facts: ZatcaQrFacts }
  | { ok: false; reason: string };

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const VAT_RE = /^3\d{13}3$/;
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function westernDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** base64 إلى بايتات — `null` إن لم يكن base64 سليماً (ورابطُ موقعٍ في رمزٍ ليس كذلك). */
export function decodeBase64Strict(text: string): Uint8Array | null {
  /* بعض المولّدات تكتبه بأبجديّة الروابط، وبعض القارئات يُدخل فراغاً أو سطراً */
  const compact = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (compact.length < 8 || !BASE64_RE.test(compact)) return null;
  const unpadded = compact.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return null;
  const bytes = Buffer.from(unpadded, "base64");
  /* Buffer يتسامح ويُسقط ما لا يفهمه — فيُتحقَّق بالطول أنّه لم يُسقط شيئاً */
  if (bytes.length !== Math.floor((unpadded.length * 3) / 4)) return null;
  return new Uint8Array(bytes);
}

/**
 * يوم الإصدار بتوقيت الرياض.
 *
 * الوقت المكتوب بمنطقةٍ (`Z` أو `+03:00`) لحظةٌ تُحوَّل: «2026-09-30T21:30:00Z»
 * هو الأوّل من أكتوبر في الرياض — وهو شهرٌ ضريبيّ آخر. والمكتوب بلا منطقة
 * وقتٌ محلّيّ كتبه نظام المورّد في السعوديّة، فيُؤخَذ يومُه كما هو.
 */
function riyadhDate(raw: string): string | null {
  const s = westernDigits(raw).trim();
  const zoned = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.exec(s);
  if (zoned) {
    const [, y, mo, d, h, mi, sec = "00", zone] = zoned;
    const offset = /^z$/i.test(zone) ? "Z" : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
    const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}${offset}`);
    if (Number.isNaN(at.getTime())) return null;
    /* الرياض +٣ بلا توقيتٍ صيفيّ */
    return normalizeDocumentDate(new Date(at.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return normalizeDocumentDate(s);
}

/**
 * يحلّل بايتات TLV.
 *
 * الطول بايتٌ واحد كما في مواصفة الهيئة. ويُقبل الرمز متى استقامت بنيتُه
 * كلُّها (لا قيمةَ تتجاوز آخر البايتات، ولا وسمٌ مكرَّر) وحمل الوسوم الخمسة.
 */
export function parseZatcaTlvBytes(bytes: Uint8Array): ZatcaTlvResult {
  const values = new Map<number, Uint8Array>();
  const tags: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (i + 2 > bytes.length) return { ok: false, reason: "الرمز مقطوع: وسمٌ بلا طول" };
    const tag = bytes[i];
    const length = bytes[i + 1];
    const start = i + 2;
    const end = start + length;
    if (tag === 0) return { ok: false, reason: "وسمٌ صفريّ — ليس رمز فاتورةٍ ضريبيّة" };
    if (end > bytes.length) return { ok: false, reason: `الرمز مقطوع: الوسم ${tag} يطلب ${length} بايتاً والباقي أقلّ` };
    if (values.has(tag)) return { ok: false, reason: `الوسم ${tag} مكرَّر — ليس رمز فاتورةٍ ضريبيّة` };
    values.set(tag, bytes.subarray(start, end));
    tags.push(tag);
    i = end;
  }

  for (const required of [1, 2, 3, 4, 5]) {
    if (!values.has(required)) return { ok: false, reason: `ينقص الرمزَ الوسمُ ${required}` };
  }

  const text: Record<number, string> = {};
  for (const tag of [1, 2, 3, 4, 5]) {
    try {
      text[tag] = UTF8.decode(values.get(tag)!).trim();
    } catch {
      return { ok: false, reason: `قيمة الوسم ${tag} ليست نصّاً سليماً (UTF-8)` };
    }
  }

  const vatDigits = westernDigits(text[2]).replace(/\s+/g, "");
  return {
    ok: true,
    facts: {
      sellerName: text[1] === "" ? null : text[1].normalize("NFKC"),
      sellerVatNumber: VAT_RE.test(vatDigits) ? vatDigits : null,
      sellerVatRaw: text[2],
      timestampRaw: text[3],
      date: riyadhDate(text[3]),
      totalMinor: text[4] === "" ? null : parseRiyals(text[4]),
      vatMinor: text[5] === "" ? null : parseRiyals(text[5]),
      phase2: tags.some((t) => t >= 6),
      tags,
    },
  };
}

/** يحلّل نصّ الرمز (base64) كما خرج من قارئ QR. */
export function parseZatcaQrText(text: string | null | undefined): ZatcaTlvResult {
  if (!text || text.trim() === "") return { ok: false, reason: "الرمز فارغ" };
  const bytes = decodeBase64Strict(text);
  if (!bytes) return { ok: false, reason: "نصّ الرمز ليس base64 — رمزٌ لغير الفاتورة الضريبيّة" };
  return parseZatcaTlvBytes(bytes);
}
