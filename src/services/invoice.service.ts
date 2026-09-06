/**
 * خدمة الفواتير: القيد والبنود وأسعارها.
 *
 * تسوية البنود بصافي الفاتورة تجري هنا لا في كل مسار على حدة، لأنّ ثلاثة
 * مسارات تُنشئ فواتير — الأرشفة والمزامنة وقراءة المحتوى — وافتراقها في
 * حساب السعر أنتج «ارتفاع أسعار ١٥٪» لم يقع.
 */
import { eq } from "drizzle-orm";
import { invoiceLines, invoices, statementLines, statements } from "@/db/schema";
import { normalizeItem } from "@/lib/items";
import { reconcileInvoiceLines, resolveLinePricing } from "@/lib/line-pricing";
import { parseRiyals } from "@/lib/money";
import type { InputVatStatus, TaxStatus } from "@/lib/validation";
import type { RawLine, Tx } from "./types";

export interface CreateInvoiceInput {
  documentId: string;
  supplierId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  periodMonth: string;
  /** `null` تعني «لم يُقرأ» لا «صفر» */
  subtotalMinor: number | null;
  vatMinor: number | null;
  totalMinor: number;
  sellerVat?: string | null;
  buyerVat?: string | null;
  taxStatus: TaxStatus;
  inputVatStatus: InputVatStatus;
  isFixedAsset: boolean;
}

export async function createInvoice(tx: Tx, input: CreateInvoiceInput): Promise<string | null> {
  const [inv] = await tx
    .insert(invoices)
    .values({
      documentId: input.documentId,
      supplierId: input.supplierId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      periodMonth: input.periodMonth,
      subtotalMinor: input.subtotalMinor,
      vatMinor: input.vatMinor,
      totalMinor: input.totalMinor,
      sellerVat: input.sellerVat ?? null,
      buyerVat: input.buyerVat ?? null,
      taxStatus: input.taxStatus,
      inputVatStatus: input.inputVatStatus,
      isFixedAsset: input.isFixedAsset,
    })
    .onConflictDoNothing()
    .returning({ id: invoices.id });

  return inv?.id ?? null;
}

export interface ReplaceLinesInput {
  invoiceId: string;
  supplierId: string;
  invoiceDate: Date | null;
  /** صافي الفاتورة — مرساةُ تسوية البنود */
  subtotalMinor: number | null;
  lines: readonly Partial<RawLine>[];
}

/**
 * يكتب بنود الفاتورة بعد تسويتها.
 *
 * خطوتان: تسوية كل سطر على حدة (خصم داخل السطر أو ضريبة)، ثم تسوية البنود
 * كلّها بصافي فاتورتها — فالسطر وحده لا يُعرف أصافٍ هو أم شامل للضريبة،
 * ومجموع البنود مقابل الصافي يحسم الأمر بلا تخمين.
 *
 * وتُكتب البنود بديلاً عمّا قبلها، فإعادة التشغيل لا تُضاعفها.
 */
export async function replaceLines(tx: Tx, input: ReplaceLinesInput): Promise<number> {
  await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, input.invoiceId));

  const resolved: (NonNullable<ReturnType<typeof resolveLinePricing>> & {
    description: string;
    quantity: number;
  })[] = [];

  for (const l of input.lines) {
    const description = l.description?.trim();
    if (!description) continue;
    const quantity = Number((l.quantity ?? "1").replace(/[^\d.]/g, "")) || 1;
    // السطر بلا سعر ولا مبلغ لا يُسجَّل — صفرٌ مخترع يفسد كل متوسط بعده
    const pricing = resolveLinePricing({
      quantity,
      unitPriceMinor: parseRiyals(l.unitPrice ?? ""),
      lineTotalMinor: parseRiyals(l.lineTotal ?? ""),
    });
    if (!pricing) continue;
    resolved.push({ ...pricing, description, quantity });
  }

  const { lines } = reconcileInvoiceLines(resolved, input.subtotalMinor);

  for (const l of lines) {
    await tx.insert(invoiceLines).values({
      invoiceId: input.invoiceId,
      description: l.description,
      normalizedDescription: normalizeItem(l.description),
      qty: String(l.quantity),
      unitPriceMinor: l.effectiveUnitMinor,
      lineTotalMinor: l.netTotalMinor,
      listUnitPriceMinor: l.listUnitMinor,
      discountMinor: l.discountMinor,
      pricingBasis: l.basis,
      invoiceDate: input.invoiceDate,
      supplierId: input.supplierId,
    });
  }

  return lines.length;
}

/** سطر كشفٍ كما قرأه النموذج — قبل أي مطابقة. */
export interface RawStatementLine {
  date: Date;
  ref: string | null;
  description: string | null;
  debitMinor: number;
  creditMinor: number;
}

export interface CreateStatementInput {
  documentId: string;
  supplierId: string;
  periodEnd: Date;
  /** `null` تعني «لم يُقرأ» لا «صفر» — والصفر الكاذب يقول إنّ المورّد لا يطالبنا */
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  /** أسطر الكشف كما استُخرجت. فارغةٌ تعني «لم تُقرأ»، ولا تُختلق. */
  lines?: readonly RawStatementLine[];
}

/**
 * يقيّد كشف مورّد — بأسطره.
 *
 * كانت الأسطر تُستخرَج ثمّ تُرمى: يُحفَظ الرصيد الختاميّ وحده. فبقيت
 * `statement_lines` فارغةً في أحد عشر كشفاً، والمطابقة مستحيلةٌ لأنّ ما
 * يُطابَق غير موجود — ثمّ يُقال في البوّابة «لم يُطابَق منها واحد» كأنّ
 * التقصير من صاحب المقهى. والكشف بلا أسطره ورقةٌ برقم.
 *
 * والفترة تُشتقّ من تواريخ الأسطر حين تُقرأ، لا من شهر تاريخ الكشف:
 * كشف «أوراق الزيتون» تراكميّ (مايو–أغسطس)، فاشتقاق الشهر من آخره
 * أنتج ٣٦ فاتورة «مفقودة» كذباً.
 */
export async function createStatement(tx: Tx, input: CreateStatementInput): Promise<void> {
  const lines = input.lines ?? [];

  const start =
    lines.length > 0
      ? new Date(Math.min(...lines.map((l) => l.date.getTime())))
      : new Date(Date.UTC(input.periodEnd.getUTCFullYear(), input.periodEnd.getUTCMonth(), 1));

  const end =
    lines.length > 0
      ? new Date(Math.max(input.periodEnd.getTime(), ...lines.map((l) => l.date.getTime())))
      : input.periodEnd;

  const [row] = await tx
    .insert(statements)
    .values({
      documentId: input.documentId,
      supplierId: input.supplierId,
      periodStart: start,
      periodEnd: end,
      openingBalanceMinor: input.openingBalanceMinor,
      closingBalanceMinor: input.closingBalanceMinor,
    })
    .returning({ id: statements.id });

  if (!row) return;

  for (const l of lines) {
    await tx.insert(statementLines).values({
      statementId: row.id,
      date: l.date,
      ref: l.ref,
      description: l.description,
      debitMinor: l.debitMinor,
      creditMinor: l.creditMinor,
    });
  }
}
