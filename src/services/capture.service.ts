/**
 * صورُ الفريق — من رابط الباريستا إلى إقرار صاحب العمل.
 *
 *   رابطٌ شخصيّ (بلا دخول) ← فحصُ الوضوح بقراءة الذكاء ← صورةٌ تنتظر في القاعدة
 *   ← صاحبُ العمل يفتحها في شاشة الرفع ويؤرشفها (`/api/archive` بـ`captureId`)
 *   أو يرفضها بسببها، فيرى الباريستا السبب.
 *
 * الرابطُ لا يملك إلّا أن يضع صورةً في الانتظار: لا يرى مستنداً ولا مبلغاً
 * غير ما قُرئ من ورقته هو، ولا يكتب في الدرايف ولا في الدفاتر.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { captureLinks, captures, documents, extractionCache, invoices, suppliers as suppliers_ } from "@/db/schema";
import { labelRecorded, type RecordedLabel } from "@/lib/capture-recorded";
import type { ExtractionResult } from "@/lib/extraction/schema";
import { companyConfig } from "@/config/drive";
import { recordAudit } from "@/lib/audit";
import { judgeClarity, type ClarityVerdict } from "@/lib/capture-clarity";
import { extractDocument, isSupportedUpload, uploadMimeType } from "@/lib/extraction";
import { isReaderOutage } from "@/lib/extraction/provider";
import { extractionSchema } from "@/lib/extraction/schema";
import { signatureMatches, sniffMimeType } from "@/lib/file-signature";
import { loadCachedReading, saveCachedReading } from "./reading-cache.service";
import { loadSupplierRecords } from "./upload-review.service";
import { pgErrorCode } from "./guard";
import type { Tx } from "./types";

/** حدُّ المنصّة لجسم الطلب ٤٫٥ ميجابايت — والماسحُ يُخرج دون ١٫٥ عادةً */
export const CAPTURE_MAX_BYTES = 4 * 1024 * 1024;

/** قراءةُ الفحص تبقى صالحةً حتّى يفتحها صاحبُ العمل — لا تُدفع ثانيةً بعد يوم */
export const CAPTURE_READING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{24,64}$/;

export class CaptureInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "CaptureInputError";
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/* ───────────────────────── الروابط ───────────────────────── */

export interface CaptureLink { id: string; label: string; createdById: string | null }

/** الرابطُ القائم لهذا الرمز — أو `null`: لا وجود له أو أُلغي. */
export async function resolveLink(token: string | null | undefined): Promise<CaptureLink | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const [row] = await db
    .select({ id: captureLinks.id, label: captureLinks.label, createdById: captureLinks.createdById })
    .from(captureLinks)
    .where(and(eq(captureLinks.tokenHash, hashToken(token)), isNull(captureLinks.revokedAt)))
    .limit(1);
  return row ?? null;
}

/** يُنشئ رابطاً ويُرجع رمزه — مرّةً واحدة: لا يُحفظ إلّا بصمتُه. */
export async function createLink(label: string, actorId: string): Promise<{ id: string; token: string }> {
  const token = randomBytes(24).toString("base64url");
  return db.transaction(async (t) => {
    const [row] = await t
      .insert(captureLinks)
      .values({ label: label.trim(), tokenHash: hashToken(token), createdById: actorId })
      .returning({ id: captureLinks.id });
    await recordAudit({ actorId, action: "DOCUMENT_CAPTURE_LINK_CREATED", entityType: "capture_link", entityId: row.id, after: { label: label.trim() } }, t);
    return { id: row.id, token };
  });
}

export async function revokeLink(id: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const rows = await t
      .update(captureLinks)
      .set({ revokedAt: new Date(), revokedById: actorId })
      .where(and(eq(captureLinks.id, id), isNull(captureLinks.revokedAt)))
      .returning({ id: captureLinks.id, label: captureLinks.label });
    if (rows.length === 0) return false;
    await recordAudit({ actorId, action: "DOCUMENT_CAPTURE_LINK_REVOKED", entityType: "capture_link", entityId: id, before: { label: rows[0].label } }, t);
    return true;
  });
}

