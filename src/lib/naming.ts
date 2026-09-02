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

export type DocumentNameKind = "INVOICE" | "STATEMENT" | "RECEIPT" | "CASH";

export interface ParsedFileName {
  kind: DocumentNameKind;
  /** التاريخ بصيغة YYYY-MM-DD كما ورد في الاسم */
  date: string;
  slug?: string;
  invoiceNumber?: string;
  /** اسم المستفيد البنكي إن وُجد في اسم ملف الإيصال */
  beneficiary?: string;
  /** وصف الإيصال النقدي */
  description?: string;
  amountMinor: number;
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

export function parseFileName(
  fileName: string,
  knownSlugs: readonly string[] = [],
): ParseResult {
  const { base: rawBase, extension } = splitExtension(fileName);
  if (!extension) return { ok: false, reason: "الملف بلا امتداد" };

  let base = rawBase;
  let duplicateIndex: number | undefined;
  const dup = base.match(DUPLICATE_RE);
  if (dup) {
    duplicateIndex = Number(dup[1]);
    base = base.slice(0, dup.index).trimEnd();
  }

  const parts = base.split("_");
  if (parts.length < 3) return { ok: false, reason: "عدد المقاطع أقل من المتوقع" };

  const [date, marker] = parts;
  if (!isRealDate(date)) return { ok: false, reason: `تاريخ غير صالح: ${date}` };

  const amountToken = parts[parts.length - 1];
  const amountMatch = amountToken.match(AMOUNT_RE);
  if (!amountMatch) {
    return { ok: false, reason: `مبلغ غير صالح: ${amountToken} — يجب أن يكون SAR بمنزلتين عشريتين` };
  }
  const amountMinor = parseRiyals(amountMatch[1]);
  if (amountMinor === null) return { ok: false, reason: `تعذّر قراءة المبلغ: ${amountToken}` };

  const common = { date, amountMinor, extension, duplicateIndex };

  if (marker === "Receipt") {
    if (parts.length !== 4) return { ok: false, reason: "صيغة إيصال غير مكتملة" };
    const { slug, beneficiary } = splitSlugAndBeneficiary(parts[2], knownSlugs);
    return { ok: true, value: { kind: "RECEIPT", slug, beneficiary, ...common } };
  }

  if (marker === "Cash") {
    if (parts.length < 4) return { ok: false, reason: "الإيصال النقدي بلا وصف" };
    const description = parts.slice(2, -1).join("_");
    return { ok: true, value: { kind: "CASH", description, ...common } };
  }

  const type = parts[2];
  if (type === "Invoice") {
    if (parts.length !== 5) return { ok: false, reason: "صيغة فاتورة غير مكتملة" };
    return {
      ok: true,
      value: { kind: "INVOICE", slug: marker, invoiceNumber: parts[3], ...common },
    };
  }

  if (type === "Statement") {
    if (parts.length !== 4) return { ok: false, reason: "صيغة كشف غير مكتملة" };
    return { ok: true, value: { kind: "STATEMENT", slug: marker, ...common } };
  }

  return { ok: false, reason: `نوع مستند غير معروف: ${type}` };
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
