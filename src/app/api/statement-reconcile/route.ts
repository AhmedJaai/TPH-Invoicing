/**
 * مطابقة كشف حساب المورّد بفواتيرنا.
 *
 * الغاية الأولى منها: كشف الفاتورة التي حمّلها المورّد على حسابنا ولم تصلنا.
 * تلك الفاتورة لا تُرى في أرشيفنا مهما فتّشناه — لأنّها ليست فيه — ولا تظهر
 * إلا بمقابلة ما عندنا بما عنده.
 *
 * طريقان:
 *   statementId — كشف مؤرشف في الدرايف: يُقرأ محتواه وتُحفظ سطوره ونتيجته.
 *   file        — كشف وصل توّاً: يُقرأ ويُطابَق ويُعرض، ولا يُحفظ شيء.
 */
import { refreshTokenFor } from "@/services/drive.service";
import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  documents, statementLines, statements,
  supplierAliases, suppliers,
} from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { DriveAuthExpiredError, DriveFileTooLargeError, driveForUser, downloadFile, isDriveAuthError } from "@/lib/drive";
import { extractDocument, isSupportedUpload } from "@/lib/extraction";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import {
  buildDiscrepancyMemo, type StatementLineInput,
} from "@/lib/statement-match";
import { parseStatementExtras, readingBalances } from "@/lib/extraction/statement-extras";
import { companyConfig } from "@/config/drive";
import { reconcileAndPersist } from "@/services/statement-reconcile.service";
import { withDeadline } from "@/lib/ai/deadline";
import { signatureMatches, sniffMimeType } from "@/lib/file-signature";
import { isoDay } from "@/lib/riyadh-time";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

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

async function supplierPhone(supplierId: string): Promise<string | null> {
  const [row] = await db.select({ phone: suppliers.phoneE164 }).from(suppliers).where(eq(suppliers.id, supplierId));
  return row?.phone ?? null;
}

