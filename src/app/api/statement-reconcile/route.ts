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
  documents, statements,
  supplierAliases, suppliers,
} from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { DriveAuthExpiredError, DriveFileTooLargeError, driveForUser, downloadFile, isDriveAuthError } from "@/lib/drive";
import { extractDocument, isSupportedUpload } from "@/lib/extraction";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import {
  buildDiscrepancyMemo, type StatementLineInput,
} from "@/lib/statement-match";
import { parseStatementExtras } from "@/lib/extraction/statement-extras";
import { companyConfig } from "@/config/drive";
import { reconcileAndPersist } from "@/services/statement-reconcile.service";
import { withDeadline } from "@/lib/ai/deadline";
import { signatureMatches, sniffMimeType } from "@/lib/file-signature";

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
  if (!form) return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب." }, { status: 400 });

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
      return NextResponse.json({ error: "لا ملف في الدرايف لهذا الكشف" }, { status: 400 });
    }

    /* من الحارس وحده: وضعُ التجربة لا يستعير تفويض المالك (drive.service.ts) */
  const token = await refreshTokenFor(user.id);

    if (!token) {
      return NextResponse.json(
        { error: "لا يوجد تفويض درايف لحسابك. سجّل الخروج ثم الدخول ووافق على صلاحية الدرايف." },
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
        { error: tooBig ? e.message : "تعذّر تنزيل الكشف من الدرايف — تحقّق من أنّ الملفّ ما زال في مكانه ثمّ أعد المحاولة" },
        { status: tooBig ? 413 : 502 },
      );
    }

    supplierId = row.supplierId;
    periodStart = row.periodStart;
    periodEnd = row.periodEnd;
    fileName = row.fileName;
    documentId = row.documentId;
  } else {
    if (!(file instanceof File)) return NextResponse.json({ error: "لم يصل ملف" }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "حجم الملف يتجاوز ٤ ميجابايت — حدّ المنصّة" }, { status: 400 });
    if (!isSupportedUpload(file.type)) {
      return NextResponse.json({ error: "نوع غير مدعوم — المقبول PDF أو صورة" }, { status: 400 });
    }
    data = Buffer.from(await file.arrayBuffer());
    /* النوعُ من بصمة الملفّ لا ممّا أعلنه المتصفّح — قبل أيّ محلِّل */
    const sniffed = sniffMimeType(data);
    if (!sniffed) {
      return NextResponse.json({ error: "محتوى الملفّ ليس PDF ولا صورة — تحقّق من الملفّ ثمّ أعد الرفع" }, { status: 400 });
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
        error: "لم يُعرف المورّد من الكشف — اختره يدوياً",
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
      { error: "لم تُقرأ أي حركة من الكشف. تأكّد أنّ الملف كشف حساب لا فاتورة." },
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
    supplier: { id: supplierId, nameAr: supplier?.nameAr ?? "—" },
    period: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
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
      date: l.line.date.toISOString().slice(0, 10),
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
      date: i.invoiceDate.toISOString().slice(0, 10),
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