export interface CaptureLinkRow {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  sent: number;
  waiting: number;
}

export async function listLinks(): Promise<CaptureLinkRow[]> {
  const rows = await db
    .select({
      id: captureLinks.id,
      label: captureLinks.label,
      createdAt: captureLinks.createdAt,
      lastUsedAt: captureLinks.lastUsedAt,
      sent: sql<number>`(select count(*)::int from ${captures} where ${captures}.link_id = ${captureLinks}.id and ${captures}.status <> 'DRAFT')`,
      waiting: sql<number>`(select count(*)::int from ${captures} where ${captures}.link_id = ${captureLinks}.id and ${captures}.status = 'PENDING')`,
    })
    .from(captureLinks)
    .where(isNull(captureLinks.revokedAt))
    .orderBy(captureLinks.label);
  return rows.map((r) => ({ ...r, sent: Number(r.sent), waiting: Number(r.waiting) }));
}

/* ───────────────────────── الملفّ ───────────────────────── */

export interface InspectedFile {
  buffer: Buffer;
  mimeType: string;
  sha256: string;
  fileName: string;
}

/** حجمٌ ونوعٌ من بصمة الملفّ لا ممّا أعلنه المتصفّح — كما في `/api/analyze`. */
export async function inspectFile(file: unknown): Promise<InspectedFile> {
  if (!(file instanceof File)) throw new CaptureInputError("لم تصل أي صورة. صوّر الفاتورة مرة أخرى.");
  if (file.size === 0) throw new CaptureInputError("الصورة فارغة. صوّرها مرة أخرى.");
  if (file.size > CAPTURE_MAX_BYTES) throw new CaptureInputError("الصورة أكبر من ٤ ميجابايت. صوّر صفحات أقل في المرة الواحدة.");
  const declared = uploadMimeType(file.type, file.name);
  if (!isSupportedUpload(declared)) throw new CaptureInputError("هذا الملف ليس صورة. صوّر الفاتورة بالكاميرا.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMimeType(buffer);
  if (!sniffed) throw new CaptureInputError("هذا الملف ليس صورة ولا PDF. صوّر الفاتورة بالكاميرا.");
  return {
    buffer,
    mimeType: signatureMatches(declared, buffer) ? declared : sniffed,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    fileName: (file.name || "فاتورة.jpg").slice(0, 160),
  };
}

/** أوصلت هذه الصورةُ من قبل؟ — مستندٌ مؤرشف، أو صورةٌ تنتظر. والمرفوضُ والمسودّةُ لا يُعدّان. */
export async function alreadyArrived(sha256: string): Promise<"DOCUMENT" | "CAPTURE" | null> {
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.sha256, sha256), ne(documents.status, "REJECTED")))
    .limit(1);
  if (doc) return "DOCUMENT";
  const [cap] = await db
    .select({ id: captures.id })
    .from(captures)
    .where(and(eq(captures.sha256, sha256), notInArray(captures.status, ["REJECTED", "DRAFT"])))
    .limit(1);
  return cap ? "CAPTURE" : null;
}

/* ───────────────────────── القراءة ───────────────────────── */

export type ClarityOutcome =
  | { ok: true; verdict: ClarityVerdict }
  /** القارئُ متوقّف — ليس عيباً في الصورة، فتُرسَل وتُقرأ لاحقاً */
  | { ok: false; outage: true; message: string }
  | { ok: false; outage: false; message: string };

/**
 * يقرأ الصورة بالذكاء ويحكم بوضوحها. القراءةُ تُحفظ ببصمة الملفّ في
 * `extraction_cache`، فلا يدفع صاحبُ العمل ثمنَها ثانيةً حين يفتحها.
 */