async function handle(request: Request) {
  let user;
  try {
    user = await guard("statement-reconcile", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، وإن تكرر فأبلغ مالك الحساب." }, { status: 400 });

  const statementId = String(form.get("statementId") ?? "").trim();
  const file = form.get("file");
  const persist = Boolean(statementId);

  let data: Buffer;
  let mimeType: string;
  let supplierId: string | null = null;
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let fileName = "";
  let documentId: string | null = null;

  if (persist) {
    const [row] = await db
      .select({
        statementId: statements.id,
        supplierId: statements.supplierId,
        periodStart: statements.periodStart,
        periodEnd: statements.periodEnd,
        documentId: statements.documentId,
        driveFileId: documents.driveFileId,
        fileName: documents.fileName,
      })
      .from(statements)
      .innerJoin(documents, eq(documents.id, statements.documentId))
      .where(eq(statements.id, statementId))
      .limit(1);

    if (!row) return NextResponse.json({ error: "الكشف غير موجود" }, { status: 404 });
    if (!row.driveFileId) {
      return NextResponse.json({ error: "لا يوجد ملف في الدرايف لهذا الكشف" }, { status: 400 });
    }

    /* من الحارس وحده: وضعُ التجربة لا يستعير تفويض المالك (drive.service.ts) */
  const token = await refreshTokenFor(user.id);

    if (!token) {
      return NextResponse.json(
        { error: "حسابك غير مفوَّض على الدرايف. سجّل الخروج ثم ادخل من جديد ووافق على صلاحية الدرايف." },
        { status: 428 },
      );
    }

    try {
      ({ data, mimeType } = await downloadFile(driveForUser(token), row.driveFileId));
    } catch (e) {
      if (isDriveAuthError(e)) {
        return NextResponse.json({ error: new DriveAuthExpiredError().message }, { status: 428 });
      }
      /* نصُّ خطأ جوجل (وفيه معرّفُ الملفّ) لسجلّ الخادم لا للشاشة */
      console.error("[statement-reconcile] تعذّر تنزيل الكشف:", e);
      const tooBig = e instanceof DriveFileTooLargeError;
      return NextResponse.json(
        { error: tooBig ? e.message : "تعذّر تنزيل الكشف من الدرايف. تأكد أن الملف ما زال في مكانه، ثم أعد المحاولة." },
        { status: tooBig ? 413 : 502 },
      );
    }

    supplierId = row.supplierId;
    periodStart = row.periodStart;
    periodEnd = row.periodEnd;
    fileName = row.fileName;
    documentId = row.documentId;
  } else {
    if (!(file instanceof File)) return NextResponse.json({ error: "لم يصل أي ملف" }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "حجم الملف أكبر من ٤ ميجابايت، وهو الحد الأقصى" }, { status: 400 });
    if (!isSupportedUpload(file.type)) {
      return NextResponse.json({ error: "نوع الملف غير مدعوم. المقبول: PDF أو صورة." }, { status: 400 });
    }
    data = Buffer.from(await file.arrayBuffer());
    /* النوعُ من بصمة الملفّ لا ممّا أعلنه المتصفّح — قبل أيّ محلِّل */
    const sniffed = sniffMimeType(data);
    if (!sniffed) {
      return NextResponse.json({ error: "الملف ليس PDF ولا صورة. تأكد منه ثم أعد رفعه." }, { status: 400 });
    }
    mimeType = signatureMatches(file.type, data) ? file.type : sniffed;
    fileName = file.name;
    const given = String(form.get("supplierId") ?? "").trim();
    supplierId = given || null;
  }

  const supplierList = await loadSuppliers();

  const extraction = await extractDocument({
    data, mimeType,
    companyVat: companyConfig.vatNumber,
    companyName: companyConfig.nameAr,
    supplierNames: supplierList.map((s) => `${s.nameAr} (${s.slug})`),
  });

  if (!extraction.ok) return NextResponse.json({ error: extraction.reason }, { status: 502 });
  const x = extraction.value;

  if (!supplierId) {
    const matched = matchSupplier(supplierList, {
      sellerVatNumber: x.sellerVatNumber,
      supplierNameAr: x.supplierNameAr,
      supplierNameEn: x.supplierNameEn,
    });
    supplierId = matched.supplier?.id ?? null;
  }

  if (!supplierId) {
    return NextResponse.json(
      {
        error: "لم يتعرّف النظام على المورّد من الكشف، فاختره بنفسك.",
        needsSupplier: true,
        candidates: supplierList.map((s) => ({ id: s.id, nameAr: s.nameAr })),
      },
      { status: 409 },
    );
  }

  const supplier = supplierList.find((s) => s.id === supplierId);

  /*
    سطورُ الكشف كما قرأها النموذج — بالقاعدة نفسها التي يُقيَّد بها كشفُ المزامنة والرفع
    (`parseStatementExtras`): ما لم يُقرأ مبلغُه أو تاريخُه يُعلَن، والرصيدُ الجاري المقروء
    مديناً يُعاد إلى موضعه. كانت نسخةً ثانيةً هنا فلم يصلها الإصلاح.
  */
  const extras = parseStatementExtras(x);
  const parsedLines: StatementLineInput[] = extras.lines;
  const unreadLines = extras.unreadLines;

  if (parsedLines.length === 0) {
    return NextResponse.json(
      { error: "لم يُقرأ من الكشف أي حركة. تأكد أن الملف كشف حساب لا فاتورة." },
      { status: 400 },
    );
  }

  /*
   * الفترة تُؤخذ من سطور الكشف نفسها لا من حقل مسجَّل.
   *
   * درسٌ من أوّل مطابقة حقيقية: الترحيل استنتج فترة الكشف من تاريخ اسم الملف
   * فجعلها شهراً واحداً، وكشف أوراق الزيتون تراكميّ يغطّي أربعة أشهر. فقُوبلت
   * سطوره كلّها بفواتير شهر واحد، فظهرت ست وثلاثون فاتورة «ناقصة» وهي عندنا.
   * والكشف يغطّي ما تغطّيه سطوره، لا ما يقوله اسم ملفه.
   */
  void periodStart;
  void periodEnd;

  /*
    قراءةٌ لا يستقيم حسابُها لا تحلّ محلَّ قراءةٍ يستقيم حسابُها. النموذجُ قد يأخذ عمودَ الرصيد
    مبلغاً أو يُسقط سطراً في قراءةٍ ثانية — والمحفوظُ المتّزنُ أصدقُ منه. فيُبقى، ويُقال لماذا.
  */
  if (persist) {
    const fresh = readingBalances(parsedLines, extras.openingBalanceMinor, extras.closingBalanceMinor);
    if (fresh === false) {
      const [old] = await db.select({ ob: statements.openingBalanceMinor, cb: statements.closingBalanceMinor }).from(statements).where(eq(statements.id, statementId)).limit(1);
      const kept = await db.select({ debitMinor: statementLines.debitMinor, creditMinor: statementLines.creditMinor }).from(statementLines).where(eq(statementLines.statementId, statementId));
      if (old && readingBalances(kept, old.ob, old.cb) === true) {
        return NextResponse.json({
          error: "القراءة الجديدة للكشف لا يستقيم حسابها (الرصيد الافتتاحي مع الحركات لا يساوي الختامي)، "
            + "فربما أُخذ عمود الرصيد مكان المبلغ أو سقط سطر. أبقيتُ القراءة السابقة لأن حسابها مستقيم، ولم يتغيّر شيء.",
        }, { status: 409 });
      }
    }
  }

  const { result, ours, start, end, periodLabel } = await reconcileAndPersist({
    statementId: persist ? statementId : null,
    supplierId,
    supplierName: supplier?.nameAr ?? "المورّد",
    documentId,
    lines: parsedLines,
    openingMinor: extras.openingBalanceMinor,
    closingMinor: extras.closingBalanceMinor,
    actorId: user.id,
    persist,
  });

  const memo = buildDiscrepancyMemo(supplier?.nameAr ?? "المورّد", periodLabel, result);

  const payload = {
    ok: true,
    persisted: false,
    fileName,
    /* الرقمُ يصحب المذكّرة — فيفتح واتساب على المورّد لا على شاشة اختيار الجهة */
    supplier: { id: supplierId, nameAr: supplier?.nameAr ?? "—", phoneE164: await supplierPhone(supplierId) },
    period: { start: isoDay(start), end: isoDay(end) },
    model: extraction.model,
    summary: {
      statementLines: parsedLines.length,
      ourInvoices: ours.length,
      matched: result.matchedCount,
      missingFromArchive: result.missingFromArchive.length,
      amountMismatches: result.amountMismatches.length,
      notInStatement: result.notInStatement.length,
      theirBilledMinor: result.theirBilledMinor,
      theirPaidMinor: result.theirPaidMinor,
      ourBilledMinor: result.ourBilledMinor,
      billedDifferenceMinor: result.billedDifferenceMinor,
      balanceArithmeticOk: result.balanceArithmeticOk,
    },
    missing: result.missingFromArchive.map((l) => ({
      date: isoDay(l.line.date),
      ref: l.line.ref ?? l.line.description ?? "—",
      amountMinor: l.line.debitMinor,
    })),
    mismatches: result.amountMismatches.map((l) => ({
      invoiceNumber: l.invoice!.invoiceNumber,
      theirsMinor: l.line.debitMinor,
      oursMinor: l.invoice!.totalMinor,
      differenceMinor: l.differenceMinor ?? 0,
    })),
    extra: result.notInStatement.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      date: isoDay(i.invoiceDate),
      amountMinor: i.totalMinor,
    })),
    findings: result.findings,
    unreadLines,
    memo,
  };

  if (!persist) return NextResponse.json(payload);
  return NextResponse.json({ ...payload, persisted: true });
}

/* النداءات تحت عمر المسار — تقف بمهلةٍ معلَنة قبل أن تقتلها المنصّة */
export async function POST(request: Request) {
  return withDeadline(55_000, () => handle(request));
}
