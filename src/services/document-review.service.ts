/**
 * المستنداتُ التي تنتظر المراجعة — وحكمُ الشروط الأربعة على كلٍّ منها.
 *
 * مصدرٌ واحد للّوح الذي يشرح، وللفعل الذي يعتمد ما اجتمعت فيه الشروط:
 * فلا يعدّ اللوحُ «٧ تجتمع فيها» ثمّ يعتمد الفعلُ خمسة.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, statements, suppliers } from "@/db/schema";
import type { drive_v3 } from "googleapis";
import { autoArchive, sumLineTotals, type AutoArchiveVerdict } from "@/lib/extraction/auto-archive";
import { factsFromFileName } from "@/lib/extraction/filename-facts";
import { recordAudit } from "@/lib/audit";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { driveWritesAllowed } from "@/lib/drive-readonly";
import { renameArchived } from "@/services/drive-rename.service";
import { autoRereadGaps } from "@/services/document-reread.service";
import { missingFromReading, recordFromStoredReadings } from "@/services/document-backlog.service";
import { normalizeDocumentDate } from "@/lib/document-date";
import { parseRiyals } from "@/lib/money";

export async function loadPendingReview(limit = 200) {
  const rows = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      driveFileId: documents.driveFileId,
      periodMonth: documents.periodMonth,
      status: documents.status,
      kind: documents.kind,
      textSource: documents.textSource,
      invoiceId: invoices.id,
      totalMinor: invoices.totalMinor,
      subtotalMinor: invoices.subtotalMinor,
      vatMinor: invoices.vatMinor,
      invoiceDate: invoices.invoiceDate,
      invoiceNumber: invoices.invoiceNumber,
      sellerVat: invoices.sellerVat,
      supplierId: suppliers.id,
      supplierVat: suppliers.vatNumber,
      supplierName: suppliers.nameAr,
      reading: documents.extractionJson,
      statementId: statements.id,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(statements, eq(statements.documentId, documents.id))
    .where(inArray(documents.status, ["PENDING", "NEEDS_REVIEW"]))
    .orderBy(asc(documents.periodMonth))
    .limit(limit);

  return rows.map(({ reading, ...d }) => {
    const x = (reading ?? {}) as { documentKind?: string; lines?: { lineTotal?: string }[] };
    const readKind = x.documentKind ?? d.kind;
    const isStatement = readKind === "STATEMENT" || d.kind === "STATEMENT";
    const recorded = d.invoiceId !== null || d.statementId !== null;
    const missing = recorded ? [] : missingFor(reading, d.supplierId !== null, d.fileName, isStatement);
    return {
      ...d,
      /* ما نقص بعينه حين لم يُقيَّد شيء — من القراءة المحفوظة واسم الملفّ */
      missing,
      /* لا قيدَ له وقراءتُه كاملة — يُقيَّد عند الاستدراك */
      recordable: !recorded
        && (isStatement || ["TAX_INVOICE", "SIMPLIFIED_INVOICE"].includes(readKind ?? ""))
        && missing.length === 0,
      verdict: autoArchive({
        kind: isStatement ? "STATEMENT" : d.kind,
        invoiceRecorded: d.invoiceId !== null,
        statementRecorded: d.statementId !== null,
        textSource: d.textSource,
        supplierKnown: d.supplierId !== null,
        subtotalMinor: d.subtotalMinor,
        vatMinor: d.vatMinor,
        totalMinor: d.totalMinor,
        invoiceNumber: d.invoiceNumber,
        fileName: d.fileName,
        linesTotalMinor: sumLineTotals(x.lines, (v) => parseRiyals(v)),
      }) as AutoArchiveVerdict,
    };
  });
}

function missingFor(reading: unknown, supplierKnown: boolean, fileName: string, isStatement: boolean): string[] {
  if (isStatement) return supplierKnown ? [] : ["المورّد: لم يُعرَف من الاسم المقروء"];
  const x = (reading ?? {}) as { invoiceNumber?: string; invoiceDate?: string; totalAmount?: string };
  const fromName = factsFromFileName(fileName);
  return missingFromReading({
    supplierKnown,
    invoiceNumber: x.invoiceNumber?.trim() || fromName.invoiceNumber,
    invoiceDate: normalizeDocumentDate(x.invoiceDate) ?? fromName.date,
    totalMinor: parseRiyals(x.totalAmount ?? "") ?? fromName.totalMinor,
    rawDate: x.invoiceDate?.trim() || null,
  });
}

/**
 * يعتمد كلَّ ما ينتظر وتجتمع فيه الشروط — كالاعتماد اليدويّ تماماً:
 * خصمُ رصيد المورّد، وأثرٌ في السجلّ بسببه. والحكمُ من القيد الآن.
 */
