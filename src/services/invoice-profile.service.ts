/**
 * ملفّ الفاتورة — كلُّ ما يُعرَف عن فاتورةٍ واحدة في قراءةٍ واحدة.
 *
 * كانت الفاتورة محورَ النظام ولا صفحةَ لها: البحثُ عنها يفتح صفحةَ
 * مورّدها فيفتّش صاحبُ المقهى من جديد، وسببُ نقصها لوحٌ فوق قائمةٍ
 * مرشَّحة، وما دُفع لها ومن أيّ حوالةٍ لا يُرى إلّا من صفحة البنك،
 * وما قرأه النموذج منها وبأيّ ثقةٍ لا يُرى أبداً.
 *
 * فهذا يجمع ستّة أسئلة: ما هي · ممّ تكوّنت (وأتغيّر سعرٌ فيها) · كم
 * دُفع لها ومن أين · من أين جاءت ومن قرأها · أين ظهرت في كشف المورّد ·
 * وما الذي وقع عليها. وكلُّ رقمٍ فيه من القاعدة لا من المتصفّح.
 */
import { and, asc, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs, documents, invoices, paymentAllocations,
  payments, statementLines, statements, suppliers, users,
} from "@/db/schema";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { priceMove, type PriceMove } from "@/lib/invoice-profile";
import { usualPrices } from "@/lib/price-watch";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { loadPriceLines } from "./price-watch.service";

/**
 * نافذةُ «فاتورةٌ بالمبلغ نفسه من المورّد نفسه» — يومٌ قبلها وبعدها.
 *
 * قيست على البيانات: بنافذة أسبوع تلتقط ٢٨ فاتورة، أكثرُها طلبُ بيكوف
 * المتكرّر (١٥٠ ريالاً كلّ يومين) — ضجيجٌ يُعلّم صاحبَ المقهى أن يتجاهل
 * التحذير. وبيومٍ واحد ستٌّ: ثلاثةُ أزواجٍ في اليوم نفسه، وهي ما يستحقّ نظرة.
 */
export const TWIN_WINDOW_DAYS = 1;

export interface InvoiceProfile {
  invoice: {
    id: string;
    number: string;
    date: Date;
    month: string;
    subtotalMinor: number | null;
    vatMinor: number | null;
    totalMinor: number;
    /** خصمٌ على الإجماليّ بعد الضريبة — `null` لا خصم */
    discountMinor: number | null;
    /** رسومٌ بعد الضريبة (توصيل · شحن) — `null` لا رسوم */
    chargesMinor: number | null;
    sellerVat: string | null;
    buyerVat: string | null;
    taxStatus: string;
    inputVatStatus: string;
    isFixedAsset: boolean;
    carriedForwardFrom: string | null;
    receivedOn: string | null;
    createdAt: Date;
  };
  supplier: {
    id: string;
    nameAr: string;
    slug: string;
    issuesInvoices: boolean;
    contractOnFile: boolean;
    /** رقمُه الضريبيّ — فارغٌ لمورّدٍ بلا شهادةٍ ضريبيّة (`invoice-tax-display.ts`). */
    vatNumber: string | null;
  };
  document: {
    id: string;
    fileName: string;
    kind: string;
    status: string;
    driveFileId: string | null;
    /** `STATEMENT_LINE`: قُيِّدت من كشف المورّد ولا ملفَّ لها (057) */
    origin: string | null;
    mimeType: string;
    textSource: string | null;
    extractionModel: string | null;
    fieldConfidence: Record<string, number> | null;
    uploadedAt: Date;
    uploadedBy: string | null;
  };
  lines: {
    id: string;
    description: string;
    /** `null` = لم تُقرأ */
    qty: string | null;
    unitPriceMinor: number;
    lineTotalMinor: number;
    discountMinor: number;
    pricingBasis: string | null;
    move: PriceMove | null;
  }[];
  allocations: {
    paymentId: string;
    amountMinor: number;
    paidAt: Date;
    paymentAmountMinor: number;
    method: string;
    status: string;
    bankTxId: string | null;
  }[];
  paidMinor: number;
  remainingMinor: number;
  settled: boolean;
  statementLines: {
    id: string;
    date: Date;
    ref: string | null;
    debitMinor: number;
    matchStatus: string;
    periodStart: Date;
    periodEnd: Date;
  }[];
  twins: { id: string; number: string; date: Date; totalMinor: number; createdAt: Date; fileName: string; driveFileId: string | null; origin: string | null }[];
  history: {
    id: string;
    action: string;
    at: Date;
    actor: string | null;
    after: unknown;
  }[];
}

