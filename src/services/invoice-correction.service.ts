/**
 * تصحيحُ فاتورةٍ مقيَّدة بيد الإنسان — حقولُها، وتاريخُها، ومورّدُها.
 *
 * القراءةُ الآليّة تُخطئ، والعلاجُ أن يُصحَّح ما أخطأت فيه لا أن يُرفَض المستندُ
 * الصحيح. وكان التاريخُ والمورّدُ لا يُصحَّحان أصلاً: فاتورةٌ قُرئ مورّدُها خطأً
 * لا مخرجَ لها إلّا الرفض — والرفضُ يمنعه سدادٌ خُصّص عليها.
 *
 * ── ما يُحرَس ──
 *   • حالُ الضريبة تُعاد اشتقاقها (`reviewConfirmed`) بمورّدها الجديد.
 *   • الشهرُ من التاريخ (`filingMonthFor`)، والقديمُ والجديدُ كلاهما مفتوح.
 *   • الإجماليّ لا ينزل دون ما خُصّص عليها (وقيدُ 048 خلفه).
 *   • **تغييرُ المورّد يفكّ سدادَ المورّد السابق عنها**: ذلك مالٌ دُفع لغيره.
 *     ثمّ يُخصم رصيدُ كلٍّ منهما بالسياسة الآليّة نفسها. وتتبعها بنودُها
 *     ومستندُها وأصنافُ مورّدها.
 *   • كلُّه في معاملةٍ واحدة مع سجلّ التدقيق.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { documents, invoiceLines, invoices, paymentAllocations, payments, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { formatRiyalsDisplay, checkInvoiceTotals } from "@/lib/money";
import { companyConfig } from "@/config/drive";
import { assertMonthsOpen } from "./month-guard";
import { filingMonthFor } from "./invoice.service";
import { buildSupplierProducts } from "./product.service";
import { refreshPaymentStatus } from "./payment.service";
import { applySupplierCredit } from "./supplier-credit.service";
import { reviewConfirmed } from "@/lib/confirm";
import type { Tx } from "./types";

export class InvoiceCorrectionRefused extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "InvoiceCorrectionRefused";
  }
}

/** غيابُ الحقل «اتركه»، و`null` «امحُه». */
export interface InvoiceCorrection {
  invoiceId: string;
  invoiceNumber?: string | null;
  sellerVat?: string | null;
  buyerVat?: string | null;
  subtotalMinor?: number | null;
  vatMinor?: number | null;
  totalMinor?: number | null;
  /** خصمٌ على الإجماليّ بعد الضريبة — يُقبل إن سدّ فرقَ الحساب وحده */
  discountMinor?: number | null;
  /** رسومٌ بعد الضريبة (توصيل · شحن) — بالحكم نفسه */
  chargesMinor?: number | null;
  /** YYYY-MM-DD */
  invoiceDate?: string;
  supplierId?: string;
}

const pick = <T>(v: T | undefined, current: T): T => (v === undefined ? current : v);
const text = (v: string | null | undefined, current: string | null) =>
  v === undefined ? current : v === null ? null : v.trim() === "" ? null : v.trim();

