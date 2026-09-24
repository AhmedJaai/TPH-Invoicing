/**
 * إعادةُ قراءة مستندٍ مؤرشف — للزرّ وللاستدراك الآليّ معاً.
 *
 * ── «طلع لي كود لما ضغطت أقرّ هذه القراءة» (أحمد، ٢٤ سبتمبر ٢٠٢٦) ──
 *
 * قرأ النموذجُ «الصافي ٩٠٠ · الضريبة ١٣٥ · الإجمالي ١٠٦٠». و٩٠٠ + ١٣٥ =
 * ١٠٣٥ لا ١٠٦٠ — ولعلّ في الفاتورة رسمَ توصيلٍ لم يُقرأ. فكتبها المسارُ
 * بلا سؤال، فردّها قيدُ القاعدة (`007`: الصافي + الضريبة = الإجمالي
 * بتسامح ريال) — وخرج نصُّ الاستعلام الخامّ إلى الشاشة. **والقيدُ أصاب**:
 * قراءةٌ لا تستقيم لا تُكتَب. والخطأ أنّ السؤال لم يُسأل قبل الكتابة، ولم
 * يُقَل الجوابُ بلغة صاحبه.
 *
 * فصار يُحسَب قبل الكتابة: ما يستقيم يُكتَب، وما لا يستقيم يُقال بأرقامه —
 * «٩٠٠ + ١٣٥ = ١٬٠٣٥ والإجمالي ١٬٠٦٠ — فرقُ ٢٥» — ولا تُكتَب مبالغُه،
 * وتُكتَب البنودُ وحدها إن وُجدت. **والإجماليُّ المقيَّد لا يُكتَب فوقه**
 * بقراءةٍ تخالفه: هو ما دُفع عليه.
 *
 * ── وما لا يُقرأ من ذاته يُقرأ وحده ──
 *
 * «ما أدري ليش ما قرأ كل الملفات واستخرج المطلوب من نفسه». فالاستدراكُ
 * يعيد قراءةَ ما نقص تفصيلُه الضريبيّ أو بنودُه — قليلاً في كلّ مرّة لأنّ
 * القراءة نداءٌ مدفوع — ويكتب ما يستقيم وحده. ولا يُعاد ما أُعيد في
 * الأيّام السبعة الأخيرة: قراءةٌ لم تستقم لا تستقيم بتكرارها.
 */
