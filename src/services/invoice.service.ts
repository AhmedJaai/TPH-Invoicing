/**
 * خدمة الفواتير: القيد والبنود وأسعارها.
 *
 * تسوية البنود بصافي الفاتورة تجري هنا لا في كل مسار على حدة، لأنّ ثلاثة
 * مسارات تُنشئ فواتير — الأرشفة والمزامنة وقراءة المحتوى — وافتراقها في
 * حساب السعر أنتج «ارتفاع أسعار ١٥٪» لم يقع.
 */
import { eq, inArray } from "drizzle-orm";
import { invoiceLines, invoices, statementLines, statements } from "@/db/schema";
import { normalizeItem } from "@/lib/items";
import { parseLineQuantity, reconcileInvoiceLines, resolveLinePricing } from "@/lib/line-pricing";
import { parseRiyals } from "@/lib/money";
import type { InputVatStatus, TaxStatus } from "@/lib/validation";
import type { RawLine, Tx } from "./types";
import { assertMonthsOpen } from "./month-guard";
import { buildSupplierProducts } from "./product.service";

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
  await assertMonthsOpen(tx, [input.periodMonth]);

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
  /*
    ── البندُ يُحدَّث في مكانه، لا يُحذَف ويُعاد ──

    كان يُحذَف كلُّه ويُكتَب بمعرّفاتٍ جديدة، فالاستلامُ اليدويّ المربوط ببندٍ
    (`inventory_receipts.invoice_line_id`، ‏SET NULL) ينفكّ صامتاً مع كلّ إعادة
    قراءة — فيُحسَب البندُ الجديد والاستلامُ معاً: البضاعةُ نفسُها مرّتين. وفي
    أسبوعٍ مقفَل يرفض القيدُ الفكَّ فتفشل إعادةُ القراءة بخطأٍ عن الجرد.
    فالقديمُ يُطابَق بالجديد بوصفه المطبَّع، ويبقى معرّفُه وكلُّ ما يشير إليه.
  */
  const previous = await tx.select({ id: invoiceLines.id, normalized: invoiceLines.normalizedDescription })
    .from(invoiceLines).where(eq(invoiceLines.invoiceId, input.invoiceId)).orderBy(invoiceLines.id);

  const resolved: (NonNullable<ReturnType<typeof resolveLinePricing>> & {
    description: string;
    quantity: number;
    /** كما كُتبت — أو `null` إن لم تُقرأ */
    qtyText: string | null;
  })[] = [];

  for (const l of input.lines) {
    const description = l.description?.trim();
    if (!description) continue;
    const qtyText = parseLineQuantity(l.quantity);
    const quantity = qtyText === null ? 1 : Number(qtyText);
    // السطر بلا سعر ولا مبلغ لا يُسجَّل — صفرٌ مخترع يفسد كل متوسط بعده
    const priced = resolveLinePricing({
      quantity,
      unitPriceMinor: parseRiyals(l.unitPrice ?? ""),
      lineTotalMinor: parseRiyals(l.lineTotal ?? ""),
    });
    if (!priced) continue;
    /* بلا كمّيّةٍ لا يُعرف أيّ الرقمين سعرُ الوحدة — فلا يدخل تتبّعَ الأسعار */
    const pricing = qtyText === null ? { ...priced, basis: "QTY_UNREAD" as const } : priced;
    resolved.push({ ...pricing, description, quantity, qtyText });
  }

  const { lines } = reconcileInvoiceLines(resolved, input.subtotalMinor);
  /* قراءةٌ لا بندَ مسعَّراً فيها لا تمحو بنوداً صالحة — «لم يُقرأ» ليس «لا بنود» */
  if (lines.length === 0 && previous.length > 0) return 0;

  const reusable = new Map<string, string[]>();
  for (const p of previous) reusable.set(p.normalized, [...(reusable.get(p.normalized) ?? []), p.id]);
  const kept = new Set<string>();

  for (const l of lines) {
    const normalizedDescription = normalizeItem(l.description);
    const values = {
      description: l.description,
      normalizedDescription,
      qty: l.qtyText,
      unitPriceMinor: l.effectiveUnitMinor,
      lineTotalMinor: l.netTotalMinor,
      listUnitPriceMinor: l.listUnitMinor,
      discountMinor: l.discountMinor,
      pricingBasis: l.basis,
      invoiceDate: input.invoiceDate,
      supplierId: input.supplierId,
    };
    const reuse = reusable.get(normalizedDescription)?.shift();
    if (reuse) {
      kept.add(reuse);
      await tx.update(invoiceLines).set(values).where(eq(invoiceLines.id, reuse));
    } else {
      await tx.insert(invoiceLines).values({ invoiceId: input.invoiceId, ...values });
    }
  }

  const gone = previous.filter((p) => !kept.has(p.id)).map((p) => p.id);
  if (gone.length > 0) await tx.delete(invoiceLines).where(inArray(invoiceLines.id, gone));

  /* كلُّ بندٍ إلى صنف مورّده — فالربطُ المؤكَّد بصنف الجرد يصل الفاتورةَ الجديدة وحده */
  if (lines.length > 0) await buildSupplierProducts(tx, input.invoiceId);

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
