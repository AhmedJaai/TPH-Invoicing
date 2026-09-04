/**
 * فهم ما كتبه صاحب المقهى في مربّع البحث.
 *
 * لا يعرف أسماء الحقول ولا يجب أن يعرفها. يكتب «٤٧٥٠٠» أو «٢٦٠٣٤٢» أو
 * «لافا» أو «2026-08»، ويتوقّع أن يجد. فالمهمّة هنا أن يُستنتج **ما
 * الذي يقصده** من شكل ما كتب، ثمّ يُبحث في المواضع التي يُحتمل أن يكون
 * فيها — لا في كلّ شيء بلا تمييز.
 *
 * دالّة خالصة: تأخذ نصّاً وتُرجع خطّة بحث. لا قاعدة بيانات هنا.
 */

export type SearchKind =
  | "AMOUNT"      // مبلغ بالريال
  | "MONTH"       // 2026-08
  | "DATE"        // 2026-08-17
  | "NUMBER"      // رقم فاتورة أو مرجع
  | "VAT"         // رقم ضريبي (١٥ رقماً)
  | "TEXT";       // اسم أو وصف

export interface SearchIntent {
  kind: SearchKind;
  /** النصّ بعد التنظيف. */
  term: string;
  /** بالهللات، حين يكون مبلغاً. */
  amountMinor?: number;
  /** ما يُبحث فيه، مرتّباً بأرجحيّته. */
  targets: SearchTarget[];
}

export type SearchTarget =
  | "invoices" | "suppliers" | "products" | "bankTransactions" | "documents";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** يحوّل الأرقام العربية إلى لاتينية كي يُبحث بها. */
export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

/** يُسقط التشكيل ويوحّد الألف والياء والتاء المربوطة. */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VAT_RE = /^\d{15}$/;
/** مبلغ: أرقام قد يتخلّلها فاصل آلاف وقد ينتهي بكسر */
const AMOUNT_RE = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;

/**
 * الرقم الطويل بلا فاصلة ولا كسر أقرب إلى رقم مستند منه إلى مبلغ.
 *
 * «٢٦٠٣٤٢» رقم فاتورة، و«٤٧٥٠٠» مبلغ إيجار. والحدّ بينهما اجتهاد: ستّة
 * أرقام فأكثر بلا كسر تُقرأ رقماً، وما دونها يُبحث عنه **كليهما** — لأنّ
 * الخطأ هنا يُخفي نتيجةً صحيحة، والبحث في موضعين أرخص من فقدها.
 */
export const DOCUMENT_NUMBER_MIN_DIGITS = 6;

export function parseSearch(raw: string): SearchIntent | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const digits = normalizeDigits(trimmed);

  if (DATE_RE.test(digits)) {
    return { kind: "DATE", term: digits, targets: ["invoices", "bankTransactions", "documents"] };
  }

  if (MONTH_RE.test(digits)) {
    return { kind: "MONTH", term: digits, targets: ["invoices", "documents", "bankTransactions"] };
  }

  if (VAT_RE.test(digits)) {
    return { kind: "VAT", term: digits, targets: ["suppliers"] };
  }

  const bare = digits.replace(/,/g, "");
  if (AMOUNT_RE.test(digits)) {
    const isLongInteger = !digits.includes(".") && !digits.includes(",")
      && bare.length >= DOCUMENT_NUMBER_MIN_DIGITS;

    if (isLongInteger) {
      return {
        kind: "NUMBER",
        term: bare,
        // يبقى المبلغ مطروحاً: رقمٌ طويل قد يكون مبلغاً كبيراً
        amountMinor: toMinor(bare),
        targets: ["invoices", "bankTransactions", "documents"],
      };
    }

    return {
      kind: "AMOUNT",
      term: bare,
      amountMinor: toMinor(bare),
      targets: ["invoices", "bankTransactions"],
    };
  }

  // نصٌّ فيه أرقام وحروف — مرجع أو رقم فاتورة بحروف مثل V405484
  if (/^[A-Za-z0-9\-/]{3,}$/.test(trimmed)) {
    return { kind: "NUMBER", term: trimmed, targets: ["invoices", "bankTransactions", "documents"] };
  }

  return {
    kind: "TEXT",
    term: normalizeArabic(trimmed),
    targets: ["suppliers", "products", "invoices", "bankTransactions", "documents"],
  };
}

function toMinor(bare: string): number {
  const [whole, frac = ""] = bare.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
}

/**
 * نافذة تسامح حول المبلغ.
 *
 * من يكتب «٤٧٥٠٠» يقصد الإيجار، وقد يكون المقيَّد ٤٧٥٠٠٫٠٠ أو ٤٧٤٩٩٫٩٥.
 * فيُبحث في نطاق ريالٍ حوله — لا مطابقةً تامّة تُخفي ما يُطلب.
 */
export const AMOUNT_WINDOW_MINOR = 100;

export function amountRange(amountMinor: number): { min: number; max: number } {
  return {
    min: Math.max(0, amountMinor - AMOUNT_WINDOW_MINOR),
    max: amountMinor + AMOUNT_WINDOW_MINOR,
  };
}

export interface SearchHit {
  kind: "invoice" | "supplier" | "product" | "bankTransaction" | "document";
  id: string;
  title: string;
  subtitle: string;
  amountMinor?: number;
  href: string;
}

export const KIND_LABEL: Record<SearchHit["kind"], string> = {
  invoice: "فاتورة",
  supplier: "مورّد",
  product: "صنف",
  bankTransaction: "حركة بنكية",
  document: "مستند",
};

/**
 * ترتيب النتائج: الأدقّ أوّلاً.
 *
 * من بحث برقم يريد الفاتورة لا المورّد؛ ومن بحث باسم يريد المورّد لا
 * حركةً بنكية ورد فيها الاسم. فالترتيب يتبع ما قُصد، لا ما وُجد أكثر.
 */
const ORDER: Record<SearchKind, SearchHit["kind"][]> = {
  AMOUNT: ["invoice", "bankTransaction", "document", "supplier", "product"],
  MONTH: ["invoice", "document", "bankTransaction", "supplier", "product"],
  DATE: ["invoice", "bankTransaction", "document", "supplier", "product"],
  NUMBER: ["invoice", "bankTransaction", "document", "supplier", "product"],
  VAT: ["supplier", "invoice", "document", "bankTransaction", "product"],
  TEXT: ["supplier", "product", "invoice", "bankTransaction", "document"],
};

export function rankHits(hits: readonly SearchHit[], kind: SearchKind): SearchHit[] {
  const order = ORDER[kind];
  return [...hits].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
