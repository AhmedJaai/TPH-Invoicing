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
 *
 * **والسدادُ المكرّر لا يصير رصيداً** (مود القهوة وجملة التقنية، ٢٤ أكتوبر ٢٠٢٦): كلُّ نسخةٍ
 * وُسمت «مسدّدة» بيد، فلمّا دُمجتا عاد سدادُ الساقطة «رصيداً لك» — ولم يخرج مالٌ مرّتين.
 * فإن كانت الباقيةُ مسدّدةً كلَّها، وسدادُ الساقطة قُيّد بيد (لا بنكَ ولا إيصال) ولم يسدّد
 * غيرها (`handPaymentsOnlyFor`)، قالت المعاينةُ ذلك، والافتراضيُّ في الشاشة «ألغِ السداد
 * المكرّر» (`VOID` بسببٍ يسمّي الفاتورتين، للمالك). وما شهد له البنكُ أو الإيصالُ يبقى
 * رصيداً ويُوزَّع بالأقدم أوّلاً كما كان.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { documents, invoices, paymentAllocations, payments, statementLines } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { currentMonthRiyadh } from "@/lib/riyadh-time";
import { assertMonthsOpen, closedMonthsAmong } from "./month-guard";
import { handPaymentsOnlyFor, voidHandPayment, type HandOnlyPayment } from "./hand-duplicate.service";
import { refreshPaymentStatus } from "./payment.service";
import { applySupplierCredit } from "./supplier-credit.service";
import { STATEMENT_LINE_ORIGIN } from "./invoice.service";
import { refreshStatementFindings } from "./statement-reconcile.service";
import type { Conn, Tx } from "./types";

export class MergeRefused extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "MergeRefused";
  }
}

/** ما يُفعل بسدادٍ بيدٍ لم يسدّد إلّا الساقطة والباقيةُ مسدّدة: يُلغى، أو يبقى رصيداً. */
export type HandPaymentChoice = "void" | "keep";

export interface MergeOutcome {
  keptId: string;
  keptNumber: string;
  droppedNumber: string;
  /** ما كان مخصَّصاً للساقطة وعاد رصيداً للمورّد قبل إعادة التوزيع */
  releasedMinor: number;
  /** سداداتٌ بيدٍ مكرّرة أُلغيت (`VOID`) ولم تصر رصيداً */
  voidedMinor: number;
  voidedPaymentIds: string[];
  /** ما وُزّع من الرصيد بعد الدمج (على الباقية أو على أقدم مفتوحة) */
  reappliedMinor: number;
  /** الملفُّ الذي صار ورقةَ القيد الباقي */
  fileName: string | null;
}

async function loadPair(conn: Conn, invoiceId: string, twinId: string, lock: boolean) {
  if (invoiceId === twinId) throw new MergeRefused("لا تُدمج الفاتورة في نفسها", 400);
  const q = conn.select({
    id: invoices.id, number: invoices.invoiceNumber, supplierId: invoices.supplierId, totalMinor: invoices.totalMinor,
    date: invoices.invoiceDate, month: invoices.periodMonth, documentId: invoices.documentId, createdAt: invoices.createdAt,
  }).from(invoices).where(inArray(invoices.id, [invoiceId, twinId]));
  const rows = lock ? await q.for("update") : await q;
  if (rows.length < 2) throw new MergeRefused("إحدى الفاتورتين لم تعد في النظام. حدّث الصفحة", 404);
  /* القيدُ الأقدم يبقى — هو الذي سُدّد ورُبطت به الحوالة أوّلاً */
  const [keep, drop] = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  if (keep.supplierId !== drop.supplierId) throw new MergeRefused("الفاتورتان لمورّدين مختلفين، فليستا نسخة واحدة");
  if (keep.totalMinor !== drop.totalMinor) {
    throw new MergeRefused("المبلغان مختلفان، فهذه ليست نسخة مكرّرة. إن كانت فاتورة مصحّحة فصحّح مبلغ المسجّلة، وإن كانت توريداً آخر فأبقِ الاثنتين");
  }
  return { keep, drop };
}

/**
 * سدادُ الساقطة المكرّر: الباقيةُ مسدّدةٌ كلُّها من غيرها، وسدادٌ بيدٍ لم يسدّد إلّا الساقطة.
 * فإن فُكّ عنها صار «رصيداً لك» لم يخرج مالُه.
 */
async function duplicateHandOnDrop(conn: Conn, keep: { id: string; totalMinor: number }, dropId: string): Promise<HandOnlyPayment[]> {
  const [{ paid }] = (await conn.execute<{ paid: number }>(sql`
    select coalesce(sum(amount_minor), 0)::bigint as paid from payment_allocations where invoice_id = ${keep.id}`)).rows;
  if (keep.totalMinor - Number(paid) > SETTLED_TOLERANCE_MINOR) return [];
  return handPaymentsOnlyFor(conn, dropId);
}