export async function readForClarity(file: InspectedFile, cacheOwnerId: string | null): Promise<ClarityOutcome> {
  /* معاً لا تباعاً: الباريستا ينتظر، وقائمةُ المورّدين رخيصةٌ إن لم يُحتج إليها */
  const [cached, suppliers] = await Promise.all([
    loadCachedReading(file.sha256, CAPTURE_READING_MAX_AGE_MS),
    loadSupplierRecords(),
  ]);
  const reading = cached ?? await extractDocument({
    data: file.buffer,
    mimeType: file.mimeType,
    companyVat: companyConfig.vatNumber,
    companyName: companyConfig.nameAr,
    supplierNames: suppliers.map((s) => `${s.nameAr} (${s.slug})`),
  });
  if (!reading.ok) {
    if (isReaderOutage(reading)) {
      return { ok: false, outage: true, message: "القراءة الآلية متوقفة الآن. أرسل الصورة كما هي، وسيقرؤها النظام لاحقاً." };
    }
    return { ok: false, outage: false, message: "لم يستطع النظام قراءة هذه الصورة. صوّرها مرة أخرى في إضاءة أفضل." };
  }
  if (!cached) await saveCachedReading(file.sha256, reading, cacheOwnerId);
  return { ok: true, verdict: judgeClarity(reading.value) };
}

/* ───────────────────────── المسودّة ───────────────────────── */

/** ما لم يُرسَل من المسودّات بعد هذا يُمحى — صورةٌ تُركت، لا مستندٌ ولا مال */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * يحفظ صورةَ الفحص مسودّةً فلا يرفعها «أرسل» ثانيةً — الرفعُ من جوال المقهى هو
 * أكثرُ زمن الإرسال (٢٫٧ ثانية لـ٣١١ ك.ب، و٨٫٨ لـ٨٠٨ ك.ب في الإنتاج).
 * والصورةُ نفسُها مفحوصةً ثانيةً تعود بمسودّتها لا بأخرى.
 */
export async function saveDraft(link: CaptureLink, file: InspectedFile): Promise<string> {
  await db.delete(captures).where(and(eq(captures.status, "DRAFT"), lt(captures.createdAt, new Date(Date.now() - DRAFT_MAX_AGE_MS))));
  const reuse = async () => {
    const [row] = await db
      .update(captures)
      .set({ linkId: link.id })
      .where(and(eq(captures.sha256, file.sha256), eq(captures.status, "DRAFT")))
      .returning({ id: captures.id });
    return row?.id ?? null;
  };
  const existing = await reuse();
  if (existing) return existing;
  try {
    const [row] = await db
      .insert(captures)
      .values({
        linkId: link.id,
        status: "DRAFT",
        fileData: file.buffer,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,
        sha256: file.sha256,
        originalFileName: file.fileName,
      })
      .returning({ id: captures.id });
    return row.id;
  } catch (e) {
    /* فحصان للصورة نفسها معاً: الفهرسُ الفريد ردّ الثاني، فمسودّةُ الأوّل هي */
    if (pgErrorCode(e) === "23505") {
      const again = await reuse();
      if (again) return again;
    }
    throw e;
  }
}

/* ───────────────────────── الإرسال ───────────────────────── */

export type SaveOutcome = { kind: "SAVED"; id: string } | { kind: "DUPLICATE"; where: "DOCUMENT" | "CAPTURE" };

/**
 * «أرسل» لمسودّة الفحص: تصير «تنتظر» بمعرّفها، بلا رفعٍ ثانٍ.
 *
 * `null`: لا مسودّةَ بهذا المعرّف لهذا الرابط (مُحيت بعد يوم، أو من رابطٍ آخر) —
 * فيرفع الجوالُ الملفَّ كما كان. والضغطتان معاً: الثانيةُ تجدها «تنتظر» فتُجاب بها.
 */
