/**
 * حالُ الدرايف — جوابُ «هل تعمل المزامنةُ والتسميةُ وحدهما؟» من الوقائع.
 *
 * المزامنةُ الآليّة تُطلَق من القشرة (`auto-process.tsx`) كلَّ ثلاث ساعات
 * لمن يملك أن يرفع، والتسميةُ تقع في الاستدراك كلَّ عشر دقائق. ولم يكن في
 * الشاشة ما يقول إنّهما وقعتا إلّا إن وجدتا جديداً — فصارت هنا:
 *
 *   - الربط: أله تفويضٌ من جوجل؟ (ووضعُ التجربة لا يستعير تفويضاً عمداً.)
 *   - آخرُ فحصٍ نجح، وآخرُ فحصٍ تعثّر وسببُه (046).
 *   - آخرُ ما وصل من الدرايف، وما ينتظر المراجعة منه.
 *   - التسمية: كم على الصيغة، وكم سيُسمّى في الاستدراك القادم، وكم لا يُبنى
 *     له اسم — بالحكم نفسه الذي يسمّي (`canonicalName`)، لا بنسخةٍ منه.
 *   - آخرُ ما فعلته المزامنةُ والتسميةُ، من سجلّ التدقيق بنصّه.
 */
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, documents, invoices, statements, suppliers, users } from "@/db/schema";
import { canonicalName, type NamedDocument } from "@/lib/canonical-name";
import { driveWritesAllowed } from "@/lib/drive-readonly";
import { previewAllowed } from "@/lib/preview-mode";
import { inboxCount } from "@/lib/work";
import { driveState, type DriveState } from "@/lib/drive-state";
import { refreshTokenFor } from "./drive.service";

export type NamedRecord = NamedDocument & {
  invoiceId: string | null;
  documentId: string;
  /** لم يُعتمَد بعد — اسمُه من قراءةٍ لم تُحسَم، فيُسمّى حين يُعتمَد. */
  pending: boolean;
};

/**
 * كلُّ ما له سجلٌّ عندنا من ملفّات الدرايف (عدا المرفوض) ببيانات اسمه
 * القياسيّ. مصدرٌ واحد لمعاينة التسمية (`/api/drive-rename`) ولحال الدرايف.
 */
export async function loadNamedDocuments(): Promise<NamedRecord[]> {
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
      invoiceId: invoices.id,
      documentId: documents.id,
      status: documents.status,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(statements, eq(statements.documentId, documents.id))
    /*
      كلُّ ما له سجلٌّ عندنا — لا المؤرشَف وحده.

      كان الشرط `status = ARCHIVED`، والملفّ الذي تسجّله المزامنة للتوّ
      يكون `PENDING` أو `NEEDS_REVIEW`. فتقترح المزامنة تسميته، ثمّ
      تطلبها، فلا يجده مسارُ التسمية في قائمته فيردّ «أُعيدت تسمية ٠
      ملفّاً» — طلبٌ نُفِّذ وأثرُه صفر، ولا يُقال السبب.

      والضمان المعلَن «ما له سجلٌّ عندنا وحده» لا يشترط الأرشفة؛ يشترط
      أن نعرف الملفّ. والمرفوض يُستثنى: قررنا ألّا نقيّده، فلا نكتب في
      اسمه.
    */
    .where(and(ne(documents.status, "REJECTED"), isNotNull(documents.driveFileId)));

  return rows
    .filter((r): r is typeof r & { driveFileId: string } => Boolean(r.driveFileId))
    .map((r) => ({
      driveFileId: r.driveFileId,
      fileName: r.fileName,
      mimeType: r.mimeType,
      kind: r.kind,
      slug: r.slug,
      date: (r.invoiceDate ?? r.statementEnd)?.toISOString().slice(0, 10) ?? null,
      totalMinor: r.invoiceTotal ?? r.statementTotal ?? null,
      invoiceNumber: r.invoiceNumber ?? null,
      invoiceId: r.invoiceId ?? null,
      documentId: r.documentId,
      pending: r.status !== "ARCHIVED",
    }));
}

/* ─────────────────────────── أثرُ الفحص (046) ─────────────────────────── */

/** فحصٌ نجح بتفويض هذا المستخدم — وإن لم يجد جديداً. */
export async function markDriveChecked(userId: string): Promise<void> {
  await db.update(users).set({ driveCheckedAt: new Date() }).where(eq(users.id, userId));
}

/** فحصٌ تعثّر — يُحفظ سببُه بنصّه ليُقال في الشاشة لا ليُبتلَع. */
export async function markDriveFailed(userId: string, reason: string): Promise<void> {
  await db
    .update(users)
    .set({ driveFailedAt: new Date(), driveFailedReason: reason.slice(0, 500) })
    .where(eq(users.id, userId));
}

/* ─────────────────────────── الحال ─────────────────────────── */

export interface DriveActivity {
  id: string;
  at: Date;
  kind: "SYNCED" | "RENAMED";
  actor: string | null;
  /** سطرُ الخلاصة: «سُجّل ٣ ملفّات» أو «سُمّي ملفّان». */
  count: number;
  /** الأسماء: «القديم ← الجديد» للتسمية، ولا شيء للمزامنة. */
  lines: string[];
}

