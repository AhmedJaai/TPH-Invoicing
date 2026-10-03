/**
 * «فاتورةٌ مصحَّحة» — المورّدُ أعاد إصدارَ الفاتورة برقمها نفسه ومبلغٍ آخر (خصمٌ بعد التسعير).
 *
 * أوراق الزيتون (٣ أكتوبر ٢٠٢٦): 260340 · 260342 · 260351 أُعيد إصدارُها بخصم (١٤٠←١٣٠، ٢٨٠←٢٦٠)،
 * فحذف أحمد القديمة من الدرايف ورفع الجديدة — فقال النظام «نسخةٌ من المقيَّدة — ارفضها» ولا
 * طريقَ غيره: الرقمُ نفسُه عنده نسخةٌ دائماً.
 *
 * والمصحَّحة لا تُقيَّد ثانيةً ولا تُرفض: **تحلّ محلّ المقيَّدة**. القيدُ نفسُه (معرّفُه، وما
 * خُصّص عليه، وسطرُه في كشف المورّد) ينتقل إلى المستند الجديد بقراءته — المبالغُ والبنود
 * والحكمُ الضريبيّ — والمستندُ القديم يُرفض بسببه ويبقى في السجلّ. وما سُدِّد من القديمة فوق
 * مبلغ الجديدة يعود رصيداً للمورّد (الأحدثُ أوّلاً) ولا يُفقد.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { documents, invoices, paymentAllocations, payments, statementLines, suppliers } from "@/db/schema";
import { reviewConfirmed } from "@/lib/confirm";
import { normalizeDocumentDate } from "@/lib/document-date";
import { parseRiyals } from "@/lib/money";
import { companyConfig } from "@/config/drive";
import { recordAudit } from "@/lib/audit";
import { invoiceNumberKey } from "@/lib/invoice-twin";
import { amountAgrees } from "@/lib/statement-match";
import { assertMonthsOpen } from "./month-guard";
import { postVatOf, replaceLines } from "./invoice.service";
import { refreshPaymentStatus } from "./payment.service";
import { applySupplierCredit } from "./supplier-credit.service";
import { refreshStatementFindings } from "./statement-reconcile.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import type { StoredReading } from "./document-backlog.service";
import type { Tx } from "./types";

export class ReplaceRefused extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "ReplaceRefused";
  }
}

export interface ReplaceOutcome {
  invoiceId: string;
  invoiceNumber: string;
  beforeMinor: number;
  afterMinor: number;
  /** ما سُدِّد فوق المبلغ الجديد وعاد رصيداً للمورّد */
  releasedMinor: number;
  oldDocumentId: string;
  driveFileId: string | null;
}