export async function submitDraft(link: CaptureLink, draftId: string, note: string | null): Promise<{ id: string; sha256: string } | null> {
  const clean = note?.trim() ? note.trim().slice(0, 300) : null;
  return db.transaction(async (t) => {
    const [row] = await t
      .update(captures)
      .set({ status: "PENDING", note: clean, createdAt: new Date() })
      .where(and(eq(captures.id, draftId), eq(captures.linkId, link.id), eq(captures.status, "DRAFT")))
      .returning({ id: captures.id, sha256: captures.sha256 });
    if (row) {
      await t.update(captureLinks).set({ lastUsedAt: new Date() }).where(eq(captureLinks.id, link.id));
      return row;
    }
    const [already] = await t
      .select({ id: captures.id, sha256: captures.sha256 })
      .from(captures)
      .where(and(eq(captures.id, draftId), eq(captures.linkId, link.id), eq(captures.status, "PENDING")))
      .limit(1);
    return already ?? null;
  });
}

export async function saveCapture(link: CaptureLink, file: InspectedFile, note: string | null): Promise<SaveOutcome> {
  const where = await alreadyArrived(file.sha256);
  if (where) return { kind: "DUPLICATE", where };
  try {
    const id = await db.transaction(async (t) => {
      /* لها مسودّةٌ من الفحص (ضاع معرّفُها): تصير هي «تنتظر» — وإلّا ردّها الفهرسُ الفريد «مكرّرة» ولم يصل شيء */
      const [draft] = await t
        .update(captures)
        .set({ status: "PENDING", linkId: link.id, note: note?.trim() ? note.trim().slice(0, 300) : null, createdAt: new Date() })
        .where(and(eq(captures.sha256, file.sha256), eq(captures.status, "DRAFT")))
        .returning({ id: captures.id });
      if (draft) {
        await t.update(captureLinks).set({ lastUsedAt: new Date() }).where(eq(captureLinks.id, link.id));
        return draft.id;
      }
      const [row] = await t
        .insert(captures)
        .values({
          linkId: link.id,
          fileData: file.buffer,
          mimeType: file.mimeType,
          sizeBytes: file.buffer.length,
          sha256: file.sha256,
          originalFileName: file.fileName,
          note: note?.trim() ? note.trim().slice(0, 300) : null,
        })
        .returning({ id: captures.id });
      await t.update(captureLinks).set({ lastUsedAt: new Date() }).where(eq(captureLinks.id, link.id));
      return row.id;
    });
    return { kind: "SAVED", id };
  } catch (e) {
    /* ضغطتان معاً: الفهرسُ الفريد ردّ الثانية — والأولى وصلت */
    if (pgErrorCode(e) === "23505") return { kind: "DUPLICATE", where: "CAPTURE" };
    throw e;
  }
}

/**
 * بعد الإرسال: إن لم تُقرأ الصورةُ في الفحص (القارئ متوقّف، أو أُرسلت بلا فحص)
 * فتُقرأ الآن، ويُكتب متى أو لماذا تعثّرت. لا يرمي — يعمل بعد الردّ.
 */
export async function readCaptureLater(captureId: string, cacheOwnerId: string | null): Promise<void> {
  try {
    const [row] = await db
      .select({ fileData: captures.fileData, mimeType: captures.mimeType, sha256: captures.sha256, name: captures.originalFileName })
      .from(captures)
      .where(and(eq(captures.id, captureId), eq(captures.status, "PENDING")))
      .limit(1);
    if (!row?.fileData) return;
    const out = await readForClarity(
      { buffer: row.fileData, mimeType: row.mimeType, sha256: row.sha256, fileName: row.name ?? "" },
      cacheOwnerId,
    );
    await db
      .update(captures)
      .set(out.ok ? { readAt: new Date(), readError: null } : { readError: out.message })
      .where(eq(captures.id, captureId));
  } catch (e) {
    console.error("[capture] تعذّرت قراءة الصورة بعد إرسالها", captureId, e);
  }
}

/* ───────────────────────── ما يراه الباريستا ───────────────────────── */

export interface SentCapture {
  id: string;
  createdAt: Date;
  status: "PENDING" | "ARCHIVED" | "REJECTED";
  note: string | null;
  decisionNote: string | null;
}

