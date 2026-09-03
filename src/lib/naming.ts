/**
 * بناء وتفكيك أسماء ملفات الأرشيف.
 *
 * الصيغ المعتمدة:
 *   الفاتورة : YYYY-MM-DD_<Slug>_Invoice_<InvoiceNo>_SAR<Amount>.pdf
 *   الكشف    : YYYY-MM-DD_<Slug>_Statement_SAR<Amount>.pdf
 *   الإيصال  : YYYY-MM-DD_Receipt_<Slug>[-<Beneficiary>]_SAR<Amount>.pdf
 *   النقدي   : YYYY-MM-DD_Cash_<وصف>_SAR<Amount>.jpg
 *
 * ملاحظة على الإيصالات: الأرشيف الفعلي يضع اسم المستفيد البنكي بعد شرطة،
 * مثل Receipt_Loreva-MaqamAlThiqa. وهذا يتعارض نحوياً مع slug يحمل شرطة أصلاً
 * مثل PURE-Oska. لذلك الفصل يعتمد على مطابقة أطول slug معروف، لا على أول شرطة.
 */
import { formatRiyals, parseRiyals } from "./money";

export type DocumentNameKind =
  | "INVOICE"
  | "STATEMENT"
  | "RECEIPT"
  | "CASH"
  | "PROFORMA"
  | "QUOTATION"
  | "LEDGER"
  | "SALES_INVOICE";

/**
 * أنواع المستندات كما تظهر في أسماء الملفات، بكل صيغها في الأرشيف الفعلي.
 * المفتاح بحروف صغيرة للمطابقة، والقيمة هي النوع المعياري.
 */
const TYPE_TOKENS: Record<string, DocumentNameKind> = {
  invoice: "INVOICE",
  "invoice-scan": "INVOICE",
  invoices: "INVOICE",
  // ظهرت في الأرشيف الفعلي على فاتورة سرد للتجارة بـ١١٬٦٠٠ ريال، وغيابها
  // من هذا الجدول أسقطها من الترحيل بصمت. الصيغة مقبولة والنوع فاتورة.
  taxinvoice: "INVOICE",
  "tax-invoice": "INVOICE",
  statement: "STATEMENT",
  ledger: "LEDGER",
  proformainvoice: "PROFORMA",
  proforma: "PROFORMA",
  quotation: "QUOTATION",
  "quotation-draft": "QUOTATION",
  salesinvoice: "SALES_INVOICE",
  customerpayment: "RECEIPT",
};

export interface ParsedFileName {
  kind: DocumentNameKind;
  /** التاريخ بصيغة YYYY-MM-DD. الأسماء التي تحمل الشهر وحده تُكمَّل باليوم الأول */
  date: string;
  /** صحيح حين لم يحمل الاسم يوماً — يُنبَّه عليه بدل تخمينه بصمت */
  monthOnly?: boolean;
  slug?: string;
  invoiceNumber?: string;
  /** وصف الفترة في الكشوف: "May" أو "to-31-07" */
  periodLabel?: string;
  /** اسم المستفيد البنكي إن وُجد في اسم ملف الإيصال */
  beneficiary?: string;
  /** وصف الإيصال النقدي */
  description?: string;
  /** يغيب حين لا يحمل الاسم مبلغاً — بعض الكشوف تحمل وصفاً بدله */
  amountMinor?: number;
  extension: string;
  /** رقم النسخة عند تكرار الاسم: "‎(2)" ← 2 */
  duplicateIndex?: number;
}