export interface DriveStatus extends DriveHeartbeat {
  /** الكتابةُ على الدرايف (التسمية) — في الإنتاج وحده. */
  writesAllowed: boolean;
  fromDrive: number;
  lastArrivalAt: Date | null;
  arrivedLast7Days: number;
  waitingReview: number;
  naming: {
    /** ما نعرفه من ملفّات الدرايف (عدا المرفوض). */
    known: number;
    onStandard: number;
    /** مؤرشَفٌ اسمُه خارج الصيغة — يُسمّى في الاستدراك القادم. */
    toRenameArchived: number;
    /** ينتظر المراجعة — يُسمّى حين يُعتمَد. */
    toRenamePending: number;
    /** لا يُبنى له اسمٌ من المقيَّد — ينقصه رقمٌ أو تاريخ. */
    cannot: number;
  };
  recent: DriveActivity[];
}

function countOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function linesOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** حقلٌ من أثر التدقيق (`jsonb`) — بلا افتراضٍ عن شكله. */
function field(after: unknown, key: string): unknown {
  return typeof after === "object" && after !== null && Object.hasOwn(after, key) ? Reflect.get(after, key) : undefined;
}

function toActivity(r: { id: string; at: Date; action: string; actor: string | null; after: unknown }): DriveActivity {
  if (r.action === "DRIVE_FILE_RENAMED") {
    const lines = linesOf(field(r.after, "الملفّات"));
    return { id: r.id, at: r.at, kind: "RENAMED", actor: r.actor, count: countOf(field(r.after, "عدد")) || lines.length, lines };
  }
  return { id: r.id, at: r.at, kind: "SYNCED", actor: r.actor, count: countOf(field(r.after, "سُجّلت")), lines: [] };
}

/**
 * نبضُ الدرايف — حالُه بكلمة (`driveState`)، وآخرُ فحصٍ نجح، وآخرُ تعثّرٍ
 * أحدثُ منه وسببُه. خفيفٌ لرأس «المستندات» ولمركز الإشعارات.
 */
export interface DriveHeartbeat {
  state: DriveState;
  previewMode: boolean;
  /** أله تفويضُ درايف؟ — `null` في وضع التجربة: السؤالُ لا معنى له. */
  connected: boolean | null;
  checkedAt: Date | null;
  failure: { at: Date; reason: string } | null;
}

export async function loadDriveHeartbeat(userId: string): Promise<DriveHeartbeat> {
  const previewMode = previewAllowed(process.env);
  const [[checked], [failed], token] = await Promise.all([
    db.select({ at: sql<Date | null>`max(${users.driveCheckedAt})` }).from(users),
    /* آخرُ تعثّرٍ بسببه في صفٍّ واحد — لا مطابقةَ لاحقة بالوقت */
    db
      .select({ at: users.driveFailedAt, reason: users.driveFailedReason })
      .from(users)
      .where(isNotNull(users.driveFailedAt))
      .orderBy(desc(users.driveFailedAt))
      .limit(1),
    previewMode ? Promise.resolve(null) : refreshTokenFor(userId),
  ]);
  const checkedAt = checked?.at ? new Date(checked.at) : null;
  const failedAt = failed?.at ?? null;
  const connected = previewMode ? null : token !== null;
  const state = driveState({ previewMode, connected, checkedAt, failedAt });
  const failure = state === "failing" && failedAt ? { at: failedAt, reason: failed?.reason ?? "تعذّر الفحص." } : null;
  return { state, previewMode, connected, checkedAt, failure };
}

export async function loadDriveStatus(userId: string): Promise<DriveStatus> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [beat, arrivals, waiting, named, recentRows] = await Promise.all([
    loadDriveHeartbeat(userId),
    db
      .select({
        total: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${documents.uploadedAt})`,
        week: sql<number>`count(*) filter (where ${documents.uploadedAt} >= ${weekAgo})::int`,
      })
      .from(documents)
      .where(isNotNull(documents.driveFileId)),
    /* العددُ نفسُه الذي في شارة «المستندات» — لا عدٌّ ثانٍ بشرطٍ آخر */
    inboxCount(),
    loadNamedDocuments(),
    db
      .select({ id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, after: auditLogs.after, actor: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(inArray(auditLogs.action, ["DRIVE_SYNCED", "DRIVE_FILE_RENAMED"]))
      .orderBy(desc(auditLogs.at))
      .limit(8),
  ]);

  const naming = { known: named.length, onStandard: 0, toRenameArchived: 0, toRenamePending: 0, cannot: 0 };
  for (const d of named) {
    const v = canonicalName(d);
    if (v.status === "OK") naming.onStandard++;
    else if (v.status === "CANNOT") naming.cannot++;
    else if (d.pending) naming.toRenamePending++;
    else naming.toRenameArchived++;
  }

  const a = arrivals[0];
  return {
    ...beat,
    writesAllowed: driveWritesAllowed(process.env),
    fromDrive: a?.total ?? 0,
    lastArrivalAt: a?.last ? new Date(a.last) : null,
    arrivedLast7Days: a?.week ?? 0,
    waitingReview: waiting,
    naming,
    recent: recentRows.map(toActivity),
  };
}
