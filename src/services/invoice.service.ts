/**
 * خدمة الفواتير: القيد والبنود وأسعارها.
 *
 * تسوية البنود بصافي الفاتورة تجري هنا لا في كل مسار على حدة، لأنّ ثلاثة
 * مسارات تُنشئ فواتير — الأرشفة والمزامنة وقراءة المحتوى — وافتراقها في
 * حساب السعر أنتج «ارتفاع أسعار ١٥٪» لم يقع.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { invoiceLines, invoices, statementLines, statements, supplierItemAliases } from "@/db/schema";
import { normalizeItem } from "@/lib/items";
import { parseLineQuantity, reconcileInvoiceLines, resolveLinePricing } from "@/lib/line-pricing";
import { checkInvoiceTotals, parseRiyals } from "@/lib/money";
import type { InputVatStatus, TaxStatus } from "@/lib/validation";
import type { Conn, RawLine, Tx } from "./types";
import { assertMonthsOpen } from "./month-guard";
import { monthOf } from "@/lib/filing";
import { buildSupplierProducts } from "./product.service";
import { matchLateInvoice } from "./statement-late-match.service";

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
  /**
   * الخصمُ كما قُرئ على الفاتورة — قبل الضريبة كان أو بعدها. والخادمُ يحكم
   * (`checkInvoiceTotals`): يُكتب خصماً بعد الضريبة إن كان هو ما يفسّر الفرق وحده.
   */
  discountReadMinor?: number | null;
  /** الرسومُ بعد الضريبة كما قُرئت (توصيل · شحن) — بالحكم نفسه */
  chargesReadMinor?: number | null;
  sellerVat?: string | null;
  buyerVat?: string | null;
  taxStatus: TaxStatus;
  inputVatStatus: InputVatStatus;
  isFixedAsset: boolean;
}

/**
 * شهرُ الفاتورة المحاسبيّ: شهرُ تاريخها — لا مجلّدُ الدرايف ولا يومُ رفعها.
 *
 * كانت المزامنةُ والطابور وتسجيلُ المستند يأخذون شهرَ المجلّد: فاتورةُ أغسطس في
 * مجلّد سبتمبر تُحسَب في سبتمبر، وأغسطس ناقصٌ بها وإقفالُه لا يراها. والرفعُ
 * يشتقّه من التاريخ منذ البداية — فصار الحكمُ هنا لكلّ باب. والشهرُ المُمرَّر
 * احتياطٌ لتاريخٍ لا يُقرأ. والمقفلُ يُرفَض كما كان: ترحيلُ دَينٍ إلى شهرٍ آخر
 * قرارُ صاحبه لا الآلة.
 */
export function filingMonthFor(invoiceDate: Date, fallbackMonth: string): string {
  return Number.isNaN(invoiceDate.getTime()) ? fallbackMonth : monthOf(invoiceDate);
}

/** ما يُحفظ من الخصم والرسوم بعد الضريبة — ما فسّر الفرقَ وحده، وإلّا فراغ. */
function postVatOf(input: Pick<CreateInvoiceInput, "subtotalMinor" | "vatMinor" | "totalMinor" | "discountReadMinor" | "chargesReadMinor">) {
  if (input.subtotalMinor === null || input.vatMinor === null) return { discountMinor: null, chargesMinor: null };
  const t = checkInvoiceTotals(input.subtotalMinor, input.vatMinor, input.totalMinor, {
    discountMinor: input.discountReadMinor, chargesMinor: input.chargesReadMinor,
  });
  return { discountMinor: t.discountMinor, chargesMinor: t.chargesMinor };
}