export async function approveEligible(actorId: string, limit = 80): Promise<{
  approved: number; driveFileIds: string[]; failed: string[]; remaining: number;
}> {
  const eligible = (await loadPendingReview(500)).filter((d) => d.status === "NEEDS_REVIEW" && d.verdict.auto);
  const driveFileIds: string[] = [];
  const failed: string[] = [];
  let approved = 0;
  for (const d of eligible.slice(0, limit)) {
    try {
      const ok = await db.transaction(async (t) => {
        const rows = await t.update(documents).set({ status: "ARCHIVED" })
          .where(and(eq(documents.id, d.id), eq(documents.status, "NEEDS_REVIEW")))
          .returning({ id: documents.id });
        if (rows.length === 0) return false;
        await recordAudit({
          actorId,
          action: "DOCUMENT_STATUS_CHANGED",
          entityType: "document",
          entityId: d.id,
          before: { الحال: "ينتظر المراجعة" },
          after: { الملف: d.fileName, الحال: "مؤرشف", السبب: "اجتمعت فيه شروطُ الأرشفة الآليّة" },
        }, t);
        if (d.supplierId) await applySupplierCredit(t, d.supplierId, { forwardDays: SETTLEMENT_FORWARD_DAYS });
        return true;
      });
      if (ok) {
        approved++;
        if (d.driveFileId) driveFileIds.push(d.driveFileId);
      }
    } catch (e) {
      failed.push(`${d.fileName}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  return { approved, driveFileIds, failed, remaining: Math.max(0, eligible.length - limit) };
}

/**
 * استدراكُ ما تراكم — ثلاثُ خطواتٍ بترتيبها:
 *   ١. تُقيَّد فواتيرُ ما رُمي تاريخُه، من قراءته المحفوظة.
 *   ٢. يُعتمَد ما تجتمع فيه الشروط (ومنه ما قُيِّد للتوّ).
 *   ٣. يُسمّى كلُّ ما أُرشِف ويخالف اسمُه الصيغة — لا ما أُرشِف اليوم وحده.
 * والثالثةُ في الإنتاج وحده وبتفويض الدرايف؛ وإلّا تُترَك وتُقترَح.
 */
export async function processDocumentBacklog(
  actorId: string,
  drive: drive_v3.Drive | null,
): Promise<{ recorded: number; approved: number; renamed: { from: string; to: string }[]; reread: number; notes: string[] }> {
  const notes: string[] = [];
  const { recorded } = await recordFromStoredReadings(actorId);
  const approval = await approveEligible(actorId);
  notes.push(...approval.failed);

  /*
    دفعةٌ سبقت فاتورتَها تُخصم منها حين تصل — والفاتورةُ قد تصل من طريقٍ لا
    يمرّ بالخصم (قيدٌ قديم، أو اعتمادٌ جماعيّ سبق). فيمرّ الخصمُ على كلّ
    مورّدٍ له مالٌ غيرُ مخصَّص، بالسياسة نفسها (الأقدمُ أوّلاً، وسبعةُ أيّام).
    أحمد: «كوهي وأطلس فواتيرهم موجودة على الغالب».
  */
  const withCredit = await db.execute<{ supplier_id: string }>(sql`
    select distinct p.supplier_id from payments p
     where p.supplier_id is not null and p.status not in ('REVERSED','VOID','ADVANCE')
       and p.amount_minor - p.fee_minor
           - coalesce((select sum(a.amount_minor) from payment_allocations a where a.payment_id = p.id), 0) > 0
  `);
  let creditApplied = 0;
  for (const { supplier_id } of withCredit.rows) {
    try {
      const out = await db.transaction((t) => applySupplierCredit(t, supplier_id, { forwardDays: SETTLEMENT_FORWARD_DAYS }));
      creditApplied += out.allocations.length;
    } catch (e) {
      notes.push(`خصمُ الرصيد: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  if (creditApplied > 0) notes.push(`نُسبت ${creditApplied} دفعةً إلى فواتيرها`);
  let renamed: { from: string; to: string }[] = [];
  let reread = 0;
  if (drive) {
    /* ما نقص تفصيلُه الضريبيّ أو بنودُه يُقرأ من جديد — واحدٌ في كلّ مرّة (نداءٌ مدفوع) */
    const r = await autoRereadGaps(actorId, drive, 1).catch((e: Error) => ({ reread: 0, notes: [e.message] }));
    reread = r.reread;
    notes.push(...r.notes);
  }
  if (drive && driveWritesAllowed(process.env)) {
    const outcome = await renameArchived(drive, null, actorId, "الاستدراك");
    renamed = outcome.done;
    notes.push(...outcome.failed.map((f) => `${f.from}: ${f.error}`));
  }
  return { recorded, approved: approval.approved, renamed, reread, notes };
}
