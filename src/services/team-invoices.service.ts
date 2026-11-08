/**
 * فواتيرُ الفريق عند موظّف المشتريات في «TPH Team» — ما صوّره أيُّ موظّفٍ يصله ليُدخله في فودكس،
 * ويُنبَّه بكلّ فاتورةٍ تصل (أحمد، ٨ نوفمبر ٢٠٢٦).
 *
 *   صورةٌ تُرسَل (`/api/capture/scan/submit`) ← نداءٌ فارغ لجوال كلّ مستلم (`notifyInvoiceReceivers`)
 *   ← عاملُ الخدمة يسأل `/api/team/push-brief` برمز رابطه عن النصّ ← يفتح «الفواتير» فيرى الصورة
 *   ويعلّمها «أدخلتها في فودكس».
 *
 * المستلمُ صلاحيةٌ يمنحها المالك (`employees.invoices_since`) لا اسمٌ في الشيفرة. ولا يرى إلّا
 * الصورة وما قُرئ منها (المورّد · الرقم · التاريخ · الإجمالي) — لا دفاترَ ولا أرصدة.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { captureLinks, captures, documents, employees, extractionCache, teamPushSubscriptions } from "@/db/schema";
import { judgeClarity } from "@/lib/capture-clarity";
import { extractionSchema } from "@/lib/extraction/schema";
import { isPushEndpoint, pushConfig, pushOutcome, pushRequest } from "@/lib/push/web-push";
import { pgErrorCode } from "@/lib/pg-error";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";

/** نافذةُ القائمة — ما أقدمُ منها أُدخل غالباً أو لم يعد يُنتظر. */
export const INBOX_DAYS = 45;

export interface InboxInvoice {
  id: string;
  sender: string;
  createdAt: Date;
  note: string | null;
  mimeType: string;
  /** الصورةُ ما زالت في القاعدة (تنتظر)، أو في الدرايف بعد أرشفتها. `false`: لا ملفّ يُعرض. */
  viewable: boolean;
  status: "PENDING" | "ARCHIVED";
  read: { supplier: string | null; invoiceNumber: string | null; invoiceDate: string | null; total: string | null } | null;
  enteredAt: Date | null;
  enteredBy: string | null;
}

/**
 * فواتيرُ الفريق — ما لم يُدخَل أوّلاً، ثمّ المُدخَلةُ الأحدث. المرفوضةُ لا تصله، ولا ما وصل قبل أن
 * يصير مستلماً (`receivedSince`) — فلا يُغرَق بما أُدخل من قبل.
 */
export async function invoiceInbox(receivedSince: Date, today = todayInRiyadh()): Promise<InboxInvoice[]> {
  try {
    const window = new Date(`${addDays(today, -INBOX_DAYS)}T00:00:00+03:00`);
    const since = receivedSince > window ? receivedSince : window;
    const rows = await db.select({
      id: captures.id, sender: captureLinks.label, createdAt: captures.createdAt, note: captures.note, mimeType: captures.mimeType,
      status: captures.status, hasData: sql<boolean>`${captures}.file_data is not null`, driveFileId: documents.driveFileId,
      extraction: extractionCache.extraction, enteredAt: captures.foodicsEnteredAt, enteredBy: employees.name,
    }).from(captures)
      .innerJoin(captureLinks, eq(captureLinks.id, captures.linkId))
      .leftJoin(documents, eq(documents.id, captures.documentId))
      .leftJoin(extractionCache, eq(extractionCache.sha256, captures.sha256))
      .leftJoin(employees, eq(employees.id, captures.foodicsEnteredBy))
      .where(and(inArray(captures.status, ["PENDING", "ARCHIVED"]), gte(captures.createdAt, since)))
      .orderBy(desc(captures.createdAt)).limit(120);
    const out = rows.map((r) => {
      const parsed = r.extraction ? extractionSchema.safeParse(r.extraction) : null;
      const verdict = parsed?.success ? judgeClarity(parsed.data) : null;
      return {
        id: r.id, sender: r.sender, createdAt: r.createdAt, note: r.note, mimeType: r.mimeType,
        viewable: Boolean(r.hasData) || Boolean(r.driveFileId),
        status: r.status === "ARCHIVED" ? "ARCHIVED" as const : "PENDING" as const,
        read: verdict ? { supplier: verdict.read.supplier, invoiceNumber: verdict.read.invoiceNumber, invoiceDate: verdict.read.invoiceDate, total: verdict.read.total } : null,
        enteredAt: r.enteredAt, enteredBy: r.enteredBy,
      };
    });
    return [...out.filter((x) => !x.enteredAt), ...out.filter((x) => x.enteredAt)];
  } catch (e) {
    if (pgErrorCode(e) === "42703" || pgErrorCode(e) === "42P01") return [];
    throw e;
  }
}

/** أدخلها في فودكس — أو يتراجع. لا يمسّ حالَ الصورة ولا الدفاتر. */
export async function markEnteredInFoodics(captureId: string, employeeId: string, entered: boolean): Promise<boolean> {
  const done = await db.update(captures)
    .set(entered ? { foodicsEnteredAt: new Date(), foodicsEnteredBy: employeeId } : { foodicsEnteredAt: null, foodicsEnteredBy: null })
    .where(and(eq(captures.id, captureId), ne(captures.status, "DRAFT"), ne(captures.status, "REJECTED"), entered ? isNull(captures.foodicsEnteredAt) : isNotNull(captures.foodicsEnteredAt)))
    .returning({ id: captures.id });
  return done.length > 0;
}

