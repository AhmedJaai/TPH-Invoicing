/**
 * المزامنة التدريجية مع الدرايف.
 *
 * قراءة الأرشيف كاملاً بمحتواه عمل يُفعل مرّة واحدة. وبعدها لا يبقى إلا
 * سؤال واحد: هل ظهر في الدرايف ملف لا سجلّ له عندنا؟ — كملف رفعه أحدهم
 * بيده. فهذه الواجهة تقارن معرّفات ملفات الدرايف بما في القاعدة وتضيف
 * الفرق وحده، ولا تعيد قراءة ما قُرئ.
 *
 * والملف الذي لا يُفهم اسمه — وهو حال ما يُرفع يدوياً — يُقرأ محتواه.
 * وذلك أبطأ، فيُعالَج عدد محدود في كل طلب والباقي في الطلب التالي.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { autoRecordRefusal, findInvoiceTwin, twinReason } from "@/lib/invoice-twin";
import { loadRecordedInvoices } from "@/services/document-backlog.service";
import { refreshTokenFor } from "@/services/drive.service";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, gt, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  documents, extractionCache, invoices, issues, payments, statements,
  supplierAliases, suppliers,
} from "@/db/schema";
import { ISSUE } from "@/lib/issue-codes";
import { guard, respondTo } from "@/services/guard";
import {
  DriveAuthExpiredError, driveForUser, downloadFile, getFileMeta, isDriveAuthError, probeFile, type DriveFile,
} from "@/lib/drive";
import {
  archivePlace, DriveArchiveInvisibleError, misplacedFiles, missingFromDrive, recentMonths, walkArchive,
  type ArchiveEntry, type WalkResult,
} from "@/lib/drive-sync";
import { parseFileName } from "@/lib/naming";
import { KNOWN_SLUGS } from "@/lib/suppliers-seed";
import { planImport } from "@/lib/archive-import";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import { extractDocument } from "@/lib/extraction";
import { extractionSchema } from "@/lib/extraction/schema";
import type { ExtractionOutcome, ExtractionSuccess } from "@/lib/extraction/provider";
import { reviewConfirmed } from "@/lib/confirm";
import { parseRiyals } from "@/lib/money";
import { companyConfig, driveConfig } from "@/config/drive";
import { recordAudit } from "@/lib/audit";
import { createPayment, PaymentTwinError } from "@/services/payment.service";
import { createInvoice, createStatement, replaceLines } from "@/services/invoice.service";
import { firstClosedMonth } from "@/services/month-guard";
import { MonthClosedError } from "@/services/validation.service";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { canonicalName } from "@/lib/canonical-name";
import { autoArchive, sumLineTotals, type AutoArchiveGap } from "@/lib/extraction/auto-archive";
import { qrArchiveFacts } from "@/lib/extraction/evidence";
import { fillFromFileName } from "@/lib/extraction/filename-facts";
import { parseStatementExtras } from "@/lib/extraction/statement-extras";
import { renameArchived } from "@/services/drive-rename.service";
import { processDocumentBacklog } from "@/services/document-review.service";
import { markDriveChecked, markDriveFailed } from "@/services/drive-status.service";
import { previewAllowed } from "@/lib/preview-mode";
import { driveWritesAllowed } from "@/lib/drive-readonly";
import { FILE, MONTH, countNoun } from "@/lib/arabic";
import { withDeadline } from "@/lib/ai/deadline";
import { consume } from "@/services/rate-limit.service";
import { acquireLease, releaseLease } from "@/services/job-state.service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** حدّ لكل طلب: الاستدعاء السحابي له سقف زمني، والباقي يكمله الطلب التالي. */
const MAX_NAMED_PER_CALL = 60;
const MAX_CONTENT_PER_CALL = 2;

/**
 * ميزانيّةُ الطلب الواحد — والوقتُ مورِدٌ يُقسَم لا يُفترَض.
 *
 * سقفُ المزوّد ستّون ثانية. والعمل ثلاثةُ أقسام: مشيٌ على الأرشيف،
 * ثمّ قراءةُ محتوى ما لا يُفهم اسمُه، ثمّ كتابة. وأثقلُها الثاني: كلّ
 * ملفٍّ يُنزَّل ويُستخرَج بنموذج — عشرُ ثوانٍ أو أكثر للواحد. فأربعةٌ
 * منها وحدها قد تستغرق الدقيقة.
 *
 * وكانت المهلة على المشي وحده، فيقف المشي في وقته ثمّ تلتهم القراءةُ
 * الباقي ويُقتَل الطلب — فيبدو للمستخدم أنّ «سجّل الجديد» لا يعمل.
 *
 * فصار لكلّ قسمٍ حدُّه، ولآخر الطلب فسحةٌ تكفي للكتابة والردّ. واثنان
 * في الطلب لا أربعة: آخرُ ملفٍّ يبدأ عند الثامنة والعشرين، فإن استغرق
 * خمساً وعشرين انتهى عند الثالثة والخمسين — دون السقف بفسحة.
 *
 * والشاشة تتابع وحدها حتى ينتهي الباقي، فلا يُطلَب من صاحب العمل أن
 * يضغط سبع مرّات ولا أن يعرف لماذا.
 */
const WALK_BUDGET_MS = 20_000;
const CONTENT_BUDGET_MS = 28_000;

/**
 * عقدُ القراءة: مزامنةٌ واحدة تقرأ بالذكاء في الوقت الواحد.
 *
 * التوقيتُ في `localStorage` لكلّ جهاز، فالهاتفُ والحاسوبُ يزامنان معاً ويدفع كلٌّ منهما
 * ثمنَ قراءة الملفّين نفسيهما. وعمرُ العقد فوق عمر المسار بقليل: طلبٌ قُتل لا يحجزه.
 */
const SYNC_LEASE = "drive-sync-lease";
const SYNC_LEASE_MS = 70_000;
/** كم مقيَّداً لم يُرَ ملفُّه يُسأل عنه الدرايف في النداء الواحد — والباقي في الذي يليه. */
const MAX_PROBES_PER_CALL = 10;
/** قراءةٌ حُفظت لهذه البصمة خلال يومٍ لا تُدفع ثانيةً. */
const READING_FRESH_MS = 24 * 60 * 60 * 1000;

const Body = z.object({
  /** مزامنةٌ خلفيّة من القشرة — التفويضُ الغائب يُردّ ردّاً سليماً بـ`needsAuth`. */
  background: z.boolean().optional(),
  /** عدد الأشهر الأخيرة التي تُفحص. الافتراضي ثلاثة. */
  months: z.number().int().min(1).max(36).optional(),
  /** أشهرٌ بعينها — بها يستأنف الطلبُ التالي ما أوقفته المهلة. */
  onlyMonths: z.array(z.string().regex(/^\d{4}-\d{2}$/, "الشهر بصيغة YYYY-MM")).max(36).optional(),
  /**
   * ملفّاتٌ بعينها — تُقرأ بمعرّفاتها بلا مشيٍ على الأرشيف: المشي مرّةً واحدة
   * في الفحص، ثمّ تُقرأ الملفّات بأسمائها من القائمة التي خرجت منه.
   */
  fileIds: z.array(z.string().max(200)).max(500).optional(),
  /** فحص الأرشيف كله — أبطأ بكثير */
  full: z.boolean().optional(),
  apply: z.boolean().optional(),
  /** قراءة محتوى الملفات التي لا يُفهم اسمها */
  readContent: z.boolean().optional(),
});
type Body = z.infer<typeof Body>;

async function loadSuppliers(): Promise<SupplierRecord[]> {
  const rows = await db.select({
    id: suppliers.id, slug: suppliers.slug, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn,
    driveFolderName: suppliers.driveFolderName, vatNumber: suppliers.vatNumber,
    issuesInvoices: suppliers.issuesInvoices, contractOnFile: suppliers.contractOnFile,
  }).from(suppliers).where(eq(suppliers.isActive, true));

  const ids = rows.map((r) => r.id);
  const aliasRows = ids.length
    ? await db.select({ supplierId: supplierAliases.supplierId, normalized: supplierAliases.normalized })
        .from(supplierAliases).where(inArray(supplierAliases.supplierId, ids))
    : [];

  return rows.map((r) => ({
    ...r,
    aliases: aliasRows.filter((a) => a.supplierId === r.id).map((a) => ({ normalized: a.normalized })),
  }));
}