export async function correctInvoice(tx: Tx, input: InvoiceCorrection, actorId: string) {
  const [row] = await tx
    .select({
      id: invoices.id, documentId: invoices.documentId, documentKind: documents.kind,
      periodMonth: invoices.periodMonth, invoiceNumber: invoices.invoiceNumber,
      sellerVat: invoices.sellerVat, buyerVat: invoices.buyerVat,
      subtotalMinor: invoices.subtotalMinor, vatMinor: invoices.vatMinor, totalMinor: invoices.totalMinor,
      discountMinor: invoices.discountMinor,
      chargesMinor: invoices.chargesMinor,
      invoiceDate: invoices.invoiceDate, supplierId: invoices.supplierId,
    })
    .from(invoices)
    .leftJoin(documents, eq(documents.id, invoices.documentId))
    .where(eq(invoices.id, input.invoiceId))
    .for("update", { of: invoices })
    .limit(1);
  if (!row) throw new InvoiceCorrectionRefused("لا فاتورة بهذا المعرّف", 404);

  const date = input.invoiceDate ? new Date(`${input.invoiceDate}T00:00:00Z`) : row.invoiceDate;
  if (Number.isNaN(date.getTime())) throw new InvoiceCorrectionRefused("التاريخ لم يُفهم", 400);
  const supplierId = pick(input.supplierId, row.supplierId ?? undefined) ?? null;
  const supplierChanged = supplierId !== row.supplierId;

  const next = {
    invoiceNumber: text(input.invoiceNumber, row.invoiceNumber),
    sellerVat: text(input.sellerVat, row.sellerVat),
    buyerVat: text(input.buyerVat, row.buyerVat),
    subtotalMinor: pick(input.subtotalMinor, row.subtotalMinor),
    vatMinor: pick(input.vatMinor, row.vatMinor),
    totalMinor: pick(input.totalMinor, row.totalMinor),
  };
  if (!next.invoiceNumber) {
    throw new InvoiceCorrectionRefused("رقمُ الفاتورة لا يكون فارغاً. اكتب الرقم من الورقة، أو «بلا رقم» إن لم يكن لها رقم.", 400);
  }
  if (next.totalMinor === null || next.totalMinor <= 0) {
    throw new InvoiceCorrectionRefused("الإجماليّ لا يكون فارغاً ولا صفراً — فاتورةٌ بلا مبلغٍ لا معنى لها.", 400);
  }

  /*
    الخصمُ والرسومُ بعد الضريبة يُحكَم عليهما بالحساب لا بما كُتب: يُحفظ ما فسّر
    الفرقَ وحده، ويُمحى ما استقام الحسابُ بدونه. ومن كتب أحدَهما ولم يسدّ الفرقَ يُقال له.
  */
  const asked = { discountMinor: pick(input.discountMinor, row.discountMinor), chargesMinor: pick(input.chargesMinor, row.chargesMinor) };
  const typed = Boolean(input.discountMinor) || Boolean(input.chargesMinor);
  let discountMinor: number | null = null;
  let chargesMinor: number | null = null;
  if (next.subtotalMinor !== null && next.vatMinor !== null) {
    const totals = checkInvoiceTotals(next.subtotalMinor, next.vatMinor, next.totalMinor, asked);
    ({ discountMinor, chargesMinor } = totals);
    if (totals.verdict === "MISMATCH" && typed) {
      const parts = [
        asked.discountMinor ? ` − الخصم ${formatRiyalsDisplay(asked.discountMinor)}` : "",
        asked.chargesMinor ? ` + الرسوم ${formatRiyalsDisplay(asked.chargesMinor)}` : "",
      ].join("");
      throw new InvoiceCorrectionRefused(
        `الصافي ${formatRiyalsDisplay(next.subtotalMinor)} + الضريبة ${formatRiyalsDisplay(next.vatMinor)}${parts} `
        + `لا يساوي المستحقّ ${formatRiyalsDisplay(next.totalMinor)}. راجع الأرقام على الورقة.`, 400);
    }
  } else if (typed) {
    throw new InvoiceCorrectionRefused("الخصمُ والرسومُ بعد الضريبة يُقاسان على الصافي والضريبة — اكتبهما معهما.", 400);
  }

  const [supplier] = supplierId
    ? await tx.select({ id: suppliers.id, nameAr: suppliers.nameAr, issuesInvoices: suppliers.issuesInvoices, contractOnFile: suppliers.contractOnFile })
      .from(suppliers).where(eq(suppliers.id, supplierId)).limit(1)
    : [];
  if (supplierId && !supplier) throw new InvoiceCorrectionRefused("المورّد غير موجود — حدّث الصفحة", 400);

  const periodMonth = filingMonthFor(date, row.periodMonth);
  /* الشهر المقفل لا يُكتب فيه من أيّ باب — ولا تُنقَل إليه فاتورةٌ ولا منه */
  await assertMonthsOpen(tx, [row.periodMonth, periodMonth]);

  /* ── سدادُ المورّد السابق يُفكّ عنها ── */
  let released: { paymentId: string; amountMinor: number }[] = [];
  if (supplierChanged) {
    released = (await tx
      .select({ paymentId: paymentAllocations.paymentId, amountMinor: paymentAllocations.amountMinor })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(and(
        eq(paymentAllocations.invoiceId, row.id),
        sql`${payments.supplierId} is distinct from ${supplierId}`,
      )));
    if (released.length > 0) {
      await tx.delete(paymentAllocations).where(and(
        eq(paymentAllocations.invoiceId, row.id),
        inArray(paymentAllocations.paymentId, released.map((r) => r.paymentId)),
      ));
      for (const r of new Set(released.map((x) => x.paymentId))) await refreshPaymentStatus(tx, r);
    }
  }

  const [{ allocated }] = (await tx.execute<{ allocated: number }>(sql`
    select coalesce(sum(amount_minor), 0)::int as allocated from payment_allocations where invoice_id = ${row.id}
  `)).rows;
  if (next.totalMinor < Number(allocated)) {
    throw new InvoiceCorrectionRefused(
      `خُصِّص على هذه الفاتورة ${formatRiyalsDisplay(Number(allocated))}، فلا يصحّ أن يقلّ إجماليُّها عن ذلك. تراجع عن التخصيص أوّلاً.`,
    );
  }

  const review = reviewConfirmed(
    {
      documentKind: row.documentKind ?? "TAX_INVOICE",
      supplierId,
      invoiceNumber: next.invoiceNumber,
      invoiceDate: date.toISOString().slice(0, 10),
      subtotalMinor: next.subtotalMinor,
      vatMinor: next.vatMinor,
      totalMinor: next.totalMinor,
      discountMinor,
      chargesMinor,
      sellerVat: next.sellerVat,
      buyerVat: next.buyerVat,
    },
    {
      companyVat: companyConfig.vatNumber,
      supplierIssuesInvoices: supplier?.issuesInvoices,
      supplierContractOnFile: supplier?.contractOnFile,
    },
  );

  try {
    await tx.update(invoices).set({
      ...next,
      discountMinor,
      chargesMinor,
      invoiceNumber: next.invoiceNumber,
      totalMinor: next.totalMinor,
      invoiceDate: date,
      periodMonth,
      supplierId,
      taxStatus: review.taxStatus,
      inputVatStatus: review.inputVatStatus,
    }).where(eq(invoices.id, row.id));
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      throw new InvoiceCorrectionRefused(`لهذا المورّد فاتورةٌ مقيَّدةٌ بالرقم ${next.invoiceNumber} — افتحها وقارِن قبل أن تُقيَّد ثانية.`);
    }
    throw e;
  }

  /* البنودُ والمستندُ وأصنافُ المورّد تتبع الفاتورة */
  await tx.update(invoiceLines).set({ invoiceDate: date, supplierId }).where(eq(invoiceLines.invoiceId, row.id));
  if (supplierChanged) {
    await tx.update(documents).set({ supplierId }).where(eq(documents.id, row.documentId));
    await buildSupplierProducts(tx, row.id);
  }

  const totalRose = next.totalMinor > (row.totalMinor ?? 0);
  if (supplierId && (supplierChanged || totalRose)) {
    await applySupplierCredit(tx, supplierId, { forwardDays: SETTLEMENT_FORWARD_DAYS });
  }
  if (supplierChanged && row.supplierId && released.length > 0) {
    await applySupplierCredit(tx, row.supplierId, { forwardDays: SETTLEMENT_FORWARD_DAYS });
  }

  await recordAudit({
    actorId,
    action: "INVOICE_FIELDS_CORRECTED",
    entityType: "invoice",
    entityId: row.id,
    before: {
      ...{ invoiceNumber: row.invoiceNumber, sellerVat: row.sellerVat, buyerVat: row.buyerVat },
      ...{ subtotalMinor: row.subtotalMinor, vatMinor: row.vatMinor, totalMinor: row.totalMinor },
      invoiceDate: row.invoiceDate.toISOString().slice(0, 10), periodMonth: row.periodMonth, supplierId: row.supplierId,
    },
    after: {
      ...next, invoiceDate: date.toISOString().slice(0, 10), periodMonth, supplierId,
      taxStatus: review.taxStatus, inputVatStatus: review.inputVatStatus,
      ...(released.length > 0 ? { "فُكّ عنها سدادُ المورّد السابق": released } : {}),
    },
  }, tx);

  return { review, releasedMinor: released.reduce((s, r) => s + r.amountMinor, 0), supplierName: supplier?.nameAr ?? null };
}