export interface MergePreview {
  keptId: string;
  keptNumber: string;
  droppedNumber: string;
  /** ما خُصّص للساقطة كلُّه */
  allocatedMinor: number;
  /** سداداتٌ بيدٍ مكرّرة على الساقطة — تُلغى أو تبقى رصيداً */
  duplicates: HandOnlyPayment[];
  /** أشهرٌ مقفلة تمنع إلغاءها (شهرُ الدفعة) */
  closedMonths: string[];
}

/** ما سيقع قبل أن يقع — قراءةٌ بلا كتابة. */
export async function previewMerge(conn: Conn, input: { invoiceId: string; twinId: string }): Promise<MergePreview> {
  const { keep, drop } = await loadPair(conn, input.invoiceId, input.twinId, false);
  const [{ allocated }] = (await conn.execute<{ allocated: number }>(sql`
    select coalesce(sum(amount_minor), 0)::bigint as allocated from payment_allocations where invoice_id = ${drop.id}`)).rows;
  const duplicates = await duplicateHandOnDrop(conn, keep, drop.id);
  const months = duplicates.length === 0 ? [] : await conn.select({ paidAt: payments.paidAt, applies: payments.appliesToMonth })
    .from(payments).where(inArray(payments.id, duplicates.map((d) => d.paymentId)));
  const closed = await closedMonthsAmong(conn, months.flatMap((m) => [m.applies, currentMonthRiyadh(m.paidAt)]));
  return {
    keptId: keep.id, keptNumber: keep.number, droppedNumber: drop.number,
    allocatedMinor: Number(allocated), duplicates, closedMonths: [...closed].sort(),
  };
}

export async function mergeDuplicateInvoice(
  tx: Tx,
  input: {
    invoiceId: string; twinId: string; fileOf: string; actorId: string;
    /** الغائبُ «يبقى رصيداً» — كما كان. والشاشةُ تقترح الإلغاء، والمسارُ يحصره في المالك. */
    handPayments?: HandPaymentChoice;
  },
): Promise<MergeOutcome> {
  if (input.fileOf !== input.invoiceId && input.fileOf !== input.twinId) throw new MergeRefused("اختر ملف إحدى الفاتورتين", 400);
  const { keep, drop } = await loadPair(tx, input.invoiceId, input.twinId, true);
  const fileDocumentId = input.fileOf === keep.id ? keep.documentId : drop.documentId;
  const rejectedDocumentId = fileDocumentId === keep.documentId ? drop.documentId : keep.documentId;
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

  /* السدادُ المكرّر بيدٍ يُلغى بقرار — فلا يصير «رصيداً لك» لم يخرج */
  const voids = input.handPayments === "void" ? await duplicateHandOnDrop(tx, keep, drop.id) : [];
  const voidedIds = new Set(voids.map((v) => v.paymentId));
  let voidedMinor = 0;
  for (const v of voids) {
    voidedMinor += await voidHandPayment(tx, {
      paymentId: v.paymentId,
      actorId: input.actorId,
      reason: `قيد سداد مكرّر: سُجّلت ${drop.number} مسدّدة بيد، وهي نسخة من ${keep.number} المسدّدة، فدُمجتا وأُلغي السداد المكرّر`,
      context: { الدمج: { الباقية: keep.number, الساقطة: drop.number } },
    });
  }
  const kept = allocs.filter((a) => !voidedIds.has(a.paymentId));
  const releasedMinor = kept.reduce((s, a) => s + a.amountMinor, 0);
  if (kept.length > 0) await tx.delete(paymentAllocations).where(eq(paymentAllocations.invoiceId, drop.id));

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

  for (const p of new Set(kept.map((a) => a.paymentId))) await refreshPaymentStatus(tx, p);
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
      أُلغي_مكرّراً: voids.map((v) => ({ الدفعة: v.paymentId, المبلغ: v.amountMinor })),
      وُزّع_بعدها: credit.appliedMinor,
      السبب: "نسخة مكرّرة من الفاتورة نفسها — بقي القيد الأقدم بسداده، والملف الذي اختاره الإنسان، والآخر رُفض ويبقى في الدرايف",
    },
  }, tx);

  return {
    keptId: keep.id, keptNumber: keep.number, droppedNumber: drop.number, releasedMinor,
    voidedMinor, voidedPaymentIds: [...voidedIds],
    reappliedMinor: credit.appliedMinor, fileName: nameOf(fileDocumentId),
  };
}