import type { drive_v3 } from "googleapis";
import { and, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, documents, invoiceLines, invoices, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { downloadFile, isDriveAuthError } from "@/lib/drive";
import { extractDocument, isSupportedUpload } from "@/lib/extraction";
import { companyConfig } from "@/config/drive";
import { replaceLines } from "@/services/invoice.service";
import { assertMonthsOpen } from "@/services/month-guard";
import { reviewConfirmed } from "@/lib/confirm";
import { TOTAL_ROUNDING_TOLERANCE_MINOR, formatRiyalsDisplay, parseRiyals } from "@/lib/money";

export interface RereadRead {
  subtotalMinor: number | null;
  vatMinor: number | null;
  totalMinor: number | null;
  sellerVat: string | null;
  buyerVat: string | null;
  lineCount: number;
  lines: { description: string; quantity: string; unitPrice: string; lineTotal: string }[];
}

export type RereadOutcome =
  | { ok: false; status: number; error: string }
  | { ok: true; applied: false; model: string; fileName: string; read: RereadRead; note: string; problem: string | null }
  | { ok: true; applied: true; model: string; linesWritten: number; taxStatus: string; amountsWritten: boolean; problem: string | null };

/** أيستقيم الثلاثيّ؟ — والجوابُ جملةٌ بأرقامها إن لم يستقم. */
export function amountsProblem(subtotal: number | null, vat: number | null, total: number | null): string | null {
  if (subtotal === null || vat === null || total === null) return null;
  const diff = subtotal + vat - total;
  if (Math.abs(diff) <= TOTAL_ROUNDING_TOLERANCE_MINOR) return null;
  return `الصافي ${formatRiyalsDisplay(subtotal)} + الضريبة ${formatRiyalsDisplay(vat)} = `
    + `${formatRiyalsDisplay(subtotal + vat)}، والإجمالي ${formatRiyalsDisplay(total)} — `
    + `فرقُ ${formatRiyalsDisplay(Math.abs(diff))} لا يستقيم. لعلّ في الفاتورة رسماً أو خصماً لم يُقرأ؛ `
    + "فلم تُكتَب المبالغ — صحّحها بيدك إن أردت.";
}

export async function rereadDocument(opts: {
  documentId: string;
  actorId: string;
  drive: drive_v3.Drive;
  apply: boolean;
  auto?: boolean;
}): Promise<RereadOutcome> {
  const [doc] = await db
    .select({
      id: documents.id,
      driveFileId: documents.driveFileId,
      fileName: documents.fileName,
      kind: documents.kind,
      supplierId: documents.supplierId,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth,
      storedTotal: invoices.totalMinor,
      issuesInvoices: suppliers.issuesInvoices,
      contractOnFile: suppliers.contractOnFile,
    })
    .from(documents)
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(eq(documents.id, opts.documentId))
    .limit(1);

  if (!doc) return { ok: false, status: 404, error: "لا مستند بهذا المعرّف" };
  if (!doc.driveFileId) {
    return { ok: false, status: 409, error: "هذا المستند بلا ملفٍّ في الدرايف — لا شيء يُعاد قراءتُه." };
  }

  let data: Buffer;
  let mimeType: string;
  try {
    ({ data, mimeType } = await downloadFile(opts.drive, doc.driveFileId));
  } catch (e) {
    if (isDriveAuthError(e)) {
      return { ok: false, status: 401, error: "انتهى تفويضُ الدرايف. اخرج وادخل بحساب جوجل ثمّ أعد المحاولة." };
    }
    return { ok: false, status: 502, error: "تعذّر تنزيلُ الملفّ من الدرايف." };
  }
  if (!isSupportedUpload(mimeType)) {
    return { ok: false, status: 415, error: `نوعُ الملفّ «${mimeType}» لا يُقرأ آلياً — صحّح الحقول بيدك.` };
  }

  const supplierNames = (await db.select({ nameAr: suppliers.nameAr }).from(suppliers)).map((s) => s.nameAr);
  const outcome = await extractDocument({
    data, mimeType,
    companyVat: companyConfig.vatNumber,
    companyName: companyConfig.nameAr,
    supplierNames,
  });
  if (!outcome.ok) return { ok: false, status: 502, error: `تعذّرت القراءة: ${outcome.reason}` };

  const x = outcome.value;
  const read: RereadRead = {
    subtotalMinor: parseRiyals(x.subtotalAmount) ?? null,
    vatMinor: parseRiyals(x.vatAmount) ?? null,
    totalMinor: parseRiyals(x.totalAmount) ?? null,
    sellerVat: x.sellerVatNumber?.trim() || null,
    buyerVat: x.buyerVatNumber?.trim() || null,
    lineCount: x.lines.length,
    lines: x.lines.slice(0, 40).map((l) => ({
      description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
    })),
  };

  /*
    الإجماليُّ المقيَّد هو ما دُفع عليه — فإن خالفته القراءةُ فالمعتمَدُ هو،
    ويُحكَم على الصافي والضريبة به.
  */
  const total = doc.storedTotal ?? read.totalMinor;
  const totalConflict = doc.storedTotal !== null && read.totalMinor !== null
    && Math.abs(doc.storedTotal - read.totalMinor) > TOTAL_ROUNDING_TOLERANCE_MINOR;
  const problem = amountsProblem(read.subtotalMinor, read.vatMinor, total)
    ?? (totalConflict
      ? `الإجماليُّ المقروء ${formatRiyalsDisplay(read.totalMinor!)} يخالف المقيَّد ${formatRiyalsDisplay(doc.storedTotal!)} — بقي المقيَّد.`
      : null);
  const amountsOk = amountsProblem(read.subtotalMinor, read.vatMinor, total) === null;

  if (!opts.apply) {
    return {
      ok: true, applied: false, model: outcome.model, fileName: doc.fileName, read, problem,
      note: "هذه قراءةٌ جديدة لم تُكتَب بعد. قارنها بالملفّ ثمّ أقرّها — ورقمُ الفاتورة لا يُؤخَذ من النموذج ويبقى كما هو.",
    };
  }

  if (!doc.invoiceId || !doc.supplierId) {
    return { ok: false, status: 409, error: "لا فاتورةَ مقيَّدة لهذا المستند — لا موضعَ تُكتَب فيه القراءة." };
  }

  const review = reviewConfirmed(
    {
      documentKind: doc.kind,
      supplierId: doc.supplierId,
      invoiceNumber: doc.invoiceNumber,
      invoiceDate: doc.invoiceDate ? doc.invoiceDate.toISOString().slice(0, 10) : null,
      subtotalMinor: amountsOk ? read.subtotalMinor : null,
      vatMinor: amountsOk ? read.vatMinor : null,
      totalMinor: total,
      sellerVat: read.sellerVat,
      buyerVat: read.buyerVat,
    },
    {
      companyVat: companyConfig.vatNumber,
      supplierIssuesInvoices: doc.issuesInvoices ?? undefined,
      supplierContractOnFile: doc.contractOnFile ?? undefined,
    },
  );

  let written = 0;
  try {
    await db.transaction(async (t) => {
      if (doc.periodMonth) await assertMonthsOpen(t, [doc.periodMonth]);
      await t
        .update(invoices)
        .set({
          /* ما لا يستقيم لا يُكتَب — ويبقى ما كان */
          ...(amountsOk ? {
            subtotalMinor: read.subtotalMinor ?? undefined,
            vatMinor: read.vatMinor ?? undefined,
            ...(doc.storedTotal === null && read.totalMinor !== null ? { totalMinor: read.totalMinor } : {}),
            taxStatus: review.taxStatus,
            inputVatStatus: review.inputVatStatus,
          } : {}),
          sellerVat: read.sellerVat ?? undefined,
          buyerVat: read.buyerVat ?? undefined,
        })
        .where(eq(invoices.id, doc.invoiceId!));

      if (x.lines.length > 0) {
        written = await replaceLines(t, {
          invoiceId: doc.invoiceId!,
          supplierId: doc.supplierId!,
          invoiceDate: doc.invoiceDate,
          subtotalMinor: amountsOk ? read.subtotalMinor : null,
          lines: x.lines,
        });
      }

      await recordAudit({
        actorId: opts.actorId,
        action: "DOCUMENT_REREAD",
        entityType: "document",
        entityId: doc.id,
        before: { invoiceId: doc.invoiceId },
        after: {
          ...read, lines: undefined, linesWritten: written, model: outcome.model,
          taxStatus: amountsOk ? review.taxStatus : "لم يُكتَب", problem, auto: opts.auto === true,
        },
      }, t);
    });
  } catch (e) {
    const msg = (e as Error).message;
    return {
      ok: false, status: 409,
      error: /month|شهر/i.test(msg)
        ? msg
        : "لم تُكتَب القراءة: رفضتها قيودُ المال في القاعدة — غالباً لأنّ مبالغها لا تستقيم مع ما دُفع. صحّح الحقول بيدك.",
    };
  }

  return {
    ok: true, applied: true, model: outcome.model, linesWritten: written,
    taxStatus: amountsOk ? review.taxStatus : "UNKNOWN", amountsWritten: amountsOk, problem,
  };
}

/**
 * يعيد قراءةَ ما نقص تفصيلُه الضريبيّ أو بنودُه — `limit` في كلّ مرّة،
 * ولا يعيد ما أُعيد في الأيّام السبعة الأخيرة.
 */
export async function autoRereadGaps(actorId: string, drive: drive_v3.Drive, limit = 2): Promise<{ reread: number; notes: string[] }> {
  const recent = db
    .select({ id: auditLogs.entityId })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "DOCUMENT_REREAD"), gte(auditLogs.at, sql`now() - interval '7 days'`)));

  const lineCount = sql<number>`(select count(*) from ${invoiceLines} l where l.invoice_id = ${invoices}.id)`;
  const candidates = await db
    .select({ documentId: documents.id, fileName: documents.fileName })
    .from(invoices)
    .innerJoin(documents, eq(documents.id, invoices.documentId))
    .where(and(
      eq(documents.status, "ARCHIVED"),
      isNotNull(documents.driveFileId),
      or(eq(invoices.taxStatus, "UNKNOWN"), isNull(invoices.vatMinor), sql`${lineCount} = 0`),
      sql`${documents.id} not in (${recent})`,
    ))
    .limit(limit);

  const notes: string[] = [];
  let reread = 0;
  for (const c of candidates) {
    const r = await rereadDocument({ documentId: c.documentId, actorId, drive, apply: true, auto: true });
    if (r.ok && r.applied) {
      reread++;
      if (r.problem) notes.push(`${c.fileName}: ${r.problem}`);
    } else if (!r.ok) {
      notes.push(`${c.fileName}: ${r.error}`);
      /* ما فشل يُكتَب أثرُه كي لا يُعاد في كلّ مرّة ويُدفَع ثمنُه */
      await recordAudit({
        actorId,
        action: "DOCUMENT_REREAD",
        entityType: "document",
        entityId: c.documentId,
        after: { الملف: c.fileName, فشل: r.error, auto: true },
      });
    }
  }
  return { reread, notes };
}

