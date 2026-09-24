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
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, statements, suppliers } from "@/db/schema";
import { isDriveAuthError, renameFile } from "@/lib/drive";
import { canonicalName } from "@/lib/canonical-name";
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
 */
export async function applyRenames(
  drive: drive_v3.Drive,
  targets: readonly RenameTarget[],
): Promise<RenameOutcome> {
  const done: RenameOutcome["done"] = [];
  const failed: RenameOutcome["failed"] = [];
  let authExpired = false;

  for (const t of targets) {
    let renamedInDrive = false;
    try {
      await renameFile(drive, t.driveFileId, t.proposed);
      renamedInDrive = true;
      await db
        .update(documents)
        .set({ fileName: t.proposed })
        .where(eq(documents.driveFileId, t.driveFileId));
      done.push({ from: t.fileName, to: t.proposed });
    } catch (e) {
      /*
        وإن سُمّي في الدرايف وتعذّر قيدُه عندنا فهو **تسميةٌ وقعت**:
        تُسجَّل في الأثر بالاسمين، وإلّا بقي في الأرشيف تغييرٌ لا يعرف
        أحدٌ مصدره.
      */
      if (!renamedInDrive && isDriveAuthError(e)) {
        authExpired = true;
        break;
      }
      if (renamedInDrive) done.push({ from: t.fileName, to: t.proposed });
      failed.push({
        from: t.fileName,
        error: renamedInDrive
          ? `سُمّي في الدرايف وتعذّر تحديث القيد: ${(e as Error).message}`
          : (e as Error).message,
      });
    }
  }
  return { done, failed, authExpired };
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

  const outcome = await applyRenames(drive, targets.slice(0, MAX_AUTO));
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
