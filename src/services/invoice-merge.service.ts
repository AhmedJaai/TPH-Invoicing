/**
 * «هذه نسخةٌ مكرّرة — ادمجها في الأخرى».
 *
 * غاناش (٢٣ أكتوبر ٢٠٢٦): رُفعت صورةُ فاتورة 14 أغسطس بـ٤٥٥٫٤٠ وهي مقيَّدةٌ من ملفّها
 * برقم CIV-008599396، فقُرئ الرقمُ CIV-008593996 فقُيِّدت ثانيةً — وخصم لها الرصيدُ
 * الآليّ من حوالةٍ مفتوحة. فصارت الاثنتان «مسدّدتين»، والإلغاءُ يُرفض لأنّ عليها سداداً،
 * والتراجعُ عن السداد يُعيد الخصمَ الآليّ نفسَه. فلا مخرجَ إلّا بقاعدة.
 *
 * الدمجُ يُبقي **القيدَ الأقدم** — بسداده وحوالته المربوطة به (أحمد) — ويُسقط الأحدث:
 * ما خُصّص للساقطة يعود رصيداً للمورّد ثمّ يُوزَّع بالأقدم أوّلاً (فإن كانت الباقيةُ
 * مفتوحةً سدّها)، وسطرُ كشفها ينتقل إلى الباقية، وصورتُها كاملةً في سجلّ التدقيق.
 * أمّا **الورقة** فيختارها الإنسان: صورةٌ أوضح أو ملفٌّ أصحّ — فتُعلَّق بالقيد الباقي،
 * والأخرى تُرفض ويبقى ملفُّها في الدرايف.
 *
 * ولا يُدمج إلّا المتطابقان: المورّدُ نفسه والمستحقُّ نفسه. فاتورةٌ بمبلغٍ آخر ليست
 * نسخة — تصحيحٌ (`invoice-replace.service.ts`) أو توريدٌ آخر.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { documents, invoices, paymentAllocations, statementLines } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { assertMonthsOpen } from "./month-guard";
import { refreshPaymentStatus } from "./payment.service";
import { applySupplierCredit } from "./supplier-credit.service";
import { STATEMENT_LINE_ORIGIN } from "./invoice.service";
import { refreshStatementFindings } from "./statement-reconcile.service";
import type { Tx } from "./types";

export class MergeRefused extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "MergeRefused";
  }
}

export interface MergeOutcome {
  keptId: string;
  keptNumber: string;
  droppedNumber: string;
  /** ما كان مخصَّصاً للساقطة وعاد رصيداً للمورّد قبل إعادة التوزيع */
  releasedMinor: number;
  /** ما وُزّع من الرصيد بعد الدمج (على الباقية أو على أقدم مفتوحة) */
  reappliedMinor: number;
  /** الملفُّ الذي صار ورقةَ القيد الباقي */
  fileName: string | null;
}