/** أين ملفُّ الصورة: في القاعدة (تنتظر)، أو في الدرايف بعد أرشفتها ومن أرشفها (بتفويضه يُقرأ). */
export async function inboxFileRef(captureId: string): Promise<
  | { kind: "DB"; data: Buffer; mimeType: string; fileName: string }
  | { kind: "DRIVE"; driveFileId: string; mimeType: string; fileName: string; ownerId: string | null }
  | null
> {
  const [row] = await db.select({
    data: captures.fileData, mimeType: captures.mimeType, fileName: captures.originalFileName, status: captures.status,
    driveFileId: documents.driveFileId, docMime: documents.mimeType, docName: documents.fileName, decidedById: captures.decidedById,
  }).from(captures).leftJoin(documents, eq(documents.id, captures.documentId)).where(eq(captures.id, captureId)).limit(1);
  if (!row || (row.status !== "PENDING" && row.status !== "ARCHIVED")) return null;
  if (row.data) return { kind: "DB", data: row.data, mimeType: row.mimeType, fileName: row.fileName ?? "فاتورة.jpg" };
  if (row.driveFileId) return { kind: "DRIVE", driveFileId: row.driveFileId, mimeType: row.docMime ?? row.mimeType, fileName: row.docName ?? "فاتورة", ownerId: row.decidedById };
  return null;
}

/** فواتيرُ لم تُدخَل بعد — نصُّ التنبيه وشارةُ التبويب. */
export async function unenteredCount(receivedSince: Date, today = todayInRiyadh()): Promise<number> {
  return (await invoiceInbox(receivedSince, today)).filter((x) => !x.enteredAt).length;
}

/* ─────────────────────────── التنبيه ─────────────────────────── */

export async function saveTeamSubscription(employeeId: string, sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string | null): Promise<void> {
  if (!pushConfig(process.env)) throw new Error("التنبيهات غير مفعّلة على الخادم بعد.");
  if (!isPushEndpoint(sub.endpoint)) throw new Error("هذا المتصفح يستعمل خدمة إشعارات غير معروفة.");
  await db.insert(teamPushSubscriptions).values({ employeeId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent })
    .onConflictDoUpdate({ target: teamPushSubscriptions.endpoint, set: { employeeId, p256dh: sub.p256dh, auth: sub.auth, userAgent, failures: 0, lastError: null } });
}

export async function hasTeamSubscription(employeeId: string): Promise<boolean> {
  try {
    const [r] = await db.select({ id: teamPushSubscriptions.id }).from(teamPushSubscriptions).where(eq(teamPushSubscriptions.employeeId, employeeId)).limit(1);
    return Boolean(r);
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return false;
    throw e;
  }
}

/**
 * نداءٌ فارغ لجوال كلّ مستلمٍ للفواتير — إلّا مُرسلَها نفسَه. وما انتهى اشتراكُه يُمحى. لا يرمي:
 * تعثّرُ التنبيه لا يُسقط إرسالَ الصورة.
 */
export async function notifyInvoiceReceivers(senderEmployeeId: string | null, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<number> {
  const config = pushConfig(process.env);
  if (!config) return 0;
  try {
    const rows = await db.select({ id: teamPushSubscriptions.id, endpoint: teamPushSubscriptions.endpoint, employeeId: teamPushSubscriptions.employeeId })
      .from(teamPushSubscriptions).innerJoin(employees, eq(employees.id, teamPushSubscriptions.employeeId))
      .where(and(sql`${employees}.invoices_since is not null`, sql`(${employees}.left_on is null or ${employees}.left_on >= ${todayInRiyadh(now)})`));
    let sent = 0;
    for (const row of rows) {
      if (row.employeeId === senderEmployeeId || !isPushEndpoint(row.endpoint)) continue;
      let status = 0, error: string | null = null;
      try {
        const res = await fetchImpl(row.endpoint, { ...pushRequest(row.endpoint, config, now), signal: AbortSignal.timeout(10_000) });
        status = res.status;
        if (status >= 300) error = `ردّ مزوّد الإشعار ${status}`;
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 160) : "تعذّر الاتصال بمزوّد الإشعار";
      }
      const outcome = status ? pushOutcome(status) : "failed";
      if (outcome === "sent") {
        sent++;
        await db.update(teamPushSubscriptions).set({ lastSentAt: now, failures: 0, lastError: null }).where(eq(teamPushSubscriptions.id, row.id));
      } else if (outcome === "gone") {
        await db.delete(teamPushSubscriptions).where(eq(teamPushSubscriptions.id, row.id));
      } else {
        await db.update(teamPushSubscriptions).set({ failures: sql`${teamPushSubscriptions}.failures + 1`, lastError: error }).where(eq(teamPushSubscriptions.id, row.id));
      }
    }
    return sent;
  } catch (e) {
    console.error("[team-push] تعذّر تنبيه مستلمي الفواتير", e);
    return 0;
  }
}

/** موظّفُ رابط التصوير — `null` لجوال الكاشير المشترك. */
export async function employeeOfLink(linkId: string): Promise<string | null> {
  const [r] = await db.select({ employeeId: captureLinks.employeeId }).from(captureLinks).where(eq(captureLinks.id, linkId)).limit(1);
  return r?.employeeId ?? null;
}