async function handle(request: Request) {
  let user;
  try {
    user = await guard("drive-sync", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const parsedBody = await readJson(request, Body, { emptyOk: true });
  if (!parsedBody.ok) return parsedBody.response;
  const body: Body = parsedBody.body;

  /* المعاينةُ والتسجيلُ بالاسم لا يدفعان شيئاً فلا يُحجَزان — العقدُ على القراءة بالذكاء وحدها */
  const leased = body.apply === true && body.readContent === true;
  const holder = randomUUID();
  if (leased && !(await acquireLease(SYNC_LEASE, holder, SYNC_LEASE_MS))) {
    const error = "مزامنةٌ أخرى تقرأ الدرايف الآن — من جهازٍ أو لسانٍ آخر. انتظر دقيقةً ثمّ أعد المحاولة.";
    return body.background === true
      ? NextResponse.json({ busy: true, error })
      : NextResponse.json({ busy: true, error }, { status: 409 });
  }
  try {
    return await sync(user, body);
  } finally {
    /* ردُّ العقد لا يُسقط ردَّ المزامنة — وإن تعذّر انقضى بعمره */
    if (leased) await releaseLease(SYNC_LEASE, holder).catch(() => undefined);
  }
}

async function sync(user: Awaited<ReturnType<typeof guard>>, body: Body) {
  const apply = body.apply === true;

  /*
    التفويضُ الغائب أو المنتهي خبرٌ لصاحبه لا عطبُ خادم. والزرُّ يأخذه ٤٢٨
    فيقول ما يُصلحه؛ أمّا المزامنةُ الخلفيّة (`background: true`) فتأخذه
    ردّاً سليماً بـ`needsAuth` فتقوله في إشعارٍ مرّةً — لا خطأً أحمر في
    طرفيّة كلّ صفحة، ولا صمتاً.
  */
  const needsAuth = async (error: string) => {
    /* التعثّرُ يُحفظ بسببه لتقوله صفحةُ الدرايف — ووضعُ التجربة بلا تفويضٍ عمداً فلا يُحفظ له */
    if (!previewAllowed(process.env)) await markDriveFailed(user.id, error);
    return body.background === true
      ? NextResponse.json({ needsAuth: true, error })
      : NextResponse.json({ error }, { status: 428 });
  };

  /* من الحارس وحده: وضعُ التجربة لا يستعير تفويض المالك (drive.service.ts) */
  const token = await refreshTokenFor(user.id);

  if (!token) {
    return needsAuth("لا يوجد تفويض درايف لحسابك. سجّل الخروج ثم الدخول ووافق على صلاحية الدرايف.");
  }

  const drive = driveForUser(token);

  /*
    ── الاستدراكُ قبل الجديد ──

    ما تراكم قبل أن تستقيم القراءة (تاريخٌ رُمي، مستندٌ ينتظر وتجتمع فيه
    الشروط، ملفٌّ مؤرشَفٌ باسمٍ خارج الصيغة) يُعالَج في كلّ مزامنة — فلا
    يبقى عملٌ قديم ينتظر زرّاً لا يعرف صاحبُه أنّه موجود.
  */
  /* مرّةً في المزامنة — في طلبها الأوّل، لا في كلّ دفعةٍ تستأنف القراءة */
  const firstCall = !body.fileIds?.length && !body.onlyMonths?.length;
  const backlog = apply && firstCall
    ? await processDocumentBacklog(user.id, drive)
    : { recorded: 0, approved: 0, renamed: [] as { from: string; to: string }[], reread: 0, notes: [] as string[] };

  const direct = Array.isArray(body.fileIds) ? body.fileIds.slice(0, 8) : [];
  const notes: string[] = [];

  /*
    القراءةُ بالمعرّف تُنادى حتى أربعين مرّةً بملفّين — وكانت كلُّ دفعةٍ تحمّل جدول
    المستندات كلَّه. فيُسأل فيها عن المعرّفات المطلوبة وحدها، ثمّ عن بصمات ما وُجد.
  */
  const knownColumns = {
    docId: documents.id, id: documents.driveFileId, md5: documents.driveMd5, sha256: documents.sha256,
    name: documents.fileName, status: documents.status, folderId: documents.driveFolderId,
  };
  const knownRows = direct.length > 0
    ? await db.select(knownColumns).from(documents).where(inArray(documents.driveFileId, direct))
    : await db.select(knownColumns).from(documents);
  /* اسمُ الملفّ المعروف كما هو في الدرايف الآن — يُقارن بما عندنا بعد المشي */
  const liveNames = new Map<string, string>();
  /** مجلدُ الشهر الذي وُجد فيه كلُّ ملفٍّ معروف */
  const liveMonths = new Map<string, string>();
  /** آخرُ من عدّل الملفَّ المعروف في الدرايف — يُكتب في أثر الاسم الذي تغيّر هناك */
  const liveModifiers = new Map<string, string>();
  const known = new Set(knownRows.map((d) => d.id).filter((v): v is string => Boolean(v)));
  /*
    بصمةُ ما قُيِّد — نسخةٌ من ملفٍّ مقيَّد (في مجلّدٍ آخر أو باسمٍ آخر) تُعرف قبل أن تُنزَّل
    أو تُقرأ. بالبصمتين: `md5` لما قيّدته المزامنة، و`sha256` لما رُفع من التطبيق — وكان
    الثاني لا يُعرف، فنسخةُ المرفوع تُقرأ بالذكاء في كلّ مزامنةٍ ثمّ يردّها القيدُ الفريد.
  */
  const byMd5 = new Map<string, Original>();
  const bySha = new Map<string, Original>();
  const indexOriginals = (rows: readonly (typeof knownRows)[number][]) => {
    for (const r of rows) {
      const original = { docId: r.docId, name: r.name };
      /* غيرُ المرفوض هو الأصل متى وُجد */
      if (r.md5 && (r.status !== "REJECTED" || !byMd5.has(r.md5))) byMd5.set(r.md5, original);
      if (r.sha256 && (r.status !== "REJECTED" || !bySha.has(r.sha256))) bySha.set(r.sha256, original);
    }
  };
  indexOriginals(knownRows);
  const originalOf = (file: DriveFile): Original | null =>
    (file.sha256Checksum ? bySha.get(file.sha256Checksum) : undefined)
    ?? (file.md5Checksum ? byMd5.get(file.md5Checksum) : undefined)
    ?? null;

  const months = Array.isArray(body.onlyMonths) && body.onlyMonths.length > 0
    ? body.onlyMonths.slice(0, 36)
    : body.full ? undefined : recentMonths(Math.max(1, Math.min(24, body.months ?? 3)));

  /*
    مهلةٌ دون سقف المزوّد.

    كان الطلب يُقتَل عند الستّين ثانية، فيردّ المزوّد نصّاً لا JSON،
    فتنفجر الشاشة برسالة «Unexpected token 'A'» — ولا أحد يعرف أنّ
    السبب مهلةٌ لا عطب. والوقوف المعلَن أصدق من قتلٍ صامت.
  */
  const startedAt = Date.now();
  const deadline = startedAt + WALK_BUDGET_MS;

  let fresh: ArchiveEntry[];
  let pendingMonths: string[] = [];
  let truncated = false;
  /** المشيُ نفسُه — غائبٌ في القراءة بالمعرّف، فلا يُحكَم فيها على ما غاب من الدرايف */
  let walk: WalkResult | null = null;

  if (direct.length > 0) {
    /*
      ── قراءةٌ بالمعرّف: بلا مشي ──

      يُسأل عن الملفّ نفسه، ثمّ عن مجلّده وجدّه — ثلاثةُ نداءات لا
      عشرات. والشهرُ واسمُ المجلّد يُقرآن من الدرايف لا ممّا أرسله
      المتصفّح: من أرسل معرّفاً لا يُملي علينا أين هو.
    */
    const entries: ArchiveEntry[] = [];
    const yearFolderIds = Object.values(driveConfig.yearFolderIds);
    try {
    for (const id of direct) {
      /* ما هو مسجَّل لا يُقرأ ثانيةً — استخراجٌ بلا سبب */
      if (known.has(id)) continue;
      const file = await getFileMeta(drive, id);
      if (!file) { notes.push(`${id} — لم يُقرأ: لا يُرى بتفويضك، أو حُذف من الدرايف`); continue; }
      /*
        موضعُه من الأرشيف بالحكم الواحد (`archivePlace`): في مجلّد مورّدٍ داخل شهر، أو في
        مجلّد الشهر نفسه — والشهرُ لا يُقبل إلّا تحت سنةٍ مهيّأة. وما لا موضعَ له يُقال
        سببُه؛ كان يُتخطّى بصمت.
      */
      const parent = file.parents?.[0] ? await getFileMeta(drive, file.parents[0]) : null;
      let place = archivePlace(parent, null, yearFolderIds);
      if (!place.ok && place.needsGrandparent && parent?.parents?.[0]) {
        place = archivePlace(parent, await getFileMeta(drive, parent.parents[0]), yearFolderIds);
      }
      if (!place.ok) { notes.push(`${file.name} — لم يُقرأ: ${place.reason}`); continue; }
      entries.push({ month: place.month, folderName: place.folderName, file });
    }
    } catch (e) {
      if (e instanceof DriveAuthExpiredError) {
        return needsAuth(e.message);
      }
      throw e;
    }
    /* بصماتُ ما وُجد — يُسأل عنها وحدها */
    const md5s = entries.flatMap((e) => (e.file.md5Checksum ? [e.file.md5Checksum] : []));
    const shas = entries.flatMap((e) => (e.file.sha256Checksum ? [e.file.sha256Checksum] : []));
    if (md5s.length + shas.length > 0) {
      indexOriginals(await db.select(knownColumns).from(documents).where(or(
        md5s.length > 0 ? inArray(documents.driveMd5, md5s) : undefined,
        shas.length > 0 ? inArray(documents.sha256, shas) : undefined,
      )));
    }
    fresh = entries;
  } else {
    try {
      const walked = await walkArchive(drive, {
        months, knownFileIds: known, deadline,
        onKnown: (id, name, month, file) => {
          liveNames.set(id, name);
          liveMonths.set(id, month);
          if (file.lastModifiedBy) liveModifiers.set(id, file.lastModifiedBy);
        },
      });
      walk = walked;
      fresh = walked.entries;
      pendingMonths = walked.pendingMonths;
      truncated = walked.truncated;
      /* ما لم يقرأه المشي يُقال — مجلّدٌ تعذّر سردُه، أو مجلّدٌ فرعيّ لا يُنزَل إليه */
      notes.push(...walked.notes);
    } catch (e) {
      /* التفويض المنتهي خبرٌ يُصلحه صاحبه — لا «لا جديد» ولا عطبٌ مبهم */
      if (e instanceof DriveAuthExpiredError) {
        return needsAuth(e.message);
      }
      /* حسابٌ لا يرى الأرشيف: السببُ بنصّه، لا «تعذّرت قراءة الدرايف» مبهمة */
      const error = e instanceof DriveArchiveInvisibleError ? e.message : `تعذّرت قراءة الدرايف: ${(e as Error).message}`;
      await markDriveFailed(user.id, error);
      return NextResponse.json({ error }, { status: 502 });
    }
  }
  /* قرأ الدرايف بتفويضه — فحصٌ نجح وإن لم يجد جديداً */
  await markDriveChecked(user.id);

  /** ما سُجّل في هذا الطلب — به يُسأل عن تسميته بعد قراءته. */
  const recordedFileIds = new Set<string>();

  const supplierList = await loadSuppliers();
  /* المقيَّدُ للمقارنة بالتوأم — ويُضاف إليه ما يُقيَّد في هذا النداء */
  const recordedInvoices = await loadRecordedInvoices();
  const bySlug = new Map(supplierList.map((s) => [s.slug, s]));
  const byFolder = new Map(supplierList.map((s) => [s.driveFolderName.trim(), s]));

  const named: { entry: ArchiveEntry; parsed: ReturnType<typeof parseFileName> }[] = [];
  const unnamed: ArchiveEntry[] = [];

  /** نسخٌ من ملفّاتٍ مقيَّدة — لا تُقرأ، وتُقيَّد «نسخةً» مرّةً فلا تُعدّ جديدةً كلَّ مزامنة. */
  const copies: { entry: ArchiveEntry; original: Original }[] = [];
  for (const entry of fresh) {
    const original = originalOf(entry.file);
    if (original) {
      copies.push({ entry, original });
      continue;
    }
    const parsed = parseFileName(entry.file.name, KNOWN_SLUGS);
    if (parsed.ok) named.push({ entry, parsed });
    else unnamed.push(entry);
  }

  const scanned = {
    scope: direct.length > 0
      ? countNoun(direct.length, FILE)
      : months ? `${countNoun(months.length, MONTH)}` : "الأرشيف كله",
    /** أشهرٌ لم يُمشَ عليها — يكملها الطلب التالي بلا أن يُعيد ما مضى. */
    pendingMonths,
    truncated,
    knownBefore: known.size,
    newFiles: fresh.length,
    understoodByName: named.length,
    needContentReading: unnamed.length,
  };

  if (!apply) {
    return NextResponse.json({
      ok: true,
      applied: false,
      summary: scanned,
      notes: notes.slice(0, 20),
      files: fresh.slice(0, 40).map((e) => ({
        fileId: e.file.id,
        name: e.file.name,
        month: e.month,
        folder: e.folderName,
        understood: named.some((n) => n.entry.file.id === e.file.id),
      })),
    });
  }

  // ── التسجيل ──
  let created = 0;
  let invoicesCreated = 0;
  /** إيصالاتٌ وُجدت واقعتُها مقيَّدةً — عُلِّقت ولم تُنسَخ دفعةً ثانية. */
  let paymentsAdopted = 0;
  /** ملفّاتٌ شهرُها مقفل — تُعرَض ولا تُسجَّل حتى يُفتَح. */
  let closedMonthSkipped = 0;
  /** مستنداتٌ أنشأها هذا النداء — تُكتب في أثره، فيُجاب «أيُّ مزامنةٍ قيّدت هذه الفاتورة؟» */
  const createdDocIds: string[] = [];
  if (copies.length > 0) {
    for (const c of copies) await recordCopy(c.entry, c.original);
    notes.push(`${countNoun(copies.length, FILE)} نسخةٌ من ملفٍّ مقيَّد (البصمةُ نفسُها) — لم تُقرأ، وقُيِّدت نسخةً في «رُفض»: ${copies.slice(0, 3).map((c) => c.entry.file.name).join("، ")}`);
  }

  for (const { entry, parsed } of named.slice(0, MAX_NAMED_PER_CALL)) {
    if (!parsed.ok) continue;
    const p = parsed.value;
    const supplier = p.slug ? bySlug.get(p.slug) : byFolder.get(entry.folderName.trim());
    const plan = planImport(p, Boolean(supplier));
    for (const n of plan.notes) notes.push(`${entry.file.name} — ${n}`);

    const date = new Date(`${p.date}T00:00:00Z`);

    /*
      ── الشهر المقفل يُتخطّى برسالة، لا ٥٠٠ ──

      الكتابةُ عبر الخدمات (`createInvoice` و`createPayment`) وهي تسأل عن
      الإقفال قبل أن تكتب. فإن رمت رُدّت المعاملة كلّها — المستندُ معها —
      فيُعاد عرضُه في المزامنة التالية بعد فتح الشهر، ولا يبقى مستندٌ مؤرشف
      بلا فاتورته. وكان المسار يُدرج بيده فيصل إلى مؤثِّر ٠٢٨ بخطأ قاعدةٍ
      يقطع حلقة المزامنة كلّها.
    */
    /* تُعدّ بعد نجاح المعاملة — ما رُدّ لم يُسجَّل */
    let done: { doc: string | null; invoice: boolean; adopted: boolean } = { doc: null, invoice: false, adopted: false };
    try {
    await db.transaction(async (tx) => {
      const [doc] = await tx.insert(documents).values({
        driveFileId: entry.file.id,
        driveFolderId: entry.file.parents?.[0] ?? null,
        fileName: entry.file.name,
        mimeType: entry.file.mimeType,
        sizeBytes: entry.file.size ?? null,
        /* لا تنزيل هنا — فالبصمتان من الدرايف: بهما يُعرف إن رُفع ثانيةً من أيّ باب */
        sha256: entry.file.sha256Checksum ?? null,
        driveMd5: entry.file.md5Checksum ?? null,
        kind: plan.documentKind as never,
        status: "ARCHIVED",
        periodMonth: entry.month,
        supplierId: supplier?.id ?? null,
        uploadedById: user.id,
        ...driveOrigin(entry),
      }).onConflictDoNothing().returning({ id: documents.id });

      if (!doc) return; // سُجّل بين الفحص والكتابة — لا نكرّره
      done = { ...done, doc: doc.id };

      /*
        الاسمُ كتبه إنسان — فلا يُسأل عن أوّل فاتورة؛ لكنّ الرقمَ نفسه بصيغةٍ ثانية
        («INV-05297» و«INV/05297»)، أو اليومَ والمبلغ نفسيهما، نسخةٌ لا فاتورة.
      */
      const twin = plan.createsInvoice && supplier
        ? findInvoiceTwin(recordedInvoices, {
          supplierId: supplier.id, invoiceNumber: p.invoiceNumber ?? null, invoiceDate: p.date, totalMinor: p.amountMinor ?? null,
        })
        : null;
      if (twin) notes.push(`${entry.file.name} — ${twinReason(twin)}`);

      if (plan.createsInvoice && supplier && !twin) {
        const invoiceId = await createInvoice(tx, {
          documentId: doc.id,
          supplierId: supplier.id,
          invoiceNumber: p.invoiceNumber!,
          invoiceDate: date,
          periodMonth: entry.month,
          /* الاسم يعطي الإجماليّ وحده — الصافي والضريبة مجهولان لا صفر */
          subtotalMinor: null,
          vatMinor: null,
          totalMinor: p.amountMinor!,
          /* ولا يُعرَف من الاسم أصالحةٌ ضريبياً — فالمجهول يُعلَن */
          taxStatus: "UNKNOWN",
          inputVatStatus: "UNKNOWN",
          isFixedAsset: false,
        });
        if (invoiceId) {
          done = { ...done, invoice: true };
          recordedInvoices.push({
            id: invoiceId, supplierId: supplier.id, invoiceNumber: p.invoiceNumber!, invoiceDate: p.date, totalMinor: p.amountMinor ?? null,
          });
        }
      }

      if (plan.createsStatement && supplier) {
        await tx.insert(statements).values({
          documentId: doc.id,
          supplierId: supplier.id,
          periodStart: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
          periodEnd: date,
          /* الرصيد الذي لم يُقرأ من الاسم يبقى مجهولاً — ويُملأ عند المطابقة */
          closingBalanceMinor: p.amountMinor ?? null,
        });
      }

      if (plan.createsPayment) {
        /*
          الإيصالُ **دليلٌ على دفعة**، لا دفعةٌ ثانية.

          كان هذا المسار يُدرج دفعةً بلا أن يسأل: أعندنا هذه الواقعة
          أصلاً؟ وحركةُ الكشف تُدرج أخرى، فيصير الريالُ ريالين. وفي
          قاعدة أحمد أربع كذلك — منها إيصال أفال ٨٬٤٠٢٫٧٧ وإيصال بيكوف
          ٩٠٠ — تُظهر المورّدَ مدفوعاً له ضعفَ ما أخذ.

          فإن وُجدت الواقعةُ مقيَّدةً بلا مستند، عُلِّق عليها الإيصالُ
          ولم تُنسَخ. وإن كانت لها مستندٌ آخر فهما إيصالان لواقعةٍ
          واحدة — يُسجَّل المستند ولا تُقيَّد دفعة، ويُترَك الأمر
          لفحص الازدواج.
        */
        /*
          والسؤالُ في `createPayment` نفسها لا منسوخاً هنا: كان هذا المسار
          يسأل `findPaymentTwin` بيده، فأوّلُ تغييرٍ في سياسة التوأم لا
          يبلغه. فيُنشئ عبر الخدمة، وإن ردّت بتوأمٍ تبنّاه.
        */
        try {
          await createPayment(tx, {
            documentId: doc.id,
            supplierId: supplier?.id ?? null,
            paidAt: date,
            amountMinor: p.amountMinor!,
            method: plan.paymentMethod,
            beneficiaryNameRaw: p.beneficiary ?? null,
            appliesToMonth: entry.month,
          });
        } catch (e) {
          if (!(e instanceof PaymentTwinError)) throw e;
          /* الرميُ قبل أيّ كتابة — فالمعاملة سليمةٌ تُكمَل */
          if (e.twin.documentId === null) {
            await tx.update(payments)
              .set({ documentId: doc.id })
              .where(eq(payments.id, e.twin.id));
          }
          done = { ...done, adopted: true };
        }
      }
    });
    if (done.doc) { created++; recordedFileIds.add(entry.file.id); createdDocIds.push(done.doc); }
    if (done.invoice) invoicesCreated++;
    if (done.adopted) paymentsAdopted++;
    } catch (e) {
      if (!(e instanceof MonthClosedError)) throw e;
      notes.push(`${entry.file.name} — لم يُسجَّل: ${e.message}`);
      closedMonthSkipped++;
    }
  }

  // ── الملفات التي لا يُفهم اسمها: تُقرأ بمحتواها ──
  let read = 0;
  /** ما حُسم أمرُه بلا قراءة — نسخةٌ، أو ملفٌّ تعذّر تنزيلُه أو قراءتُه، أو عرضُ سعر: قُيِّد فلا يعود */
  let settled = 0;
  /** ما لا يُفهم اسمُه وشهرُه مقفل — لا يُقرأ حتى يُفتَح، فلا يُعدّ «باقياً» تتابعه الشاشة */
  let closedUnnamed = 0;
  let autoArchived = 0;
  const reviewGaps = new Map<AutoArchiveGap, number>();
  const readFailures: string[] = [];
  /** التسعيرات: تُعرَض ولا تُقيَّد. */
  const quotations: string[] = [];

  if (body.readContent) {
    try {
      await consume("drive-sync-content", user.id);
    } catch (e) {
      const mapped = respondTo(e);
      if (mapped) return mapped;
      throw e;
    }

    /*
      ── لا يعلق الطابورُ على الملفّين نفسيهما ──

      يُقرأ ملفّان في كلّ نداء. وكان ما لا يُكتب له صفٌّ — شهرٌ مقفل، عرضُ سعر،
      قراءةٌ فشلت — يبقى «جديداً» فيعود أوّلَ الطابور في كلّ مزامنة: يُقرأ ثانيةً
      (نداءٌ مدفوع) ولا يُقرأ ما بعده أبداً. فالمقفلُ يُعزل قبل الباب، وعرضُ السعر
      والفاشلُ يُقيَّدان مستندَين (بلا فاتورة) فلا يعودان.
    */
    const readable: ArchiveEntry[] = [];
    for (const entry of unnamed) {
      if (readable.length >= MAX_CONTENT_PER_CALL) break;
      const closed = await firstClosedMonth(db, [entry.month]);
      if (closed) {
        notes.push(`${entry.file.name} — لم يُقرأ: ${new MonthClosedError(closed).message}`);
        closedMonthSkipped++;
        closedUnnamed++;
        continue;
      }
      readable.push(entry);
    }

    for (const entry of readable) {
      /*
        الوقوف قبل بدء ملفٍّ لا في وسطه: الاستخراج يستغرق ما يستغرق،
        وقطعُه في منتصفه يترك ملفّاً نُزّل ولم يُقيَّد. فيُسأل الوقتُ
        عند الباب، ومن دخل أُتِمّ له.
      */
      if (Date.now() - startedAt >= CONTENT_BUDGET_MS) break;

      /*
        ما لا يُنزَّل يُقيَّد بسببه ولا يبقى أوّلَ الطابور.

        كان فشلُ التنزيل — مستندُ جوجل أصليّ، اختصار، ملفٌّ ضخم — يُذكَر ثمّ يُترَك بلا
        صفّ، فيعود في كلّ مزامنةٍ ويأكل إحدى خانتَي القراءة إلى الأبد. والعميلُ يعيد
        المحاولة ثلاثاً على العطب العابر قبل أن يرمي، فما وصل هنا يُقيَّد «ينتظر» بسببه
        ويُعاد من ملفّه بيد صاحبه.
      */
      if (entry.file.mimeType.startsWith("application/vnd.google-apps.")) {
        const reason = "مستندُ جوجل لا ملفّ — نزّله PDF وضعه في المجلّد";
        readFailures.push(`${entry.file.name} — ${reason}`);
        await recordUnread(entry, null, entry.file.mimeType, user.id, "UNKNOWN", { error: reason });
        settled++;
        continue;
      }
      let data: Buffer;
      let mimeType: string;
      try {
        ({ data, mimeType } = await downloadFile(drive, entry.file.id));
      } catch (e) {
        if (isDriveAuthError(e)) {
          return needsAuth(new DriveAuthExpiredError().message);
        }
        readFailures.push(`${entry.file.name} — تعذّر التنزيل`);
        await recordUnread(entry, null, entry.file.mimeType, user.id, "UNKNOWN", {
          error: `تعذّر تنزيلُه من الدرايف: ${(e as Error).message}`,
        });
        settled++;
        continue;
      }

      /*
        «أعندنا هو؟» قبل «ما فيه؟» — بالبصمة بعد التنزيل وقبل النداء المدفوع. ما لا يعطيه
        الدرايف بصمةً في القائمة يُعرف هنا: نسخةٌ ممّا رُفع من التطبيق لا تُقرأ ثانيةً.
      */
      const sha256 = createHash("sha256").update(data).digest("hex");
      const [sameContent] = await db
        .select({ docId: documents.id, name: documents.fileName })
        .from(documents)
        .where(and(eq(documents.sha256, sha256), ne(documents.status, "REJECTED")))
        .limit(1);
      if (sameContent) {
        await recordCopy(entry, sameContent);
        notes.push(`${entry.file.name} — نسخةٌ من «${sameContent.name}» (البصمةُ نفسُها) — لم تُقرأ، وقُيِّدت نسخةً في «رُفض»`);
        settled++;
        continue;
      }

      /*
        القراءةُ تُحفظ ببصمة الملفّ لحظةَ تمامها وتُسأل قبل أن تُطلَب — كما في الرفع. كان
        الطلبُ إن قُتل بعد الاستخراج وقبل الكتابة دُفع ثمنُ القراءة وأُعيدت في المزامنة التالية.
      */
      const saved = await savedReading(sha256);
      const extraction: ExtractionOutcome = saved ?? await extractDocument({
        data, mimeType,
        companyVat: companyConfig.vatNumber,
        companyName: companyConfig.nameAr,
        supplierNames: supplierList.map((s) => `${s.nameAr} (${s.slug})`),
      });

      if (!extraction.ok) {
        readFailures.push(`${entry.file.name} — ${extraction.reason}`);
        /* يُقيَّد مستنداً «لم يُقرأ» فيظهر في المستندات بسببه — ولا يعود أوّلَ الطابور */
        await recordUnread(entry, data, mimeType, user.id, "UNKNOWN", { error: extraction.reason });
        settled++;
        continue;
      }
      if (!saved) await saveReading(sha256, extraction, user.id);

      const x = extraction.value;

      /*
        ما سكت عنه النموذجُ ونطق به اسمُ الملفّ — «فاتورة - 260391 -» —
        يُؤخَذ من الاسم: كتبه نظامُ المورّد لا نموذجُنا. سدٌّ لفراغ لا
        تصحيحٌ لقراءة.
      */
      fillFromFileName(x, entry.file.name);

      /*
        ── التسعيرة تُحذَّر ولا تُسجَّل ──

        عرضُ السعر ليس واقعةً ماليّة: لا مالَ خرج ولا التزامَ نشأ، وقد
        يُلغى أو يتغيّر سعرُه قبل أن يصير فاتورة. وتقييدُه يُدخل في
        الأرشيف رقماً يبدو مستحقّاً وليس كذلك.

        فيُعلَن ولا يُقيَّد — ويبقى في الدرايف كما هو، فإن صار فاتورةً
        سُجّلت الفاتورة.
      */
      if (x.documentKind === "QUOTATION") {
        quotations.push(`${entry.file.name} — عرض سعر، حُفظ ولم يُقيَّد`);
        await recordUnread(entry, data, mimeType, user.id, "QUOTATION", { reading: x });
        settled++;
        continue;
      }

      const folderSupplier = byFolder.get(entry.folderName.trim());
      const matched = matchSupplier(supplierList, {
        sellerVatNumber: x.sellerVatNumber,
        supplierNameAr: x.supplierNameAr,
        supplierNameEn: x.supplierNameEn,
      });
      const supplier = folderSupplier ?? matched.supplier;

      const review = reviewConfirmed(
        {
          documentKind: x.documentKind,
          supplierId: supplier?.id,
          invoiceNumber: x.invoiceNumber,
          invoiceDate: x.invoiceDate,
          subtotalMinor: parseRiyals(x.subtotalAmount),
          vatMinor: parseRiyals(x.vatAmount),
          totalMinor: parseRiyals(x.totalAmount),
          discountMinor: parseRiyals(x.discountAmount),
          chargesMinor: parseRiyals(x.chargesAmount),
          sellerVat: x.sellerVatNumber,
          buyerVat: x.buyerVatNumber,
        },
        {
          companyVat: companyConfig.vatNumber,
          supplierIssuesInvoices: supplier?.issuesInvoices,
          supplierContractOnFile: supplier?.contractOnFile,
        },
      );

      /*
        ── أيدخل وحده؟ ── (`auto-archive.ts`، بإذن أحمد في ٢٤ سبتمبر ٢٠٢٦)

        مورّدٌ معروف، وفاتورةٌ مقيَّدة، وحسابٌ مستقيم، وقراءةٌ موثوقة (نصٌّ
        مكتوب، أو صورةٌ يصدّقها شاهدٌ مستقلّ). وما لم تجتمع فيه ينتظر
        إنساناً، ولوحُ المراجعة يقول له ما نقص بعينه.
      */
      /* بابُ القيد الآليّ نفسُه الذي يمرّ به الطابور — لا `canCreateInvoice` وحده */
      const refusal = review.canCreateInvoice && supplier
        ? autoRecordRefusal({
          blockers: review.blockers, supplier, recorded: recordedInvoices,
          invoiceNumber: x.invoiceNumber?.trim() || null, invoiceDate: x.invoiceDate || null, totalMinor: parseRiyals(x.totalAmount),
        })
        : [];
      for (const r of refusal) notes.push(`${entry.file.name} — ${r}`);
      const mayRecord = review.canCreateInvoice && Boolean(supplier) && refusal.length === 0;

      const verdict = autoArchive({
        kind: x.documentKind,
        invoiceRecorded: mayRecord && parseRiyals(x.totalAmount) !== null,
        textSource: extraction.textSource ?? null,
        supplierKnown: Boolean(supplier),
        subtotalMinor: parseRiyals(x.subtotalAmount),
        vatMinor: parseRiyals(x.vatAmount),
        totalMinor: parseRiyals(x.totalAmount),
        discountMinor: parseRiyals(x.discountAmount),
        chargesMinor: parseRiyals(x.chargesAmount),
        invoiceNumber: x.invoiceNumber,
        fileName: entry.file.name,
        linesTotalMinor: sumLineTotals(x.lines as { lineTotal?: string }[], (v) => parseRiyals(v)),
        /* الكشفُ يُقيَّد أدناه متى عُرف مورّدُه — وتاريخُه من القراءة أو من شهر المجلّد */
        statementRecorded: x.documentKind === "STATEMENT" && Boolean(supplier),
        /* رمزُ الفاتورة الضريبيّ (QR) شاهدٌ من خارج النموذج، وما تبدّل عند إعادة السؤال */
        ...qrArchiveFacts(extraction.evidence ?? null),
      });

      /*
        ── المزامنة لا تسمّي شيئاً قبل التقييد ──

        كانت تعيد تسمية الملفّ في الدرايف قبل تقييده، بلا اختيارٍ لكلّ
        ملفّ ولا أثرٍ في سجلّ التدقيق، والاسم الأصليّ لا يُحفَظ في موضع —
        فضاع اسمٌ كتبه مورّد (لوريفا)، واستُبدل رقمٌ كتبه إنسان بقراءةٍ
        خاطئة (غاناش). وهذا خرقٌ للقيد الأوّل نصّاً: «لا شيء بلا اختيار
        الإنسان ملفّاً ملفّاً وأثرٍ في سجلّ التدقيق».

        فيُقيَّد الملفّ باسمه كما هو، ثمّ — بعد التقييد — يُسمّى آلياً ما
        أُرشِف (`drive-rename.service.ts`، بالاسمين في السجلّ)، ويُقترَح
        ما سواه في الردّ (`renameSuggestions`).
      */
      const finalName = entry.file.name;

      /* تُعدّ بعد نجاح المعاملة — ما رُدّ لم يُسجَّل ولم يُقرأ */
      let recorded: string | null = null;
      let invoiceCreated = false;
      try {
      await db.transaction(async (tx) => {
        const [doc] = await tx.insert(documents).values({
          driveFileId: entry.file.id,
          driveFolderId: entry.file.parents?.[0] ?? null,
          fileName: finalName,
          mimeType,
          sizeBytes: data.length,
          sha256,
          driveMd5: entry.file.md5Checksum ?? createHash("md5").update(data).digest("hex"),
          kind: x.documentKind as never,
          /*
            ما قرأه النموذج ينتظر إنساناً إلّا إن اجتمعت الشروطُ الأربعة:
            كان يُقيَّد «مؤرشفاً» بلا شرط فيدخل ملفّ التحويلات وما رآه أحد —
            وفاتورةٌ منفوخة حسابُها مستقيم تمرّ كلَّ فحص. والذي يسدّ ذلك:
            نصٌّ منقول، أو صورةٌ يصدّقها شاهدٌ مستقلّ عن جمع أرقامها.
          */
          status: verdict.auto ? "ARCHIVED" : "NEEDS_REVIEW",
          periodMonth: entry.month,
          supplierId: supplier?.id ?? null,
          extractionJson: x as never,
          extractionModel: extraction.model,
          textSource: extraction.textSource ?? null,
          fieldConfidence: x.confidence as never,
          uploadedById: user.id,
          readAttempts: 1,
          lastReadAt: new Date(),
          ...driveOrigin(entry),
        }).onConflictDoNothing().returning({ id: documents.id });

        if (!doc) return;
        recorded = doc.id;

        /* الكشف: هويّتُه مورّدُه وفترتُه — لا رقمٌ ولا إجماليّ */
        if (x.documentKind === "STATEMENT" && supplier) {
          /* بلا تاريخٍ مقروء: آخرُ يومٍ من شهر المجلّد — كتبه إنسان */
          const [y, m] = entry.month.split("-").map(Number);
          const end = x.invoiceDate || new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
          const parsed = parseStatementExtras(x);
          await createStatement(tx, {
            documentId: doc.id,
            supplierId: supplier.id,
            periodEnd: new Date(`${end}T00:00:00Z`),
            openingBalanceMinor: parsed.openingBalanceMinor,
            closingBalanceMinor: parseRiyals(x.totalAmount) ?? parsed.closingBalanceMinor,
            lines: parsed.lines,
          });
          return;
        }

        if (!mayRecord || !supplier) return;

        const totalMinor = parseRiyals(x.totalAmount)!;
        const invoiceDate = new Date(`${x.invoiceDate}T00:00:00Z`);
        /*
          عبر `createInvoice` و`replaceLines` لا إدراجاً باليد: فيُحرَس
          الشهر المقفل، وتُسوّى البنود بالحساب نفسه الذي يمرّ به الرفع —
          ثلاثةُ مساراتٍ تُنشئ فواتير، وافتراقُها في السعر أنتج «ارتفاعاً» لم يقع.
        */
        const invoiceId = await createInvoice(tx, {
          documentId: doc.id,
          supplierId: supplier.id,
          invoiceNumber: x.invoiceNumber.trim(),
          invoiceDate,
          periodMonth: entry.month || x.invoiceDate.slice(0, 7),
          // الفراغ يبقى فراغاً — المجهول لا يصير صفراً
          subtotalMinor: parseRiyals(x.subtotalAmount),
          vatMinor: parseRiyals(x.vatAmount),
          totalMinor,
          discountReadMinor: parseRiyals(x.discountAmount),
          chargesReadMinor: parseRiyals(x.chargesAmount),
          sellerVat: x.sellerVatNumber || null,
          buyerVat: x.buyerVatNumber || null,
          taxStatus: review.taxStatus,
          inputVatStatus: review.inputVatStatus,
          isFixedAsset: review.isFixedAsset,
        });

        if (!invoiceId) return;
        invoiceCreated = true;
        recordedInvoices.push({
          id: invoiceId, supplierId: supplier.id, invoiceNumber: x.invoiceNumber.trim(), invoiceDate: x.invoiceDate, totalMinor,
        });

        await replaceLines(tx, {
          invoiceId,
          supplierId: supplier.id,
          invoiceDate,
          subtotalMinor: parseRiyals(x.subtotalAmount),
          lines: x.lines,
        });

        /* مالٌ دُفع لهذا المورّد قبل وصول فاتورته يُخصم منها — كما في الرفع */
        await applySupplierCredit(tx, supplier.id, { forwardDays: SETTLEMENT_FORWARD_DAYS });
      });
      if (recorded) {
        created++; read++; recordedFileIds.add(entry.file.id); createdDocIds.push(recorded);
        if (verdict.auto) autoArchived++;
        else for (const g of verdict.gaps) reviewGaps.set(g, (reviewGaps.get(g) ?? 0) + 1);
      }
      if (invoiceCreated) invoicesCreated++;
      } catch (e) {
        /* أُقفل الشهر بين السؤال عند الباب والكتابة — يُتخطّى برسالة */
        if (!(e instanceof MonthClosedError)) throw e;
        notes.push(`${entry.file.name} — لم يُسجَّل: ${e.message}`);
        closedMonthSkipped++;
      }
    }
  }

  /* الباقي ما ينتظر قراءةً فعلاً — لا ما قُيِّد بسببه، ولا ما يحجزه شهرٌ مقفل */
  const remaining = Math.max(0, unnamed.length - read - settled - closedUnnamed);
  /* والمسمّى فوق حدّ النداء: كان يُسقَط من الخلاصة بصمت — ترحيلُ شهرٍ كاملٍ يقول «سُجّل ٦٠» ولا يقول إنّ ثلاثين بقيت */
  const remainingNamed = Math.max(0, named.length - MAX_NAMED_PER_CALL);

  if (created > 0) {
    await recordAudit({
      actorId: user.id,
      action: "DRIVE_SYNCED",
      entityType: "drive_sync",
      entityId: new Date().toISOString(),
      after: {
        النطاق: scanned.scope,
        ملفات_جديدة: fresh.length,
        سُجّلت: created,
        فواتير: invoicesCreated,
        "إيصالات عُلِّقت على دفعةٍ قائمة": paymentsAdopted,
        قُرئ_محتواها: read,
        المستندات: createdDocIds,
      },
    });
  }

  /*
    ── وما سُجّل للتوّ: أيُّه اسمُه خارج الصيغة؟ ──

    وهذا موضعُ السؤال الطبيعيّ. الملفّ الذي رفعه المورّد باسمه —
    «فاتورة - 260351 - مؤسسة ذا بوبليك هاوس.pdf» — يُكتشَف هنا، ويُقرأ
    محتواه هنا، فيُعرَف مورّدُه وتاريخُه وإجماليُّه **هنا**. فسؤالُ
    «أأوحّد اسمَه؟» يقع في هذه اللحظة لا في شاشةٍ أخرى.

    وكان يقع في شاشةٍ أخرى: فحصُ التسمية ينظر إلى المسجَّل، والملفّ
    الجديد لم يُسجَّل بعد — فيراه أحمد في المزامنة «اسمُه غلط» ويراه
    الفحصُ «لا شيء». خيطان لا يلتقيان، والعمل بينهما يضيع.

    ولا يُعاد تسميةُ شيء هنا: يُقترَح وحسب، والفعلُ في `/api/drive-rename`
    باختيارٍ ملفّاً ملفّاً.
  */
  /*
    ── الاسمُ في الدرايف هو الحقيقة ──
    غُيّر اسمُ ملفٍّ هناك بيد («0044.pdf») وبقي عندنا قياسيّاً، فلم تره التسميةُ أبداً.
    فيُحدَّث ما عندنا من الدرايف، ويدخل التسميةَ مع ما قُيِّد للتوّ.
  */
  const stored = new Map(knownRows.flatMap((r) => (r.id ? [[r.id, r] as const] : [])));
  const drifted = [...liveNames].filter(([id, name]) => stored.get(id) !== undefined && stored.get(id)?.name !== name);
  for (const [id, name] of drifted) {
    const before = stored.get(id);
    if (!before) continue;
    /*
      الاسمُ الذي كان عندنا لا يضيع: يُحفظ «اسمَ الوصول» إن لم يُحفظ، ويُكتب الاسمان في
      الأثر مع آخر من عدّل الملفَّ هناك — كان يُكتب فوقه بلا سطر، فلا يُعرف متى تغيّر ولا بيد مَن.
    */
    await db.transaction(async (t) => {
      await t.update(documents)
        .set({ fileName: name, originalFileName: sql`coalesce(original_file_name, file_name)` })
        .where(eq(documents.driveFileId, id));
      await recordAudit({
        actorId: null,
        action: "DRIVE_NAME_CHANGED_EXTERNALLY",
        entityType: "document",
        entityId: before.docId,
        before: { fileName: before.name },
        after: { fileName: name, driveFileId: id, "آخر من عدّله في الدرايف": liveModifiers.get(id) ?? "غير معروف" },
      }, t);
    });
  }
  const justRecorded = [...new Set([...recordedFileIds, ...drifted.map(([id]) => id)])];

  /* ── ملفٌّ في مجلد شهرٍ غير شهر قيده: يُنبَّه ويُحسم حين يُنقل بيد صاحبه ── */
  if (liveMonths.size > 0) {
    const ids = [...liveMonths.keys()];
    const recordedMonths = (await db.select({ driveFileId: documents.driveFileId, month: invoices.periodMonth, fileName: documents.fileName, documentId: documents.id })
      .from(documents).innerJoin(invoices, eq(invoices.documentId, documents.id))
      .where(inArray(documents.driveFileId, ids)))
      .flatMap((r) => (r.driveFileId ? [{ ...r, driveFileId: r.driveFileId }] : []));
    const wrong = misplacedFiles(liveMonths, recordedMonths);
    const seenDocs = recordedMonths.map((r) => r.documentId);
    await db.transaction(async (t) => {
      await t.update(issues).set({ status: "RESOLVED", resolvedAt: new Date() }).where(and(
        eq(issues.code, ISSUE.FILE_IN_WRONG_MONTH), eq(issues.status, "OPEN"), inArray(issues.entityId, seenDocs),
        ...(wrong.length > 0 ? [notInArray(issues.entityId, wrong.map((w) => w.documentId))] : []),
      ));
      for (const w of wrong) {
        const [open] = await t.select({ id: issues.id }).from(issues)
          .where(and(eq(issues.code, ISSUE.FILE_IN_WRONG_MONTH), eq(issues.status, "OPEN"), eq(issues.entityId, w.documentId))).limit(1);
        if (!open) {
          await t.insert(issues).values({ code: ISSUE.FILE_IN_WRONG_MONTH, severity: "WARN", entityType: "document", entityId: w.documentId,
            message: `«${w.fileName}» في مجلد ${w.folderMonth} وفاتورتُه لشهر ${w.month} — انقله إلى مجلد ${w.month}` });
        }
      }
    });
    for (const w of wrong) notes.push(`${w.fileName} — في مجلد ${w.folderMonth} وفاتورتُه لـ${w.month}`);
  }

  /*
    ── ما قُيِّد ولم يعد في مجلّده ──

    يُحكَم على ما سُرد مجلّدُه كاملاً وحده، ثمّ يُسأل الدرايف عن الملفّ نفسه: نُقل إلى
    مجلّدٍ آخر (يُحدَّث مجلّدُه عندنا ولا تنبيه)، أم حُذف أو أُلقي في السلّة (تنبيهٌ في
    «يحتاج قرارك» — ويُستعاد من سلّة الدرايف خلال ثلاثين يوماً). وما لم يُعرف حالُه لا
    يُحكَم بغيابه. قراءةٌ محضة: لا شيء يُمسّ في الأرشيف.
  */
  if (walk) {
    const present = knownRows.flatMap((r) => (r.id && walk.seenFileIds.has(r.id) ? [r.docId] : []));
    if (present.length > 0) {
      await db.update(issues).set({ status: "RESOLVED", resolvedAt: new Date() }).where(and(
        eq(issues.code, ISSUE.FILE_MISSING_IN_DRIVE), eq(issues.status, "OPEN"), inArray(issues.entityId, present),
      ));
    }
    const unseen = missingFromDrive(
      knownRows.flatMap((r) => (r.id && r.status !== "REJECTED" ? [{ ...r, driveFileId: r.id, driveFolderId: r.folderId }] : [])),
      walk,
    );
    try {
      for (const doc of unseen.slice(0, MAX_PROBES_PER_CALL)) {
        const presence = await probeFile(drive, doc.driveFileId);
        if (presence.state === "unknown") continue;
        if (presence.state === "present") {
          if (presence.parentId && presence.parentId !== doc.driveFolderId) {
            await db.update(documents).set({ driveFolderId: presence.parentId }).where(eq(documents.id, doc.docId));
          }
          continue;
        }
        const where = presence.state === "trashed" ? "في سلّة الدرايف" : "حُذف من الدرايف";
        const [open] = await db.select({ id: issues.id }).from(issues)
          .where(and(eq(issues.code, ISSUE.FILE_MISSING_IN_DRIVE), eq(issues.status, "OPEN"), eq(issues.entityId, doc.docId))).limit(1);
        if (!open) {
          await db.insert(issues).values({
            code: ISSUE.FILE_MISSING_IN_DRIVE, severity: "WARN", entityType: "document", entityId: doc.docId,
            message: `«${doc.name}» ${where} — استعِده من سلّة الدرايف (تُفرَّغ بعد ثلاثين يوماً)، فالقيدُ بلا ورقته لا يسند خصمَ ضريبته`,
          });
        }
        notes.push(`${doc.name} — ${where}`);
      }
    } catch (e) {
      /* التفويضُ انتهى في أثناء السؤال: ما قُيِّد قبله قائم، والباقي في المزامنة التالية */
      if (!(e instanceof DriveAuthExpiredError)) throw e;
    }
  }

  /*
    ── التسميةُ الآليّة ── (إذن أحمد في ٢٤ سبتمبر ٢٠٢٦)

    ما أُرشِف للتوّ ويخالف اسمُه الصيغة يُسمّى الآن، بأثرٍ في السجلّ
    بالاسمين. وما ينتظر المراجعة لا يُسمّى — اسمُه يُبنى من قيدٍ لم يُحسَم —
    ويُسمّى حين يُعتمَد. وما لا يُبنى له اسمٌ يبقى اقتراحاً أو سبباً.
    والكتابةُ على الدرايف في الإنتاج وحده، وفي غيره تبقى اقتراحاً.
  */
  let renamed: { from: string; to: string }[] = [];
  const renameFailures: string[] = [];
  if (justRecorded.length > 0 && driveWritesAllowed(process.env)) {
    const outcome = await renameArchived(drive, justRecorded, user.id, "المزامنة");
    renamed = outcome.done;
    renameFailures.push(...outcome.failed.map((f) => `${f.from} — ${f.error}`));
  }
  const renamedFrom = new Set(renamed.map((r) => r.from));
  const renameSuggestions: { fileId: string; current: string; proposed: string }[] = [];

  if (justRecorded.length > 0) {
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
      .where(inArray(documents.driveFileId, justRecorded));

    for (const r of rows) {
      if (!r.driveFileId || renamedFrom.has(r.fileName)) continue;
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
        renameSuggestions.push({
          fileId: r.driveFileId, current: r.fileName, proposed: verdict.proposed,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    applied: true,
    summary: {
      ...scanned, created, invoicesCreated, paymentsAdopted, closedMonthSkipped, contentRead: read, remainingUnnamed: remaining,
      remainingNamed,
      autoArchived, needsReview: read - autoArchived, renamed: renamed.length,
    },
    /* لماذا لم يدخل ما لم يدخل — مجموعاً بالسبب، فيُعرَف أيُّ شرطٍ يُسقط أكثر */
    reviewReasons: [...reviewGaps.entries()].map(([gap, count]) => ({ gap, count })),
    renamed: [...backlog.renamed, ...renamed],
    backlog: { recorded: backlog.recorded, approved: backlog.approved, notes: backlog.notes.slice(0, 10) },
    renameFailures,
    notes: notes.slice(0, 20),
    readFailures,
    quotations,
    renameSuggestions,
  });
}

/* النداءات تحت عمر المسار — تقف بمهلةٍ معلَنة قبل أن تقتلها المنصّة */
export async function POST(request: Request) {
  return withDeadline(55_000, () => handle(request));
}

/** الأصلُ الذي وُجدت نسختُه بالبصمة. */
interface Original { docId: string; name: string }

/** من أين جاء الملفّ ومتى وُضع — يُكتب مع كلّ صفٍّ تُنشئه المزامنة (066). */
function driveOrigin(entry: ArchiveEntry) {
  const created = entry.file.createdTime ? new Date(entry.file.createdTime) : null;
  return {
    source: "DRIVE_SYNC",
    originalFileName: entry.file.name,
    driveCreatedAt: created && !Number.isNaN(created.getTime()) ? created : null,
    driveModifiedBy: entry.file.lastModifiedBy ?? null,
  };
}

const TEXT_SOURCES = ["TEXT", "PDF_EMBEDDED", "PDF_RENDERED", "DIRECT"] as const;

/** قراءةٌ حُفظت لهذه البصمة — تُفحَص بالمخطّط نفسه قبل أن تُصدَّق، وما لا يطابقه يُقرأ من جديد. */
async function savedReading(sha256: string): Promise<ExtractionSuccess | null> {
  const [row] = await db
    .select({ extraction: extractionCache.extraction, model: extractionCache.model, textSource: extractionCache.textSource })
    .from(extractionCache)
    .where(and(eq(extractionCache.sha256, sha256), gt(extractionCache.createdAt, new Date(Date.now() - READING_FRESH_MS))))
    .limit(1);
  if (!row) return null;
  const parsed = extractionSchema.safeParse(row.extraction);
  if (!parsed.success) return null;
  return {
    ok: true,
    value: parsed.data,
    model: row.model ?? "cache",
    provider: "deepseek",
    usage: { inputTokens: 0, outputTokens: 0 },
    textSource: TEXT_SOURCES.find((t) => t === row.textSource),
  };
}

async function saveReading(sha256: string, extraction: ExtractionSuccess, userId: string): Promise<void> {
  const reading = {
    extraction: extraction.value, model: extraction.model, textSource: extraction.textSource ?? null, userId,
  };
  await db.insert(extractionCache).values({ sha256, ...reading })
    .onConflictDoUpdate({ target: extractionCache.sha256, set: { ...reading, createdAt: new Date() } });
}

/**
 * نسخةٌ بالبصمة من ملفٍّ مقيَّد — تُقيَّد مرّةً «مرفوضةً» بسببها ولا تُقرأ.
 *
 * بلا صفٍّ تبقى «ملفّاً جديداً» فتُعدّ وتُذكَر في كلّ مزامنةٍ إلى الأبد. والمرفوضُ خارج
 * الفهرس الفريد وخارج التسمية (`loadNamedDocuments`)، وسببُه يُعرض في «رُفض» من الأثر.
 * ولا تُحفظ لها `sha256`: فإن أعادها إنسانٌ للمراجعة لم يصطدم بفرادة بصمة أصلها.
 */
async function recordCopy(entry: ArchiveEntry, original: Original): Promise<void> {
  const reason = `نسخةٌ من «${original.name}» — البصمةُ نفسُها`;
  await db.transaction(async (t) => {
    const [doc] = await t.insert(documents).values({
      driveFileId: entry.file.id,
      driveFolderId: entry.file.parents?.[0] ?? null,
      fileName: entry.file.name,
      mimeType: entry.file.mimeType,
      sizeBytes: entry.file.size ?? null,
      driveMd5: entry.file.md5Checksum ?? null,
      kind: "UNKNOWN",
      status: "REJECTED",
      statusNote: reason,
      duplicateOfId: original.docId,
      periodMonth: entry.month,
      ...driveOrigin(entry),
    }).onConflictDoNothing().returning({ id: documents.id });
    if (!doc) return;
    await recordAudit({
      actorId: null,
      action: "DOCUMENT_REJECTED",
      entityType: "document",
      entityId: doc.id,
      after: { الملف: entry.file.name, السبب: reason, الأصل: original.docId, المصدر: "مزامنة الدرايف" },
    }, t);
  });
}

/**
 * ملفٌّ قُرئ ولن يُقيَّد فاتورةً — عرضُ سعر، أو قراءةٌ فشلت — يُحفظ مستنداً.
 *
 * بلا صفٍّ يبقى «جديداً» فيعود أوّلَ الطابور في كلّ مزامنة. والفاشلُ ينتظر
 * إنساناً يُكمله من ملفّه («ينتظر» في المستندات)، وعرضُ السعر مؤرشفٌ بلا فاتورة.
 * ونسخةٌ بالبصمة نفسها لما حُفظ (`documents_sha_uniq`) لا تُكرَّر.
 */
async function recordUnread(
  entry: ArchiveEntry,
  /** `null`: لم يُنزَّل أصلاً — فلا بصمةَ له إلّا ما أعطاه الدرايف */
  data: Buffer | null,
  mimeType: string,
  userId: string,
  kind: "QUOTATION" | "UNKNOWN",
  outcome: { reading?: unknown; error?: string } = {},
): Promise<void> {
  await db.insert(documents).values({
    driveFileId: entry.file.id,
    driveFolderId: entry.file.parents?.[0] ?? null,
    fileName: entry.file.name,
    mimeType,
    sizeBytes: data ? data.length : entry.file.size ?? null,
    sha256: data ? createHash("sha256").update(data).digest("hex") : null,
    driveMd5: entry.file.md5Checksum ?? (data ? createHash("md5").update(data).digest("hex") : null),
    kind,
    status: kind === "QUOTATION" ? "ARCHIVED" : "NEEDS_REVIEW",
    periodMonth: entry.month,
    extractionJson: outcome.reading ?? null,
    uploadedById: userId,
    /* سببُ الفشل بنصّه — كان يظهر مرّةً في ردّ المزامنة ثمّ يضيع، فيقول ملفُّ المستند «لم يُقرأ» ولا يقول لماذا */
    readAttempts: 1,
    lastReadAt: new Date(),
    lastReadError: outcome.error ? outcome.error.slice(0, 500) : null,
    ...driveOrigin(entry),
  }).onConflictDoNothing();
}
