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
import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts, documents, invoices, issues, statementLines, statements,
  supplierAliases, suppliers,
} from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { driveForUser, downloadFile } from "@/lib/drive";
import { extractDocument, isSupportedUpload } from "@/lib/extraction";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import {
  buildDiscrepancyMemo, reconcileStatement,
  type OurInvoice, type StatementLineInput,
} from "@/lib/statement-match";
import { parseRiyals } from "@/lib/money";
import { companyConfig } from "@/config/drive";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export async function POST(request: Request) {  let user;
  try {
    user = await guard("statement-reconcile", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });

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

    const [tokenRow] = await db
      .select({ token: accounts.refresh_token })
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.provider, "google")))
      .limit(1);

    if (!tokenRow?.token) {
      return NextResponse.json(
        { error: "لا يوجد تفويض درايف لحسابك. سجّل الخروج ثم الدخول ووافق على صلاحية الدرايف." },
        { status: 428 },
      );
    }

    try {
      ({ data, mimeType } = await downloadFile(driveForUser(tokenRow.token), row.driveFileId));
    } catch (e) {
      return NextResponse.json(
        { error: `تعذّر تنزيل الكشف من الدرايف: ${(e as Error).message}` },
        { status: 502 },
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
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "حجم الملف يتجاوز ٢٥ ميجابايت" }, { status: 400 });
    if (!isSupportedUpload(file.type)) {
      return NextResponse.json({ error: "نوع غير مدعوم — المقبول PDF أو صورة" }, { status: 400 });
    }
    data = Buffer.from(await file.arrayBuffer());
    mimeType = file.type;
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

  // سطور الكشف كما قرأها النموذج — بلا حساب ولا تلفيق
  const parsedLines: StatementLineInput[] = [];
  for (const l of x.statementLines) {
    const debit = parseRiyals(l.debit ?? "") ?? 0;
    const credit = parseRiyals(l.credit ?? "") ?? 0;
    if (debit === 0 && credit === 0) continue;
    const date = DATE_RE.test(l.date) ? new Date(`${l.date}T00:00:00Z`) : null;
    if (!date) continue;
    parsedLines.push({ date, ref: l.ref || null, description: l.description || null, debitMinor: debit, creditMinor: credit });
  }

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
  const times = parsedLines.map((l) => l.date.getTime());
  const start = new Date(Math.min(...times));
  const end = new Date(Math.max(...times));
  void periodStart;
  void periodEnd;

  /*
   * نافذة الفواتير أوسع من مدى السطور بأسبوع من الطرفين.
   *
   * تاريخ المورّد للحركة ليس تاريخ فاتورتنا: رأينا سطراً بتاريخ ٢٣ أغسطس
   * يخصّ فاتورة عندنا بتاريخ ٢٦. فحصر النافذة في مدى السطور يُخفي الفاتورة
   * عن المطابقة، فتُعلَن «ناقصة» وهي عندنا — وإنذارٌ كاذب في هذا الموضع
   * يُفقد الميزة كلّها قيمتها.
   */
  const PAD_MS = 7 * 86_400_000;
  const windowStart = new Date(start.getTime() - PAD_MS);
  const windowEnd = new Date(end.getTime() + PAD_MS);

  const invRows = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      totalMinor: invoices.totalMinor,
    })
    .from(invoices)
    .where(and(
      eq(invoices.supplierId, supplierId),
      gte(invoices.invoiceDate, windowStart),
      lte(invoices.invoiceDate, windowEnd),
    ));

  const ours: OurInvoice[] = invRows;

  const opening = parseRiyals(x.openingBalance ?? "");
  const closing = parseRiyals(x.closingBalance ?? "") ?? parseRiyals(x.totalAmount ?? "");

  const result = reconcileStatement(parsedLines, ours, {
    openingBalanceMinor: opening ?? 0,
    closingBalanceMinor: closing ?? undefined,
  });

  const periodLabel = `${start.toISOString().slice(0, 10)} إلى ${end.toISOString().slice(0, 10)}`;
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
    memo,
  };

  if (!persist) return NextResponse.json(payload);

  // ── الحفظ: سطور الكشف ونتيجته وتنبيهاته ──
  await db.transaction(async (tx) => {
    // تُعاد كتابة السطور كاملةً فتبقى إعادة المطابقة ممكنة بلا تكرار
    await tx.delete(statementLines).where(eq(statementLines.statementId, statementId));

    for (const l of result.lines) {
      await tx.insert(statementLines).values({
        statementId,
        date: l.line.date,
        ref: l.line.ref ?? null,
        description: l.line.description ?? null,
        debitMinor: l.line.debitMinor,
        creditMinor: l.line.creditMinor,
        matchedInvoiceId: l.invoice?.invoiceId ?? null,
        matchStatus:
          l.status === "MATCHED" ? "MATCHED"
          : l.status === "AMOUNT_MISMATCH" ? "DISPUTED"
          : l.status === "PAYMENT" ? "IGNORED"
          : "UNMATCHED",
      });
    }

    // الفترة المسجَّلة كانت مستنتَجة من اسم الملف؛ الآن نعرف ما تغطّيه سطوره
    await tx.update(statements).set({
      periodStart: start,
      periodEnd: end,
      openingBalanceMinor: opening ?? 0,
      closingBalanceMinor: closing ?? 0,
    }).where(eq(statements.id, statementId));

    for (const f of result.findings) {
      await tx.insert(issues).values({
        code: f.code,
        severity: f.severity,
        entityType: "statement",
        entityId: statementId,
        message: f.message,
      });
    }
  });

  await recordAudit({
    actorId: user.id,
    action: "STATEMENT_RECONCILED",
    entityType: "statement",
    entityId: statementId,
    after: {
      المورّد: supplier?.nameAr,
      الفترة: periodLabel,
      سطور: parsedLines.length,
      طوبقت: result.matchedCount,
      ناقصة_من_الأرشيف: result.missingFromArchive.length,
      فروق_مبالغ: result.amountMismatches.length,
      المستند: documentId,
    },
  });

  return NextResponse.json({ ...payload, persisted: true });
}
