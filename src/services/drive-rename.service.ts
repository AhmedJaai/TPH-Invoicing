/**
 * إعادةُ تسمية ملفّات الأرشيف — في موضعٍ واحد.
 *
 * كانت التسميةُ فعلَ إنسانٍ ملفّاً ملفّاً (`/api/drive-rename`) بإذن أحمد في
 * ٧ سبتمبر ٢٠٢٦. ثمّ أذِن في ٢٤ سبتمبر بأن يُسمّى **آلياً** ما أُرشِف: ما
 * اجتمعت فيه شروطُ الأرشفة الآليّة الأربعة، أو ما اعتمده إنسان — «إلّا في
 * الحالات المستعصية». والمستعصي هو ما لا يُبنى له اسمٌ من المقيَّد
 * (`canonicalName` يقول `CANNOT`) أو ما لم يُحسَم بعد: فالاسمُ يُبنى من
 * القيد، والقيدُ الذي لم يره إنسانٌ ولم يجتز الشروط قد يحمل رقماً خاطئاً
 * يُكتَب في الأرشيف.
 *
 * وما بقي من القيد الأوّل لا يتغيّر: **التسميةُ وحدها** (لا حذف ولا نقل)،
 * و**ما له سجلٌّ عندنا وحده**، والاسمُ **من المقيَّد لا من التخمين**،
 * و**أثرٌ في سجلّ التدقيق بالاسمين** لكلّ ملفّ. ولا يُمسّ اسمٌ يُقرأ.
 * والكتابةُ على الدرايف في الإنتاج وحده (`drive-readonly.ts`).
 */

import type { drive_v3 } from "googleapis";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, statements, suppliers } from "@/db/schema";
import { DriveAuthExpiredError, isDriveAuthError, probeFile, renameFile } from "@/lib/drive";
import { canonicalName, renameGate } from "@/lib/canonical-name";
import { resolveNameCollision } from "@/lib/naming";
import { recordAudit } from "@/lib/audit";

export interface RenameTarget {
  driveFileId: string;
  fileName: string;
  proposed: string;
}

export interface RenameOutcome {
  done: { from: string; to: string }[];
  failed: { from: string; error: string }[];
  authExpired: boolean;
}

/**
 * يسمّي في الدرايف ثمّ في القيد، ملفّاً ملفّاً. فشلُ ملفٍّ لا يوقف البقيّة
 * ويُعلَن؛ والتفويضُ المنتهي يوقفها لأنّها كلّها ستُردّ بالسبب نفسه.
 *
 * ولكلّ ملفٍّ أربعُ خطوات، بترتيبها:
 *   ١. يُسأل الدرايف عن اسمه الحاليّ (`renameGate`) — ما غُيّر هناك بيدٍ لا يُكتب فوقه.
 *   ٢. يُسأل القيدُ عن اسمٍ مثله في المجلّد نفسه — الدرايف يقبل اسمين متطابقين، فتُلحَق «(2)».
 *   ٣. يُكتب أثرُه **قبل** النداء: معرّفُ المستند ومعرّفُ الملفّ والاسمان. كان الأثرُ سطراً
 *      واحداً للدفعة يُكتب بعدها كلّها، بلا معرّف — فإن قُتل الطلب بعد عشرين تسمية
 *      وقعت في الأرشيف بلا أثر.
 *   ٤. يُسمّى، ثمّ يُحدَّث القيد — واسمُ الوصول يُحفظ مرّةً ولا يُكتب فوقه.
 */
export async function applyRenames(
  drive: drive_v3.Drive,
  targets: readonly RenameTarget[],
  trace: { actorId: string; via: string },
): Promise<RenameOutcome> {
  const done: RenameOutcome["done"] = [];
  const failed: RenameOutcome["failed"] = [];
  let authExpired = false;

  for (const t of targets) {
    const [doc] = await db
      .select({ id: documents.id, driveFolderId: documents.driveFolderId })
      .from(documents)
      .where(eq(documents.driveFileId, t.driveFileId))
      .limit(1);
    /* ما لا سجلَّ له عندنا لا يُمسّ */
    if (!doc) {
      failed.push({ from: t.fileName, error: "لا سجلَّ له عندنا — لم يُسمَّ" });
      continue;
    }

    let renamedInDrive = false;
    let proposed = t.proposed;
    try {
      const gate = renameGate(t.fileName, await probeFile(drive, t.driveFileId));
      if (!gate.go) {
        if (gate.liveName !== undefined) await adoptLiveName(doc.id, t, gate.liveName);
        failed.push({ from: t.fileName, error: gate.reason });
        continue;
      }

      const siblings = doc.driveFolderId
        ? await db.select({ fileName: documents.fileName }).from(documents)
            .where(and(eq(documents.driveFolderId, doc.driveFolderId), ne(documents.id, doc.id)))
        : [];
      proposed = resolveNameCollision(t.proposed, siblings.map((r) => r.fileName));

      await recordAudit({
        actorId: trace.actorId,
        action: "DRIVE_FILE_RENAME_INTENT",
        entityType: "document",
        entityId: doc.id,
        before: { fileName: t.fileName },
        after: { fileName: proposed, driveFileId: t.driveFileId, المصدر: trace.via },
      });

      await renameFile(drive, t.driveFileId, proposed);
      renamedInDrive = true;
      await db
        .update(documents)
        .set({ fileName: proposed, originalFileName: sql`coalesce(original_file_name, file_name)` })
        .where(eq(documents.driveFileId, t.driveFileId));
      done.push({ from: t.fileName, to: proposed });
    } catch (e) {
      /*
        وإن سُمّي في الدرايف وتعذّر قيدُه عندنا فهو **تسميةٌ وقعت**:
        تُسجَّل في الأثر بالاسمين، وإلّا بقي في الأرشيف تغييرٌ لا يعرف
        أحدٌ مصدره.
      */
      if (!renamedInDrive && (isDriveAuthError(e) || e instanceof DriveAuthExpiredError)) {
        authExpired = true;
        break;
      }
      if (renamedInDrive) done.push({ from: t.fileName, to: proposed });
      const error = renamedInDrive
        ? `سُمّي في الدرايف وتعذّر تحديث القيد: ${(e as Error).message}`
        : (e as Error).message;
      failed.push({ from: t.fileName, error });
      /* النيّةُ كُتبت قبل النداء — فما لم يقع يُقال إنّه لم يقع، بسببه */
      await recordAudit({
        actorId: trace.actorId,
        action: "DRIVE_FILE_RENAME_FAILED",
        entityType: "document",
        entityId: doc.id,
        before: { fileName: t.fileName },
        after: { fileName: proposed, driveFileId: t.driveFileId, المصدر: trace.via, السبب: error.slice(0, 300), "سُمّي في الدرايف": renamedInDrive },
      }).catch(() => undefined);
    }
  }
  return { done, failed, authExpired };
}