export async function createInvoice(tx: Tx, input: CreateInvoiceInput): Promise<string | null> {
  const periodMonth = filingMonthFor(input.invoiceDate, input.periodMonth);
  await assertMonthsOpen(tx, [periodMonth]);

  const [inv] = await tx
    .insert(invoices)
    .values({
      documentId: input.documentId,
      supplierId: input.supplierId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      periodMonth,
      subtotalMinor: input.subtotalMinor,
      vatMinor: input.vatMinor,
      totalMinor: input.totalMinor,
      ...postVatOf(input),
      sellerVat: input.sellerVat ?? null,
      buyerVat: input.buyerVat ?? null,
      taxStatus: input.taxStatus,
      inputVatStatus: input.inputVatStatus,
      isFixedAsset: input.isFixedAsset,
    })
    .onConflictDoNothing()
    .returning({ id: invoices.id });

  /* كشفٌ سبق الفاتورة وفيه سطرُها — يُطابَق الآن ولا ينتظر «أعِد المطابقة» */
  if (inv) {
    await matchLateInvoice(tx, {
      id: inv.id, supplierId: input.supplierId, invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate, totalMinor: input.totalMinor,
    });
  }

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
/** صيغُ أسماء أصناف المورّد المُقَرّة: الصيغة ← الأصل. */
export async function itemAliases(conn: Conn | Tx, supplierId: string | null): Promise<Map<string, string>> {
  if (!supplierId) return new Map();
  const rows = await conn
    .select({ alias: supplierItemAliases.aliasNormalized, canonical: supplierItemAliases.canonicalNormalized })
    .from(supplierItemAliases)
    .where(eq(supplierItemAliases.supplierId, supplierId));
  return new Map(rows.map((r) => [r.alias, r.canonical]));
}

export async function replaceLines(tx: Tx, input: ReplaceLinesInput): Promise<number> {
  /*
    ── البندُ يُحدَّث في مكانه، لا يُحذَف ويُعاد ──

    كان يُحذَف كلُّه ويُكتَب بمعرّفاتٍ جديدة، فالاستلامُ اليدويّ المربوط ببندٍ
    (`inventory_receipts.invoice_line_id`، ‏SET NULL) ينفكّ صامتاً مع كلّ إعادة
    قراءة — فيُحسَب البندُ الجديد والاستلامُ معاً: البضاعةُ نفسُها مرّتين. وفي
    أسبوعٍ مقفَل يرفض القيدُ الفكَّ فتفشل إعادةُ القراءة بخطأٍ عن الجرد.
    فالقديمُ يُطابَق بالجديد بوصفه المطبَّع، ويبقى معرّفُه وكلُّ ما يشير إليه.
  */
  const previous = await tx.select({
    id: invoiceLines.id, normalized: invoiceLines.normalizedDescription,
    qty: invoiceLines.qty, total: invoiceLines.lineTotalMinor,
  })
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

  /*
    بندان بالوصف نفسه («حليب» ×١٠ و«حليب» ×٢) لا يُقرنان بالترتيب: يُقدَّم القديمُ
    بالكمّيّة والإجماليّ نفسيهما، ثمّ بالكمّيّة، ثمّ ما بقي — وإلّا صار البندُ المربوط
    باستلامِ عشرةٍ بندَ اثنين، وحُسب الآخرُ عشرةً فوقه.
  */
  const reusable = new Map<string, typeof previous>();
  for (const p of previous) reusable.set(p.normalized, [...(reusable.get(p.normalized) ?? []), p]);
  const kept = new Set<string>();
  const sameQty = (a: string | null, b: string | null) => a !== null && b !== null && Number(a) === Number(b);
  const takeReusable = (normalized: string, qty: string | null, total: number): string | undefined => {
    const list = reusable.get(normalized);
    if (!list || list.length === 0) return undefined;
    const i = [
      list.findIndex((p) => sameQty(p.qty, qty) && p.total === total),
      list.findIndex((p) => sameQty(p.qty, qty)),
      0,
    ].find((x) => x >= 0)!;
    return list.splice(i, 1)[0].id;
  };

  /* صيغةٌ أقرّها إنسانٌ أنّها صنفٌ آخر لهذا المورّد تُكتب باسمه (056) */
  const canonical = await itemAliases(tx, input.supplierId);
  const plan: { reuse: string | undefined; values: Omit<typeof invoiceLines.$inferInsert, "invoiceId"> }[] = [];
  for (const l of lines) {
    const read = normalizeItem(l.description);
    const normalizedDescription = canonical.get(read) ?? read;
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
    const reuse = takeReusable(normalizedDescription, l.qtyText, l.netTotalMinor);
    if (reuse) kept.add(reuse);
    plan.push({ reuse, values });
  }

  /* الخطّةُ أوّلاً ثمّ الفحص ثمّ الكتابة — ما يُردّ لا يكتب قبل أن يُردّ */
  const gone = previous.filter((p) => !kept.has(p.id)).map((p) => p.id);
  if (gone.length > 0) {
    /*
      بندٌ ربطه صاحبُه باستلامٍ يدويّ ولم يرد في القراءة الجديدة لا يُحذف صامتاً:
      كان الربطُ ينفكّ (SET NULL) فيُحسَب الاستلامُ ثانيةً، أو تفشل القراءةُ في
      أسبوعٍ مقفَل بخطأٍ لا يُفهم. فيُردّ الاستبدالُ كلُّه ويُقال لماذا.
    */
    const [held] = (await tx.execute<{ description: string }>(sql`
      select il.description from invoice_lines il
       where il.id in (${sql.join(gone.map((g) => sql`${g}`), sql`, `)})
         and exists (select 1 from inventory_receipts r where r.invoice_line_id = il.id and r.voided_at is null)
       limit 1
    `)).rows;
    if (held) throw new InvoiceLinesRefused(
      `البندُ «${held.description}» مربوطٌ بكمّيّةٍ استُلمت بيدك، ولم يرد في القراءة الجديدة — فُكَّ ربطَه من الجرد أوّلاً، أو صحّح البنود بيدك.`,
    );
  }
  for (const { reuse, values } of plan) {
    if (reuse) await tx.update(invoiceLines).set(values).where(eq(invoiceLines.id, reuse));
    else await tx.insert(invoiceLines).values({ invoiceId: input.invoiceId, ...values });
  }
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

/** استبدالُ البنود يُردّ — يُقال نصُّه لصاحبه (بندٌ مربوطٌ باستلامٍ لم يرد في القراءة). */
export class InvoiceLinesRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceLinesRefused";
  }
}
