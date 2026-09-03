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
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts, documents, invoiceLines, invoices, payments, statements,
  supplierAliases, suppliers,
} from "@/db/schema";
import { requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";
import { driveForUser, downloadFile } from "@/lib/drive";
import { recentMonths, walkArchive, type ArchiveEntry } from "@/lib/drive-sync";
import { parseFileName } from "@/lib/naming";
import { KNOWN_SLUGS } from "@/lib/suppliers-seed";
import { planImport } from "@/lib/archive-import";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import { extractDocument } from "@/lib/extraction";
import { reviewConfirmed } from "@/lib/confirm";
import { normalizeItem } from "@/lib/items";
import { parseRiyals } from "@/lib/money";
import { companyConfig } from "@/config/drive";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** حدّ لكل طلب: الاستدعاء السحابي له سقف زمني، والباقي يكمله الطلب التالي. */
const MAX_NAMED_PER_CALL = 60;
const MAX_CONTENT_PER_CALL = 4;

interface Body {
  /** عدد الأشهر الأخيرة التي تُفحص. الافتراضي ثلاثة. */
  months?: number;
  /** فحص الأرشيف كله — أبطأ بكثير */
  full?: boolean;
  apply?: boolean;
  /** قراءة محتوى الملفات التي لا يُفهم اسمها */
  readContent?: boolean;
}

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

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("document:upload");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;
  const apply = body.apply === true;

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

  const drive = driveForUser(tokenRow.token);

  const known = new Set(
    (await db.select({ id: documents.driveFileId }).from(documents))
      .map((d) => d.id)
      .filter((v): v is string => Boolean(v)),
  );

  const months = body.full ? undefined : recentMonths(Math.max(1, Math.min(24, body.months ?? 3)));

  let fresh: ArchiveEntry[];
  try {
    fresh = await walkArchive(drive, { months, knownFileIds: known });
  } catch (e) {
    return NextResponse.json(
      { error: `تعذّرت قراءة الدرايف: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const supplierList = await loadSuppliers();
  const bySlug = new Map(supplierList.map((s) => [s.slug, s]));
  const byFolder = new Map(supplierList.map((s) => [s.driveFolderName.trim(), s]));

  const named: { entry: ArchiveEntry; parsed: ReturnType<typeof parseFileName> }[] = [];
  const unnamed: ArchiveEntry[] = [];

  for (const entry of fresh) {
    const parsed = parseFileName(entry.file.name, KNOWN_SLUGS);
    if (parsed.ok) named.push({ entry, parsed });
    else unnamed.push(entry);
  }

  const scanned = {
    scope: body.full ? "الأرشيف كله" : `آخر ${months!.length} أشهر`,
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
      files: fresh.slice(0, 40).map((e) => ({
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
  const notes: string[] = [];

  for (const { entry, parsed } of named.slice(0, MAX_NAMED_PER_CALL)) {
    if (!parsed.ok) continue;
    const p = parsed.value;
    const supplier = p.slug ? bySlug.get(p.slug) : byFolder.get(entry.folderName.trim());
    const plan = planImport(p, Boolean(supplier));
    for (const n of plan.notes) notes.push(`${entry.file.name} — ${n}`);

    const date = new Date(`${p.date}T00:00:00Z`);

    await db.transaction(async (tx) => {
      const [doc] = await tx.insert(documents).values({
        driveFileId: entry.file.id,
        driveFolderId: entry.file.parents?.[0] ?? null,
        fileName: entry.file.name,
        mimeType: entry.file.mimeType,
        sizeBytes: entry.file.size ?? null,
        kind: plan.documentKind as never,
        status: "ARCHIVED",
        periodMonth: entry.month,
        supplierId: supplier?.id ?? null,
        uploadedById: user.id,
      }).onConflictDoNothing().returning({ id: documents.id });

      if (!doc) return; // سُجّل بين الفحص والكتابة — لا نكرّره
      created++;

      if (plan.createsInvoice && supplier) {
        await tx.insert(invoices).values({
          documentId: doc.id,
          supplierId: supplier.id,
          invoiceNumber: p.invoiceNumber!,
          invoiceDate: date,
          periodMonth: entry.month,
          subtotalMinor: 0,
          vatMinor: 0,
          totalMinor: p.amountMinor!,
        }).onConflictDoNothing();
        invoicesCreated++;
      }

      if (plan.createsStatement && supplier) {
        await tx.insert(statements).values({
          documentId: doc.id,
          supplierId: supplier.id,
          periodStart: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
          periodEnd: date,
          closingBalanceMinor: p.amountMinor!,
        });
      }

      if (plan.createsPayment) {
        await tx.insert(payments).values({
          documentId: doc.id,
          supplierId: supplier?.id ?? null,
          paidAt: date,
          amountMinor: p.amountMinor!,
          method: plan.paymentMethod,
          beneficiaryNameRaw: p.beneficiary ?? null,
          appliesToMonth: entry.month,
        });
      }
    });
  }

  // ── الملفات التي لا يُفهم اسمها: تُقرأ بمحتواها ──
  let read = 0;
  const readFailures: string[] = [];

  if (body.readContent) {
    for (const entry of unnamed.slice(0, MAX_CONTENT_PER_CALL)) {
      let data: Buffer;
      let mimeType: string;
      try {
        ({ data, mimeType } = await downloadFile(drive, entry.file.id));
      } catch {
        readFailures.push(`${entry.file.name} — تعذّر التنزيل`);
        continue;
      }

      const extraction = await extractDocument({
        data, mimeType,
        companyVat: companyConfig.vatNumber,
        companyName: companyConfig.nameAr,
        supplierNames: supplierList.map((s) => `${s.nameAr} (${s.slug})`),
      });

      if (!extraction.ok) {
        readFailures.push(`${entry.file.name} — ${extraction.reason}`);
        continue;
      }

      const x = extraction.value;
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
          sellerVat: x.sellerVatNumber,
          buyerVat: x.buyerVatNumber,
        },
        {
          companyVat: companyConfig.vatNumber,
          supplierIssuesInvoices: supplier?.issuesInvoices,
          supplierContractOnFile: supplier?.contractOnFile,
        },
      );

      await db.transaction(async (tx) => {
        const [doc] = await tx.insert(documents).values({
          driveFileId: entry.file.id,
          driveFolderId: entry.file.parents?.[0] ?? null,
          fileName: entry.file.name,
          mimeType,
          sizeBytes: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          kind: x.documentKind as never,
          status: "ARCHIVED",
          periodMonth: entry.month,
          supplierId: supplier?.id ?? null,
          extractionJson: x as never,
          extractionModel: extraction.model,
          fieldConfidence: x.confidence as never,
          uploadedById: user.id,
        }).onConflictDoNothing().returning({ id: documents.id });

        if (!doc) return;
        created++;
        read++;

        if (!review.canCreateInvoice || !supplier) return;

        const totalMinor = parseRiyals(x.totalAmount)!;
        const [inv] = await tx.insert(invoices).values({
          documentId: doc.id,
          supplierId: supplier.id,
          invoiceNumber: x.invoiceNumber.trim(),
          invoiceDate: new Date(`${x.invoiceDate}T00:00:00Z`),
          periodMonth: entry.month || x.invoiceDate.slice(0, 7),
          subtotalMinor: parseRiyals(x.subtotalAmount) ?? 0,
          vatMinor: parseRiyals(x.vatAmount) ?? 0,
          totalMinor,
          sellerVat: x.sellerVatNumber || null,
          buyerVat: x.buyerVatNumber || null,
          isTaxValid: review.isTaxValid,
          inputVatEligible: review.inputVatEligible,
          isFixedAsset: review.isFixedAsset,
        }).onConflictDoNothing().returning({ id: invoices.id });

        if (!inv) return;
        invoicesCreated++;

        for (const l of x.lines) {
          const description = l.description?.trim();
          if (!description) continue;
          const unit = parseRiyals(l.unitPrice ?? "");
          const lineTotal = parseRiyals(l.lineTotal ?? "");
          if (unit === null && lineTotal === null) continue;
          const qty = Number((l.quantity ?? "1").replace(/[^\d.]/g, "")) || 1;
          const resolvedTotal = lineTotal ?? Math.round((unit ?? 0) * qty);
          await tx.insert(invoiceLines).values({
            invoiceId: inv.id,
            description,
            normalizedDescription: normalizeItem(description),
            qty: String(qty),
            unitPriceMinor: unit ?? (qty > 0 ? Math.round(resolvedTotal / qty) : resolvedTotal),
            lineTotalMinor: resolvedTotal,
            invoiceDate: new Date(`${x.invoiceDate}T00:00:00Z`),
            supplierId: supplier.id,
          });
        }
      });
    }
  }

  const remaining = Math.max(0, unnamed.length - (body.readContent ? MAX_CONTENT_PER_CALL : 0));

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
        قُرئ_محتواها: read,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    applied: true,
    summary: { ...scanned, created, invoicesCreated, contentRead: read, remainingUnnamed: remaining },
    notes: notes.slice(0, 20),
    readFailures,
  });
}