const asStatus = (s: string): SentCapture["status"] => (s === "ARCHIVED" || s === "REJECTED" ? s : "PENDING");

export async function recentForLink(linkId: string, limit = 15): Promise<SentCapture[]> {
  const rows = await db
    .select({ id: captures.id, createdAt: captures.createdAt, status: captures.status, note: captures.note, decisionNote: captures.decisionNote })
    .from(captures)
    .where(and(eq(captures.linkId, linkId), ne(captures.status, "DRAFT")))
    .orderBy(desc(captures.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, status: asStatus(r.status) }));
}

/* ───────────────────────── ما يراه صاحبُ العمل ───────────────────────── */

export interface PendingCapture {
  id: string;
  sender: string;
  createdAt: Date;
  note: string | null;
  mimeType: string;
  sizeBytes: number;
  /** ما قُرئ منها — `null`: لم تُقرأ بعد (أو تعثّرت، و`readError` سببُه) */
  verdict: ClarityVerdict | null;
  readError: string | null;
  /** أمسجّلةٌ من قبل؟ (`capture-recorded.ts`) — `null`: لا شيء في الدفاتر يطابقها */
  recorded: RecordedLabel | null;
}

export async function listPendingCaptures(): Promise<PendingCapture[]> {
  const rows = await db
    .select({
      id: captures.id,
      sender: captureLinks.label,
      createdAt: captures.createdAt,
      note: captures.note,
      mimeType: captures.mimeType,
      sizeBytes: captures.sizeBytes,
      readError: captures.readError,
      extraction: extractionCache.extraction,
    })
    .from(captures)
    .innerJoin(captureLinks, eq(captureLinks.id, captures.linkId))
    .leftJoin(extractionCache, eq(extractionCache.sha256, captures.sha256))
    .where(eq(captures.status, "PENDING"))
    .orderBy(captures.createdAt);
  const parsedRows = rows.map(({ extraction, ...r }) => {
    const parsed = extraction ? extractionSchema.safeParse(extraction) : null;
    return { ...r, reading: parsed?.success ? parsed.data : null };
  });
  const labels = await labelRecordedCaptures(parsedRows);
  return parsedRows.map(({ reading, ...r }) => ({
    ...r,
    verdict: reading ? judgeClarity(reading) : null,
    recorded: labels.get(r.id) ?? null,
  }));
}

/**
 * يقابل قراءاتِ الصور بالفواتير المقيَّدة — مرّةً للقائمة كلّها لا لكلّ صورة. وما قُيِّد
 * من كشف المورّد بلا ملفّ (`documents.origin`) يُميَّز: ملفُّه ينتظر، فلا يُترك.
 */
async function labelRecordedCaptures(
  rows: readonly { id: string; reading: ExtractionResult | null }[],
): Promise<Map<string, RecordedLabel>> {
  const readable = rows.filter((r) => r.reading && r.reading.invoiceNumber.trim() !== "");
  if (readable.length === 0) return new Map();
  const [suppliers, recorded] = await Promise.all([
    loadSupplierRecords(),
    db
      .select({
        id: invoices.id,
        supplierId: invoices.supplierId,
        supplierName: suppliers_.nameAr,
        invoiceNumber: invoices.invoiceNumber,
        totalMinor: invoices.totalMinor,
        origin: documents.origin,
      })
      .from(invoices)
      .innerJoin(suppliers_, eq(suppliers_.id, invoices.supplierId))
      .leftJoin(documents, eq(documents.id, invoices.documentId)),
  ]);
  return labelRecorded(
    readable.map((r) => ({
      id: r.id,
      sellerVatNumber: r.reading!.sellerVatNumber,
      supplierNameAr: r.reading!.supplierNameAr,
      supplierNameEn: r.reading!.supplierNameEn,
      invoiceNumber: r.reading!.invoiceNumber,
      totalAmount: r.reading!.totalAmount,
    })),
    suppliers,
    recorded.map((i) => ({
      id: i.id, supplierId: i.supplierId, supplierName: i.supplierName, invoiceNumber: i.invoiceNumber,
      totalMinor: Number(i.totalMinor), fromStatement: i.origin !== null,
    })),
  );
}