export async function mergeDuplicateInvoice(
  tx: Tx,
  input: { invoiceId: string; twinId: string; fileOf: string; actorId: string },
): Promise<MergeOutcome> {
  if (input.invoiceId === input.twinId) throw new MergeRefused("لا تُدمج الفاتورة في نفسها", 400);
  if (input.fileOf !== input.invoiceId && input.fileOf !== input.twinId) throw new MergeRefused("اختر ملف إحدى الفاتورتين", 400);

  const rows = await tx.select({
    id: invoices.id, number: invoices.invoiceNumber, supplierId: invoices.supplierId, totalMinor: invoices.totalMinor,
    date: invoices.invoiceDate, month: invoices.periodMonth, documentId: invoices.documentId, createdAt: invoices.createdAt,
  }).from(invoices).where(inArray(invoices.id, [input.invoiceId, input.twinId])).for("update");
  if (rows.length < 2) throw new MergeRefused("إحدى الفاتورتين لم تعد في النظام. حدّث الصفحة", 404);
  /* القيدُ الأقدم يبقى — هو الذي سُدّد ورُبطت به الحوالة أوّلاً */
  const [keep, drop] = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  const fileDocumentId = input.fileOf === keep.id ? keep.documentId : drop.documentId;
  const rejectedDocumentId = fileDocumentId === keep.documentId ? drop.documentId : keep.documentId;
  if (keep.supplierId !== drop.supplierId) throw new MergeRefused("الفاتورتان لمورّدين مختلفين، فليستا نسخة واحدة");
  if (keep.totalMinor !== drop.totalMinor) {
    throw new MergeRefused("المبلغان مختلفان، فهذه ليست نسخة مكرّرة. إن كانت فاتورة مصحّحة فصحّح مبلغ المسجّلة، وإن كانت توريداً آخر فأبقِ الاثنتين");
  }
  await assertMonthsOpen(tx, [keep.month, drop.month]);

  const docs = await tx.select({ id: documents.id, fileName: documents.fileName, origin: documents.origin }).from(documents)
    .where(inArray(documents.id, [keep.documentId, drop.documentId]));
  const nameOf = (id: string) => docs.find((d) => d.id === id)?.fileName ?? null;
  const virtual = (id: string) => docs.find((d) => d.id === id)?.origin === STATEMENT_LINE_ORIGIN;
  /* سطرُ كشفٍ بلا ملفّ ليس ورقة — والأخرى لها ملفّ: لا تُعلَّق الباقيةُ بلا ورقة */
  if (virtual(fileDocumentId) && !virtual(rejectedDocumentId)) {
    throw new MergeRefused("هذه الفاتورة سُجّلت من سطر في كشف المورّد وليس لها ملف. اختر ملف الفاتورة الأخرى ليبقى", 400);
  }

  /*
    سطرُ كشف المورّد: ينتقل إلى الباقية إن لم يكن لها سطرٌ **في الكشف نفسه**، وإلّا عاد غيرَ
    مطابَق. كان يُسأل «ألها سطرٌ في أيّ كشف؟» — فبيكوف: 00346 طابقها سطرُ القراءة الثانية
    للكشف، فلمّا دُمجت فيها «000285لـ#» المقيَّدةُ من القراءة الثالثة عاد سطرُ الثالثة «بلا
    ملف» وزرُّ «قيّد الناقصة» يقيّدها ثالثةً.
  */
  const lines = await tx.select({ id: statementLines.id, statementId: statementLines.statementId })
    .from(statementLines).where(eq(statementLines.matchedInvoiceId, drop.id));
  if (lines.length > 0) {
    const keptIn = new Set((await tx.select({ statementId: statementLines.statementId }).from(statementLines)
      .where(eq(statementLines.matchedInvoiceId, keep.id))).map((r) => r.statementId));
    const unmatch: string[] = [];
    for (const l of lines) {
      if (keptIn.has(l.statementId)) { unmatch.push(l.id); continue; }
      await tx.update(statementLines).set({ matchedInvoiceId: keep.id }).where(eq(statementLines.id, l.id));
      keptIn.add(l.statementId);
    }
    if (unmatch.length > 0) {
      await tx.update(statementLines).set({ matchedInvoiceId: null, matchStatus: "UNMATCHED" })
        .where(inArray(statementLines.id, unmatch));
    }
  }

  /* ما خُصّص للساقطة يعود رصيداً — بصورته في الأثر قبل أن يُرفع */
  const allocs = await tx.select({ paymentId: paymentAllocations.paymentId, amountMinor: paymentAllocations.amountMinor })
    .from(paymentAllocations).where(eq(paymentAllocations.invoiceId, drop.id));
  const releasedMinor = allocs.reduce((s, a) => s + a.amountMinor, 0);
  if (allocs.length > 0) await tx.delete(paymentAllocations).where(eq(paymentAllocations.invoiceId, drop.id));

  /* المستندُ فريدٌ للفاتورة — تُحذف الساقطة قبل أن ينتقل ملفُّها إلى الباقية */
  await tx.delete(invoices).where(eq(invoices.id, drop.id));
  if (fileDocumentId !== keep.documentId) {
    await tx.update(invoices).set({ documentId: fileDocumentId }).where(eq(invoices.id, keep.id));
    await tx.update(documents).set({ status: "ARCHIVED" }).where(eq(documents.id, fileDocumentId));
  }
  /* مستندُ سطر الكشف لا ملفَّ له في الدرايف ولا في غيره — يُحذف كما يُحذف حين يصل ملفُّه (057) */
  if (virtual(rejectedDocumentId)) {
    await tx.delete(documents).where(and(eq(documents.id, rejectedDocumentId), eq(documents.origin, STATEMENT_LINE_ORIGIN)));
  } else {
    await tx.update(documents).set({ status: "REJECTED" })
      .where(and(eq(documents.id, rejectedDocumentId), sql`${documents.status} <> 'REJECTED'`));
  }

  for (const p of new Set(allocs.map((a) => a.paymentId))) await refreshPaymentStatus(tx, p);
  for (const s of new Set(lines.map((l) => l.statementId))) await refreshStatementFindings(tx, s);

  const credit = await applySupplierCredit(tx, keep.supplierId, { forwardDays: SETTLEMENT_FORWARD_DAYS });

  await recordAudit({
    actorId: input.actorId,
    action: "INVOICE_MERGED",
    entityType: "invoice",
    entityId: keep.id,
    before: {
      الساقطة: {
        المعرّف: drop.id, الرقم: drop.number, الإجمالي: drop.totalMinor, التاريخ: drop.date, الشهر: drop.month,
        المستند: drop.documentId, الملف: nameOf(drop.documentId),
        التخصيصات: allocs.map((a) => ({ الدفعة: a.paymentId, المبلغ: a.amountMinor })),
        سطور_الكشف: lines.map((l) => l.id),
      },
    },
    after: {
      الباقية: { المعرّف: keep.id, الرقم: keep.number, ملفها_قبل: nameOf(keep.documentId), ملفها_بعد: nameOf(fileDocumentId) },
      المستند_المرفوض: { المعرّف: rejectedDocumentId, الملف: nameOf(rejectedDocumentId), حُذف: virtual(rejectedDocumentId) ? "سطر كشف بلا ملف" : null },
      سطور_الكشف_إلى_الباقية: lines.length,
      عاد_رصيداً: releasedMinor,
      وُزّع_بعدها: credit.appliedMinor,
      السبب: "نسخة مكرّرة من الفاتورة نفسها — بقي القيد الأقدم بسداده، والملف الذي اختاره الإنسان، والآخر رُفض ويبقى في الدرايف",
    },
  }, tx);

  return { keptId: keep.id, keptNumber: keep.number, droppedNumber: drop.number, releasedMinor, reappliedMinor: credit.appliedMinor, fileName: nameOf(fileDocumentId) };
}
