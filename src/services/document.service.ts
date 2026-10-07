/**
 * خدمة المستندات: البصمة والتسجيل والتنبيهات.
 *
 * البصمة هي ما يمنع دخول الملف نفسه مرّتين ولو اختلف اسمه. والفحص هنا
 * طبقة أولى؛ والقيد الفريد في القاعدة هو الحاجز الذي لا يفلت من طلبين
 * متزامنين.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, issues } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { Finding } from "@/lib/validation";
import type { Tx } from "./types";

/** خطأ يُترجم إلى ٤٠٩: الملف نفسه مسجَّل. */
export class DuplicateDocumentError extends Error {
  readonly existingFileName: string;
  constructor(fileName: string) {
    super(`هذا الملف مرفوع مسبقاً باسم ${fileName}`);
    this.name = "DuplicateDocumentError";
    this.existingFileName = fileName;
  }
}

export const sha256Of = (data: Buffer): string =>
  createHash("sha256").update(data).digest("hex");

/** بصمةُ الدرايف (`md5Checksum`) محسوبةً من البايتات — بها تعرف المزامنةُ نسخةَ ما رُفع من هنا بلا تنزيل. */
export const md5Of = (data: Buffer): string =>
  createHash("md5").update(data).digest("hex");

/**
 * يرمي إن كان المحتوى مسجَّلاً أصلاً.
 * المحجور مستثنى: هو نفسه نسخة معروفة، ووجودها لا يمنع الأصل.
 */
export async function assertNotDuplicate(sha256: string): Promise<void> {
  const [existing] = await db
    .select({ fileName: documents.fileName, status: documents.status })
    .from(documents)
    .where(eq(documents.sha256, sha256))
    .limit(1);

  if (existing && existing.status !== "REJECTED") {
    throw new DuplicateDocumentError(existing.fileName);
  }
}

export interface CreateDocumentInput {
  driveFileId: string;
  driveFolderId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  /** بصمةُ الدرايف للمحتوى نفسه — كان الرفعُ لا يحفظها، فنسخةُ المرفوع في الدرايف تُقرأ بالذكاء كلَّ مزامنة */
  driveMd5?: string | null;
  kind: string;
  periodMonth: string;
  supplierId?: string | null;
  rawExtraction?: unknown;
  extractionModel?: string | null;
  fieldConfidence?: unknown;
  uploadedById: string;
  /** من أين قُرئ — نصّاً أم صورة. */
  textSource?: string;
  /** «ينتظر المراجعة» حين يرفعه من لا يرى المبالغ — والافتراضيّ مؤرشف */
  status?: "ARCHIVED" | "NEEDS_REVIEW";
}

const KINDS = new Set([
  "TAX_INVOICE", "SIMPLIFIED_INVOICE", "STATEMENT", "QUOTATION", "PROFORMA",
  "RECEIPT", "CASH_RECEIPT", "CONTRACT", "UTILITY",
]);

export async function createDocument(tx: Tx, input: CreateDocumentInput): Promise<string> {
  const [doc] = await tx
    .insert(documents)
    .values({
      driveFileId: input.driveFileId,
      driveFolderId: input.driveFolderId,
      fileName: input.fileName,
      mimeType: input.mimeType || "application/pdf",
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      driveMd5: input.driveMd5 ?? null,
      source: "UPLOAD",
      originalFileName: input.fileName,
      kind: (KINDS.has(input.kind) ? input.kind : "UNKNOWN") as never,
      status: input.status ?? "ARCHIVED",
      periodMonth: input.periodMonth,
      supplierId: input.supplierId ?? null,
      // مخرجات النموذج الخام تُحفظ كما هي ولا تُعدَّل — هي المرجع عند أي مراجعة
      extractionJson: (input.rawExtraction ?? null) as never,
      extractionModel: input.extractionModel ?? null,
      textSource: input.textSource ?? null,
      fieldConfidence: (input.fieldConfidence ?? null) as never,
      uploadedById: input.uploadedById,
    })
    .returning({ id: documents.id });

  return doc.id;
}

/** التنبيهات غير المانعة تبقى مفتوحة لتُتابَع لا لتُنسى. */
export async function recordFindings(
  tx: Tx,
  documentId: string,
  findings: readonly Finding[],
): Promise<void> {
  for (const f of findings) {
    await tx.insert(issues).values({
      code: f.code,
      severity: f.severity,
      entityType: "document",
      entityId: documentId,
      message: f.message,
    });
  }
}

/**
 * ملفٌّ رُفع إلى الدرايف ثمّ ردّت القاعدةُ قيدَه — يُحفظ له صفٌّ «مرفوض» بسببه.
 *
 * الرفعُ يسبق المعاملة، والأرشيفُ لا يُحذف منه شيء؛ فإن رُدّ القيد (شهرٌ أُقفل بين الفحص
 * والكتابة، قيدٌ ماليّ، سباقُ رفعين) بقي في الدرايف ملفٌّ باسمٍ قياسيّ بلا صفّ — والمزامنةُ
 * التالية تراه «جديداً مسمّى» فتقيّده مؤرشفاً وتنشئ فاتورته من اسمه: تُدخل ما رفضته القاعدةُ
 * للتوّ، بلا مراجعة. فبهذا الصفّ تعرفه المزامنة ولا تقيّده، ويظهر في «رُفض» بسببه.
 * وبلا `sha256`: إعادةُ الرفع بعد إصلاح السبب لا يردّها هذا الصفّ.
 */
export async function recordUploadOrphan(input: {
  driveFileId: string;
  driveFolderId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  driveMd5: string;
  periodMonth: string;
  uploadedById: string;
  reason: string;
}): Promise<void> {
  const reason = `رُفع إلى الدرايف ولم يُقيَّد — ${input.reason}`.slice(0, 500);
  await db.transaction(async (t) => {
    const [doc] = await t.insert(documents).values({
      driveFileId: input.driveFileId,
      driveFolderId: input.driveFolderId,
      fileName: input.fileName,
      originalFileName: input.fileName,
      mimeType: input.mimeType || "application/pdf",
      sizeBytes: input.sizeBytes,
      driveMd5: input.driveMd5,
      kind: "UNKNOWN",
      status: "REJECTED",
      statusNote: reason,
      source: "UPLOAD",
      periodMonth: input.periodMonth,
      uploadedById: input.uploadedById,
    }).onConflictDoNothing().returning({ id: documents.id });
    if (!doc) return;
    await recordAudit({
      actorId: null,
      action: "DOCUMENT_REJECTED",
      entityType: "document",
      entityId: doc.id,
      after: { الملف: input.fileName, السبب: reason, driveFileId: input.driveFileId },
    }, t);
  });
}