export async function pendingCaptureCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(captures).where(eq(captures.status, "PENDING"));
  return Number(row?.n ?? 0);
}

/** بايتاتُ الصورة المنتظِرة — لشاشة الرفع. */
export async function loadCaptureFile(id: string): Promise<{ data: Buffer; mimeType: string; fileName: string; sender: string } | null> {
  const [row] = await db
    .select({ data: captures.fileData, mimeType: captures.mimeType, fileName: captures.originalFileName, sender: captureLinks.label })
    .from(captures)
    .innerJoin(captureLinks, eq(captureLinks.id, captures.linkId))
    .where(and(eq(captures.id, id), eq(captures.status, "PENDING")))
    .limit(1);
  if (!row?.data) return null;
  return { data: row.data, mimeType: row.mimeType, fileName: row.fileName ?? "فاتورة.jpg", sender: row.sender };
}

/** يرفضها بسببها — ويراه مرسلُها. ما حُسم من قبل لا يُعاد حسمُه. */
export async function rejectCapture(id: string, reason: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const rows = await t
      .update(captures)
      .set({ status: "REJECTED", decisionNote: reason.trim(), decidedById: actorId, decidedAt: new Date() })
      .where(and(eq(captures.id, id), eq(captures.status, "PENDING")))
      .returning({ id: captures.id });
    if (rows.length === 0) return false;
    await recordAudit({ actorId, action: "DOCUMENT_CAPTURE_REJECTED", entityType: "capture", entityId: id, after: { السبب: reason.trim() } }, t);
    return true;
  });
}

/**
 * أُرشفت: تصير مستنداً، ويُفرَّغ ملفُّها (نسختُه في الدرايف الآن). داخل معاملة
 * الأرشفة نفسها — فلا يُؤرشَف مستندٌ وتبقى صورتُه «تنتظر».
 *
 * والمرفوضةُ إن أُرشفت بعد رفضها (كانت مفتوحةً في القارئ) تصير «اعتُمدت»: آخرُ ما
 * فعله صاحبُ العمل يغلب، ولا يُقال للباريستا «رُفضت» عن فاتورةٍ في الدفاتر.
 */
export async function settleCapture(t: Tx, captureId: string, documentId: string, actorId: string): Promise<void> {
  await t
    .update(captures)
    .set({ status: "ARCHIVED", documentId, decidedById: actorId, decidedAt: new Date(), fileData: null })
    .where(and(eq(captures.id, captureId), inArray(captures.status, ["PENDING", "REJECTED"])));
}

/**
 * أُرشف ملفٌّ بلا معرّف صورته (بطاقةٌ استُعيدت بعد تحديث الصفحة قبل أن يُحفظ المعرّف
 * معها): الصورةُ المنتظِرة ذاتُ البصمة نفسها هي هو بايتاً ببايت، فتُحسم معه — وإلّا
 * بقيت «تنتظر» في القائمة ومستندُها في الدفاتر، ثمّ رُدّت «مكرّرة» إن اعتُمدت.
 */
export async function settleCaptureBySha(t: Tx, sha256: string, documentId: string, actorId: string): Promise<void> {
  await t
    .update(captures)
    .set({ status: "ARCHIVED", documentId, decidedById: actorId, decidedAt: new Date(), fileData: null })
    .where(and(eq(captures.sha256, sha256), eq(captures.status, "PENDING")));
}

/** أتنتظر صورةٌ من الفريق بهذه البصمة؟ — فقراءتُها المحفوظة صالحةٌ أطول. */
export async function isWaitingCapture(sha256: string): Promise<boolean> {
  const [row] = await db
    .select({ id: captures.id })
    .from(captures)
    .where(and(eq(captures.sha256, sha256), eq(captures.status, "PENDING")))
    .limit(1);
  return Boolean(row);
}