export async function loadInvoiceProfile(id: string): Promise<InvoiceProfile | null> {
  const [head] = await db
    .select({
      invoice: invoices,
      supplier: {
        id: suppliers.id,
        nameAr: suppliers.nameAr,
        slug: suppliers.slug,
        issuesInvoices: suppliers.issuesInvoices,
        contractOnFile: suppliers.contractOnFile,
        vatNumber: suppliers.vatNumber,
      },
      document: {
        id: documents.id,
        fileName: documents.fileName,
        kind: documents.kind,
        status: documents.status,
        driveFileId: documents.driveFileId,
        origin: documents.origin,
        mimeType: documents.mimeType,
        textSource: documents.textSource,
        extractionModel: documents.extractionModel,
        fieldConfidence: documents.fieldConfidence,
        uploadedAt: documents.uploadedAt,
      },
      uploadedBy: users.name,
    })
    .from(invoices)
    .innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .innerJoin(documents, eq(documents.id, invoices.documentId))
    .leftJoin(users, eq(users.id, documents.uploadedById))
    .where(eq(invoices.id, id))
    .limit(1);

  if (!head) return null;
  const inv = head.invoice;

  const [lines, allocs, stmt, twins, history] = await Promise.all([
    /*
      البندُ، وسعرُه المعتاد قبل هذه الفاتورة يُحسب بعدها من تاريخ المورّد (`usualPrices`)
      — لا آخرُ سطرٍ قُيِّد: قراءةٌ خاطئةٌ واحدة كانت تجعل كلَّ فاتورةٍ بعدها «ارتفاعاً».
    */
    db.execute<{
      id: string; description: string; normalized: string; qty: string | null; unit_price_minor: number;
      line_total_minor: number; discount_minor: number; pricing_basis: string | null;
    }>(sql`
      select l.id, l.description, l.normalized_description as normalized, l.qty::text as qty, l.unit_price_minor,
             l.line_total_minor, l.discount_minor, l.pricing_basis
        from invoice_lines l
       where l.invoice_id = ${inv.id}
       order by l.line_total_minor desc
    `),

    db
      .select({
        paymentId: payments.id,
        amountMinor: paymentAllocations.amountMinor,
        paidAt: payments.paidAt,
        paymentAmountMinor: payments.amountMinor,
        method: payments.method,
        status: payments.status,
        bankTxId: sql<string | null>`(
          select bt.id from bank_transactions bt where bt.matched_payment_id = ${payments}.id limit 1
        )`,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(eq(paymentAllocations.invoiceId, inv.id))
      .orderBy(asc(payments.paidAt)),

    db
      .select({
        id: statementLines.id,
        date: statementLines.date,
        ref: statementLines.ref,
        debitMinor: statementLines.debitMinor,
        matchStatus: statementLines.matchStatus,
        periodStart: statements.periodStart,
        periodEnd: statements.periodEnd,
      })
      .from(statementLines)
      .innerJoin(statements, eq(statements.id, statementLines.statementId))
      .where(eq(statementLines.matchedInvoiceId, inv.id))
      .orderBy(desc(statements.periodEnd)),

    /*
      فاتورةٌ أخرى من المورّد نفسه بالإجمالي نفسه في أسبوعٍ حولها. كشفٌ
      لا حكم — قد تكونان توريدَين حقيقيَّين. لكنّ مَن يسدّد الاثنتين دون
      أن يرى الأخرى يدفع مرّتين.
    */
    db
      .select({
        id: invoices.id, number: invoices.invoiceNumber, date: invoices.invoiceDate, totalMinor: invoices.totalMinor,
        createdAt: invoices.createdAt, fileName: documents.fileName, driveFileId: documents.driveFileId, origin: documents.origin,
      })
      .from(invoices)
      .innerJoin(documents, eq(documents.id, invoices.documentId))
      .where(and(
        eq(invoices.supplierId, inv.supplierId),
        eq(invoices.totalMinor, inv.totalMinor),
        ne(invoices.id, inv.id),
        sql`abs(extract(epoch from (${invoices.invoiceDate} - ${inv.invoiceDate}::timestamptz))) <= ${TWIN_WINDOW_DAYS * 86400}`,
      ))
      .limit(5),

    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        at: auditLogs.at,
        actor: users.name,
        after: auditLogs.after,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(or(
        and(eq(auditLogs.entityType, "invoice"), eq(auditLogs.entityId, inv.id)),
        and(eq(auditLogs.entityType, "document"), eq(auditLogs.entityId, inv.documentId)),
      ))
      .orderBy(desc(auditLogs.at))
      .limit(30),
  ]);

  /* تاريخُ المورّد قبل هذه الفاتورة وحده — فلا تُقاس الفاتورةُ بنفسها ولا بما جاء بعدها */
  const invDay = todayInRiyadh(inv.invoiceDate);
  const before = (await loadPriceLines({ supplierId: inv.supplierId }))
    .filter((l) => l.invoiceId !== inv.id && l.day <= invDay);
  const usual = usualPrices(lines.rows.map((l) => l.normalized), before, invDay);

  const allocations = allocs.map((a) => ({ ...a, bankTxId: a.bankTxId ?? null }));
  /* المردودةُ والملغاة لا تُحسَب سداداً — التخصيصُ عليها يبقى أثراً لا مالاً */
  const paidMinor = allocations
    .filter((a) => a.status !== "REVERSED" && a.status !== "VOID")
    .reduce((s, a) => s + a.amountMinor, 0);
  const remainingMinor = inv.totalMinor - paidMinor;

  const fc = head.document.fieldConfidence;
  return {
    invoice: {
      id: inv.id,
      number: inv.invoiceNumber,
      date: inv.invoiceDate,
      month: inv.periodMonth,
      subtotalMinor: inv.subtotalMinor,
      vatMinor: inv.vatMinor,
      totalMinor: inv.totalMinor,
      discountMinor: inv.discountMinor,
      chargesMinor: inv.chargesMinor,
      sellerVat: inv.sellerVat,
      buyerVat: inv.buyerVat,
      taxStatus: inv.taxStatus,
      inputVatStatus: inv.inputVatStatus,
      isFixedAsset: inv.isFixedAsset,
      carriedForwardFrom: inv.carriedForwardFrom,
      receivedOn: inv.receivedOn,
      createdAt: inv.createdAt,
    },
    supplier: head.supplier,
    document: {
      ...head.document,
      fieldConfidence: fc && typeof fc === "object" && !Array.isArray(fc)
        ? Object.fromEntries(
            Object.entries(fc as Record<string, unknown>).filter(([, v]) => typeof v === "number"),
          ) as Record<string, number>
        : null,
      uploadedBy: head.uploadedBy,
    },
    lines: lines.rows.map((l) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      unitPriceMinor: Number(l.unit_price_minor),
      lineTotalMinor: Number(l.line_total_minor),
      discountMinor: Number(l.discount_minor),
      pricingBasis: l.pricing_basis,
      move: (() => {
        const u = usual.get(l.normalized);
        /* بندٌ لم تُقرأ كمّيّتُه أو لا يستقيم ضربُه لا سعرَ وحدةٍ له يُقارَن */
        if (!u || l.pricing_basis === "QTY_UNREAD" || l.pricing_basis === "INCONSISTENT" || Number(l.unit_price_minor) <= 0) return null;
        return priceMove(Number(l.unit_price_minor), {
          unitPriceMinor: u.minor,
          date: new Date(`${u.day}T00:00:00Z`),
          invoiceNumber: u.invoiceNumber,
          invoiceId: u.invoiceId || undefined,
        });
      })(),
    })),
    allocations,
    paidMinor,
    remainingMinor,
    settled: remainingMinor <= SETTLED_TOLERANCE_MINOR,
    statementLines: stmt,
    twins,
    history,
  };
}

/** الفاتورتان المجاورتان في قائمة المورّد — للتنقّل بلا عودةٍ إلى القائمة. */
export async function neighbours(
  supplierId: string,
  date: Date,
  id: string,
): Promise<{ older: string | null; newer: string | null }> {
  const [older, newer] = await Promise.all([
    db.select({ id: invoices.id }).from(invoices)
      .where(and(
        eq(invoices.supplierId, supplierId),
        or(lt(invoices.invoiceDate, date), and(eq(invoices.invoiceDate, date), lt(invoices.id, id))),
      ))
      .orderBy(desc(invoices.invoiceDate), desc(invoices.id))
      .limit(1),
    db.select({ id: invoices.id }).from(invoices)
      .where(and(
        eq(invoices.supplierId, supplierId),
        or(sql`${invoices.invoiceDate} > ${date}`, and(eq(invoices.invoiceDate, date), sql`${invoices.id} > ${id}`)),
      ))
      .orderBy(asc(invoices.invoiceDate), asc(invoices.id))
      .limit(1),
  ]);
  return { older: older[0]?.id ?? null, newer: newer[0]?.id ?? null };
}