export type ParseResult =
  | { ok: true; value: ParsedFileName }
  | { ok: false; reason: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^SAR(\d+\.\d{2})$/;
const DUPLICATE_RE = /\s\((\d+)\)$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function splitExtension(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { base: fileName, extension: "" };
  return { base: fileName.slice(0, dot), extension: fileName.slice(dot + 1).toLowerCase() };
}

/**
 * يفصل الـslug عن اسم المستفيد في رمز مثل "Loreva-MaqamAlThiqa".
 * يجرّب المطابقة التامة أولاً حتى لا يُكسر slug يحمل شرطة مثل PURE-Oska.
 */
export function splitSlugAndBeneficiary(
  token: string,
  knownSlugs: readonly string[] = [],
): { slug: string; beneficiary?: string } {
  const exact = knownSlugs.find((s) => s === token);
  if (exact) return { slug: exact };

  const prefixes = knownSlugs
    .filter((s) => token.startsWith(`${s}-`))
    .sort((a, b) => b.length - a.length);

  if (prefixes.length > 0) {
    const slug = prefixes[0];
    return { slug, beneficiary: token.slice(slug.length + 1) };
  }

  // slug غير معروف: نرجع لأول شرطة كتقدير، والمستورد سيرفع الحالة للمراجعة.
  const dash = token.indexOf("-");
  if (dash === -1) return { slug: token };
  return { slug: token.slice(0, dash), beneficiary: token.slice(dash + 1) };
}

/** التاريخ الكامل أو الشهر وحده — الأرشيف يحوي الصيغتين. */
function parseDateToken(value: string): { date: string; monthOnly: boolean } | null {
  if (DATE_RE.test(value) && isRealDate(value)) return { date: value, monthOnly: false };
  if (/^\d{4}-\d{2}$/.test(value)) {
    const m = Number(value.slice(5));
    if (m >= 1 && m <= 12) return { date: `${value}-01`, monthOnly: true };
  }
  return null;
}

export function parseFileName(
  fileName: string,
  knownSlugs: readonly string[] = [],
): ParseResult {
  const { base: rawBase, extension } = splitExtension(fileName);
  if (!extension) return { ok: false, reason: "الملف بلا امتداد" };

  // ملفات خدمية لا محاسبية
  if (extension === "txt" || extension === "md") {
    return { ok: false, reason: "ملف ملاحظات لا مستند محاسبي" };
  }

  let base = rawBase;
  let duplicateIndex: number | undefined;
  const dup = base.match(DUPLICATE_RE);
  if (dup) {
    duplicateIndex = Number(dup[1]);
    base = base.slice(0, dup.index).trimEnd();
  }

  const parts = base.split("_");
  if (parts.length < 3) return { ok: false, reason: "عدد المقاطع أقل من المتوقع" };

  const parsedDate = parseDateToken(parts[0]);
  if (!parsedDate) return { ok: false, reason: `تاريخ غير صالح: ${parts[0]}` };
  const { date, monthOnly } = parsedDate;

  // المبلغ اختياري: بعض الكشوف تحمل وصف فترة بدل الرقم.
  // لكن ما بدأ بـSAR فهو محاولة كتابة مبلغ — نرفضه إن خالف الصيغة بدل
  // أن نعدّه وصفاً، وإلا مرّت الأخطاء المطبعية في المبالغ بصمت.
  let amountMinor: number | undefined;
  const lastPart = parts[parts.length - 1];
  const amountMatch = lastPart.match(AMOUNT_RE);
  if (amountMatch) {
    const parsed = parseRiyals(amountMatch[1]);
    if (parsed === null) return { ok: false, reason: `تعذّر قراءة المبلغ: ${lastPart}` };
    amountMinor = parsed;
  } else if (/^SAR/i.test(lastPart)) {
    return {
      ok: false,
      reason: `مبلغ غير صالح: ${lastPart} — يجب أن يكون SAR بمنزلتين عشريتين`,
    };
  }

  const common = { date, monthOnly, amountMinor, extension, duplicateIndex };
  const marker = parts[1];

  if (marker === "Receipt") {
    const { slug, beneficiary } = splitSlugAndBeneficiary(parts[2], knownSlugs);
    return { ok: true, value: { kind: "RECEIPT", slug, beneficiary, ...common } };
  }

  if (marker === "Cash") {
    const end = amountMatch ? -1 : undefined;
    const description = parts.slice(2, end).join("_");
    if (!description) return { ok: false, reason: "الإيصال النقدي بلا وصف" };
    return { ok: true, value: { kind: "CASH", description, ...common } };
  }

  // بعض الأنواع تسبق الاسم (فاتورة صادرة، دفعة عميل) كما يسبقه Receipt وCash
  const leading = TYPE_TOKENS[marker.toLowerCase()];
  if (leading) {
    const rest = parts.slice(2, amountMatch ? -1 : undefined).filter(Boolean);
    return {
      ok: true,
      value: {
        kind: leading,
        slug: rest[0],
        invoiceNumber: rest.length > 1 ? rest.slice(1).join("_") : undefined,
        ...common,
      },
    };
  }

  // وإلا فالنوع بعد اسم المورّد
  let typeIndex = -1;
  let kind: DocumentNameKind | undefined;
  for (let i = 2; i < parts.length; i++) {
    const found = TYPE_TOKENS[parts[i].toLowerCase()];
    if (found) {
      typeIndex = i;
      kind = found;
      break;
    }
  }

  if (!kind) return { ok: false, reason: `نوع مستند غير معروف: ${parts[2]}` };

  const slug = parts.slice(1, typeIndex).join("_");
  if (!slug) return { ok: false, reason: "لا يوجد اسم مورّد" };

  // ما بين النوع والمبلغ: رقم الفاتورة أو وصف الفترة
  const tail = parts.slice(typeIndex + 1, amountMatch ? -1 : undefined).filter(Boolean);
  const descriptor = tail.join("_") || undefined;

  const needsNumber = kind === "INVOICE" || kind === "SALES_INVOICE" || kind === "PROFORMA";

  return {
    ok: true,
    value: {
      kind,
      slug,
      // رقم الفاتورة إن وُجد؛ وغيابه مقبول لأنّ بعض الفواتير في الأرشيف بلا رقم
      invoiceNumber: needsNumber ? descriptor : undefined,
      periodLabel: needsNumber ? undefined : descriptor,
      ...common,
    },
  };
}

export interface BuildOptions {
  date: string;
  amountMinor: number;
  extension?: string;
  duplicateIndex?: number;
}

function withSuffix(base: string, extension: string, duplicateIndex?: number): string {
  const suffix = duplicateIndex && duplicateIndex > 1 ? ` (${duplicateIndex})` : "";
  return `${base}${suffix}.${extension}`;
}

export function buildInvoiceFileName(
  o: BuildOptions & { slug: string; invoiceNumber: string },
): string {
  const base = `${o.date}_${o.slug}_Invoice_${o.invoiceNumber}_SAR${formatRiyals(o.amountMinor)}`;
  return withSuffix(base, o.extension ?? "pdf", o.duplicateIndex);
}

export function buildStatementFileName(o: BuildOptions & { slug: string }): string {
  const base = `${o.date}_${o.slug}_Statement_SAR${formatRiyals(o.amountMinor)}`;
  return withSuffix(base, o.extension ?? "pdf", o.duplicateIndex);
}

export function buildReceiptFileName(
  o: BuildOptions & { slug: string; beneficiary?: string },
): string {
  const who = o.beneficiary ? `${o.slug}-${o.beneficiary}` : o.slug;
  const base = `${o.date}_Receipt_${who}_SAR${formatRiyals(o.amountMinor)}`;
  return withSuffix(base, o.extension ?? "pdf", o.duplicateIndex);
}

export function buildCashFileName(o: BuildOptions & { description: string }): string {
  const base = `${o.date}_Cash_${o.description}_SAR${formatRiyals(o.amountMinor)}`;
  return withSuffix(base, o.extension ?? "jpg", o.duplicateIndex);
}

/**
 * يختار اسماً غير مستخدم بإضافة "‎(2)" فصاعداً.
 * لا يستبدل ملفاً موجوداً أبداً.
 */
export function resolveNameCollision(
  desired: string,
  existingNames: readonly string[],
): string {
  const taken = new Set(existingNames);
  if (!taken.has(desired)) return desired;

  const { base, extension } = splitExtension(desired);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i}).${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`تعذّر إيجاد اسم متاح للملف: ${desired}`);
}