/** الاسمُ في الدرايف هو الحقيقة: يُحدَّث القيدُ به ويُكتب الاسمان، ولا يُسمّى الملفّ في هذه الدورة. */
async function adoptLiveName(documentId: string, t: RenameTarget, liveName: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(documents)
      .set({ fileName: liveName, originalFileName: sql`coalesce(original_file_name, file_name)` })
      .where(eq(documents.id, documentId));
    await recordAudit({
      actorId: null,
      action: "DRIVE_NAME_CHANGED_EXTERNALLY",
      entityType: "document",
      entityId: documentId,
      before: { fileName: t.fileName },
      after: { fileName: liveName, driveFileId: t.driveFileId },
    }, tx);
  });
}

/** ما يُسمّى في النداء الواحد — والباقي في الذي يليه، فلا يتجاوز المسارُ عمره. */
const MAX_AUTO = 25;

/**
 * يسمّي آلياً ما أُرشِف من هذه الملفّات ويخالف اسمُه الصيغة.
 *
 * `ARCHIVED` وحده: ما ينتظر المراجعة لا يُسمّى، فاسمُه يُبنى من قيدٍ لم
 * يُحسَم. وما لا يُبنى له اسمٌ يُترَك ويُعاد سببُه.
 */
export async function renameArchived(
  drive: drive_v3.Drive,
  /** `null`: كلُّ ما أُرشِف — لاستدراك ما سبق التسميةَ الآليّة. */
  driveFileIds: readonly string[] | null,
  actorId: string,
  via: string,
): Promise<RenameOutcome & { cannot: { current: string; reason: string }[] }> {
  if (driveFileIds !== null && driveFileIds.length === 0) return { done: [], failed: [], authExpired: false, cannot: [] };

  const rows = await db
    .select({
      driveFileId: documents.driveFileId,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      kind: documents.kind,
      slug: suppliers.slug,
      invoiceDate: invoices.invoiceDate,
      invoiceTotal: invoices.totalMinor,
      invoiceNumber: invoices.invoiceNumber,
      statementEnd: statements.periodEnd,
      statementTotal: statements.closingBalanceMinor,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(statements, eq(statements.documentId, documents.id))
    .where(driveFileIds === null
      ? and(isNotNull(documents.driveFileId), eq(documents.status, "ARCHIVED"))
      : and(inArray(documents.driveFileId, [...driveFileIds]), eq(documents.status, "ARCHIVED")));

  const targets: RenameTarget[] = [];
  const cannot: { current: string; reason: string }[] = [];
  for (const r of rows) {
    if (!r.driveFileId) continue;
    const verdict = canonicalName({
      driveFileId: r.driveFileId,
      fileName: r.fileName,
      mimeType: r.mimeType,
      kind: r.kind,
      slug: r.slug,
      date: (r.invoiceDate ?? r.statementEnd)?.toISOString().slice(0, 10) ?? null,
      totalMinor: r.invoiceTotal ?? r.statementTotal ?? null,
      invoiceNumber: r.invoiceNumber ?? null,
    });
    if (verdict.status === "RENAME") {
      targets.push({ driveFileId: r.driveFileId, fileName: r.fileName, proposed: verdict.proposed });
    } else if (verdict.status === "CANNOT") {
      cannot.push({ current: r.fileName, reason: verdict.reason });
    }
  }

  const outcome = await applyRenames(drive, targets.slice(0, MAX_AUTO), { actorId, via });
  if (outcome.done.length > 0) {
    await recordAudit({
      actorId,
      action: "DRIVE_FILE_RENAMED",
      entityType: "drive",
      entityId: "rename",
      after: {
        الفعل: "إعادة تسمية آليّة في الدرايف إلى الصيغة القياسية",
        المصدر: via,
        عدد: outcome.done.length,
        الملفّات: outcome.done.map((d) => `${d.from} ← ${d.to}`),
        فشل: outcome.failed.map((f) => `${f.from}: ${f.error}`),
      },
    });
  }
  return { ...outcome, cannot };
}