export async function replaceWithCorrectedInvoice(tx: Tx, documentId: string, actorId: string): Promise<ReplaceOutcome> {
  const [doc] = await tx.select({
    id: documents.id, fileName: documents.fileName, status: documents.status, kind: documents.kind,
    supplierId: documents.supplierId, reading: documents.extractionJson, driveFileId: documents.driveFileId,
  }).from(documents).where(eq(documents.id, documentId)).for("update").limit(1);
  if (!doc) throw new ReplaceRefused("لا يوجد هذا المستند", 404);
  if (doc.status === "REJECTED") throw new ReplaceRefused("المستندُ مرفوض — أعِده إلى المراجعة أوّلاً");
  const [own] = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.documentId, doc.id)).limit(1);
  if (own) throw new ReplaceRefused("له فاتورةٌ مقيَّدة من قبل");
  if (!doc.supplierId) throw new ReplaceRefused("لم يُعرف مورّدُه — قيّده من «عاينها وقيّدها»");

  const r = (doc.reading ?? null) as StoredReading | null;
  const number = (r?.invoiceNumber ?? "").trim();
  const totalMinor = parseRiyals(r?.totalAmount ?? "");
  const date = normalizeDocumentDate(r?.invoiceDate ?? "");
  if (!number || totalMinor === null) throw new ReplaceRefused("لم يُقرأ رقمُه أو إجماليُّه — أعِد قراءته أوّلاً");

  /* القديمةُ: الرقمُ نفسُه بأيّ صيغة، لمورّدها، ولها ملفّ (لا قيدُ سطر كشف) */
  const key = invoiceNumberKey(number);
  const old = (await tx.select({
    id: invoices.id, number: invoices.invoiceNumber, total: invoices.totalMinor, date: invoices.invoiceDate,
    month: invoices.periodMonth, documentId: invoices.documentId, docName: documents.fileName,
  }).from(invoices)
    .innerJoin(documents, and(eq(documents.id, invoices.documentId), isNull(documents.origin)))
    .where(eq(invoices.supplierId, doc.supplierId)))
    .find((o) => invoiceNumberKey(o.number) === key);
  if (!old) throw new ReplaceRefused("لا فاتورةَ مقيَّدة بهذا الرقم لمورّده — قيّدها فاتورةً جديدة");
  if (old.total === totalMinor) throw new ReplaceRefused("المبلغُ نفسُه — هذه نسخةٌ لا تصحيح: ارفضها");

  const invoiceDate = date ? new Date(`${date}T00:00:00Z`) : old.date;
  const month = date ? date.slice(0, 7) : old.month;
  await assertMonthsOpen(tx, [old.month, month]);

  const [supplier] = await tx.select({ issuesInvoices: suppliers.issuesInvoices, contractOnFile: suppliers.contractOnFile })
    .from(suppliers).where(eq(suppliers.id, doc.supplierId)).limit(1);
  const subtotalMinor = parseRiyals(r?.subtotalAmount ?? "");
  const vatMinor = parseRiyals(r?.vatAmount ?? "");
  const kind = doc.kind === "SIMPLIFIED_INVOICE" ? "SIMPLIFIED_INVOICE" as const : "TAX_INVOICE" as const;
  const review = reviewConfirmed(
    {
      documentKind: kind, supplierId: doc.supplierId, invoiceNumber: old.number, invoiceDate: date ?? old.date.toISOString().slice(0, 10),
      subtotalMinor, vatMinor, totalMinor,
      discountMinor: parseRiyals(r?.discountAmount ?? ""), chargesMinor: parseRiyals(r?.chargesAmount ?? ""),
      sellerVat: r?.sellerVatNumber?.trim() || null, buyerVat: r?.buyerVatNumber?.trim() || null,
    },
    { companyVat: companyConfig.vatNumber, supplierIssuesInvoices: supplier?.issuesInvoices, supplierContractOnFile: supplier?.contractOnFile },
  );
  const postVat = postVatOf({ subtotalMinor, vatMinor, totalMinor, discountReadMinor: parseRiyals(r?.discountAmount ?? ""), chargesReadMinor: parseRiyals(r?.chargesAmount ?? "") });

  /* ما سُدِّد فوق المبلغ الجديد يعود رصيداً — الأحدثُ تخصيصاً أوّلاً */
  let excess = (await tx.select({ a: paymentAllocations.amountMinor }).from(paymentAllocations).where(eq(paymentAllocations.invoiceId, old.id)))
    .reduce((s, x) => s + x.a, 0) - totalMinor;
  const released = Math.max(0, excess);
  if (excess > 0) {
    const allocs = await tx.select({ id: paymentAllocations.id, paymentId: paymentAllocations.paymentId, amount: paymentAllocations.amountMinor })
      .from(paymentAllocations).innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(eq(paymentAllocations.invoiceId, old.id)).orderBy(desc(payments.paidAt));
    const touched = new Set<string>();
    for (const a of allocs) {
      if (excess <= 0) break;
      const cut = Math.min(a.amount, excess);
      if (cut === a.amount) await tx.delete(paymentAllocations).where(eq(paymentAllocations.id, a.id));
      else await tx.update(paymentAllocations).set({ amountMinor: a.amount - cut }).where(eq(paymentAllocations.id, a.id));
      excess -= cut;
      touched.add(a.paymentId);
    }
    for (const p of touched) await refreshPaymentStatus(tx, p);
  }

  await tx.update(invoices).set({
    documentId: doc.id,
    invoiceDate,
    periodMonth: month,
    subtotalMinor,
    vatMinor,
    totalMinor,
    discountMinor: postVat.discountMinor,
    chargesMinor: postVat.chargesMinor,
    sellerVat: r?.sellerVatNumber?.trim() || null,
    buyerVat: r?.buyerVatNumber?.trim() || null,
    taxStatus: review.taxStatus,
    inputVatStatus: review.inputVatStatus,
    isFixedAsset: review.isFixedAsset,
  }).where(eq(invoices.id, old.id));
  await replaceLines(tx, { invoiceId: old.id, supplierId: doc.supplierId, invoiceDate, subtotalMinor, lines: r?.lines ?? [] });

  await tx.update(documents).set({ status: "REJECTED" }).where(eq(documents.id, old.documentId));
  await tx.update(documents).set({ status: "ARCHIVED", kind, periodMonth: month }).where(eq(documents.id, doc.id));

  /* سطرُه في كشف المورّد: يُعاد حكمُه بالمبلغ الجديد، وتُعاد تنبيهاتُ كشفه */
  const lines = await tx.select({ id: statementLines.id, statementId: statementLines.statementId, debit: statementLines.debitMinor })
    .from(statementLines).where(eq(statementLines.matchedInvoiceId, old.id));
  const statementIds = [...new Set(lines.map((l) => l.statementId))];
  for (const l of lines) {
    const agrees = amountAgrees({ totalMinor, subtotalMinor, grossMinor: null }, l.debit);
    await tx.update(statementLines).set({ matchStatus: agrees ? "MATCHED" : "DISPUTED" }).where(eq(statementLines.id, l.id));
  }
  for (const s of statementIds) await refreshStatementFindings(tx, s);

  await applySupplierCredit(tx, doc.supplierId, { forwardDays: SETTLEMENT_FORWARD_DAYS });

  await recordAudit({
    actorId,
    action: "INVOICE_REPLACED",
    entityType: "invoice",
    entityId: old.id,
    before: { المستند: old.documentId, الملف: old.docName, الإجمالي: old.total },
    after: {
      المستند: doc.id, الملف: doc.fileName, الإجمالي: totalMinor, الحال_الضريبية: review.taxStatus,
      عاد_رصيداً: released,
      السبب: "فاتورةٌ مصحَّحة برقمها نفسه — حلّت محلّ المقيَّدة، والقديمةُ رُفضت",
    },
  }, tx);
  return { invoiceId: old.id, invoiceNumber: old.number, beforeMinor: old.total, afterMinor: totalMinor, releasedMinor: released, oldDocumentId: old.documentId, driveFileId: doc.driveFileId };
}
