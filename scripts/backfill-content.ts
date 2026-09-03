/**
 * قراءة محتوى الأرشيف — مرّة واحدة.
 *
 *   npm run drive:backfill -- --dry            معاينة بلا كتابة
 *   npm run drive:backfill -- --commit         الكتابة فعلاً
 *   npm run drive:backfill -- --commit --limit 20
 *   npm run drive:backfill -- --commit --delay 4000
 *
 * الترحيل الأوّل قرأ أسماء الملفات، والاسم يحمل الإجمالي وحده. فبقيت
 * ١٢٢ فاتورة بضريبة صفر وبلا بنود، فظهرت لوحة القيادة تقول «صفر ضريبة
 * معرّضة» والحقيقة «لا أعرف». هذا السكربت يقرأ الملف نفسه فيملأ التفصيل
 * الضريبي والبنود والبصمة.
 *
 * قواعد أمان مقصودة:
 *   ١. لا يمسّ الدرايف إلا قراءةً — لا حذف ولا نقل ولا إعادة تسمية.
 *   ٢. لا يغيّر مبلغاً إجمالياً كتبه إنسان في اسم الملف. إن خالفه المحتوى
 *      سُجّل الخلاف ولم يُكتب — تصحيح المال قرار إنسان لا آلة.
 *   ٣. قابل للاستئناف: ما قُرئ محتواه يُتخطّى، فانقطاع الشوط لا يعيده من أوّله.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts, documents, invoiceLines, invoices, supplierAliases, suppliers,
} from "@/db/schema";
import { driveForCli, downloadFile } from "@/lib/drive";
import { walkArchive } from "@/lib/drive-sync";
import { extractDocument, activeProviderName } from "@/lib/extraction";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import { reviewConfirmed } from "@/lib/confirm";
import { normalizeItem } from "@/lib/items";
import { parseRiyals, formatRiyalsDisplay } from "@/lib/money";
import { companyConfig } from "@/config/drive";

const commit = process.argv.includes("--commit");
const argOf = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};
const limit = argOf("--limit", Number.POSITIVE_INFINITY);
/** الطبقة المجانية تُجهَد بسرعة؛ التمهّل أرخص من إعادة الشوط كله. */
const delayMs = argOf("--delay", 5000);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** رسائل تعني «الحصّة نفدت» أو «النموذج مضغوط» — تستحق صبراً لا استسلاماً. */
function isQuotaProblem(reason: string): boolean {
  return /حدّ الطبقة المجانية|ضغط شديد|429|503/.test(reason);
}

/**
 * قراءة ملف مع صبر طويل.
 *
 * إعادة المحاولة داخل المزوّد تقيس بالثواني، وحصّة الطبقة المجانية تُحسب
 * بالدقيقة. فمحاولات سريعة متتابعة تستهلك الحصّة ولا تنتظر تجدّدها.
 * هنا ننتظر تجدّد الدقيقة فعلاً قبل أن نعاود.
 */
async function extractPatiently(
  request: Parameters<typeof extractDocument>[0],
  label: string,
): Promise<Awaited<ReturnType<typeof extractDocument>>> {
  const waits = [65_000, 65_000, 120_000];
  let outcome = await extractDocument(request);

  for (let i = 0; i < waits.length && !outcome.ok && isQuotaProblem(outcome.reason); i++) {
    console.log(`${label} — الحصّة نفدت، ننتظر ${Math.round(waits[i] / 1000)} ثانية ثم نعاود…`);
    await wait(waits[i]);
    outcome = await extractDocument(request);
  }

  return outcome;
}

async function storedDrive() {
  return driveForCli(async () => {
    const [row] = await db
      .select({ token: accounts.refresh_token })
      .from(accounts)
      .where(eq(accounts.provider, "google"))
      .limit(1);
    return row?.token ?? null;
  });
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

interface Target {
  documentId?: string;
  driveFileId: string;
  fileName: string;
  month: string;
  folderName?: string;
  supplierId?: string | null;
  invoiceId?: string;
  storedTotalMinor?: number | null;
}

interface Outcome {
  fileName: string;
  status: "updated" | "created" | "skipped" | "failed" | "mismatch";
  detail: string;
  linesAdded?: number;
}

async function main() {
  console.log(`\nوضع التشغيل : ${commit ? "كتابة فعلية" : "معاينة فقط (أضف --commit)"}`);
  console.log(`قارئ الفواتير: ${activeProviderName()}`);
  console.log(`التمهّل      : ${delayMs} مللي ثانية بين ملف وآخر\n`);

  const drive = await storedDrive();
  const supplierList = await loadSuppliers();
  const byFolder = new Map(supplierList.map((s) => [s.driveFolderName.trim(), s]));

  // ── ما يحتاج قراءة: مستند بلا مخرجات نموذج محفوظة ──
  const docRows = await db
    .select({
      id: documents.id,
      driveFileId: documents.driveFileId,
      fileName: documents.fileName,
      periodMonth: documents.periodMonth,
      supplierId: documents.supplierId,
      extractionJson: documents.extractionJson,
      invoiceId: invoices.id,
      invoiceTotal: invoices.totalMinor,
    })
    .from(documents)
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .where(and(isNull(documents.extractionJson), or(isNull(documents.sha256), isNull(documents.sha256))));

  const targets: Target[] = docRows
    .filter((d) => d.driveFileId)
    .map((d) => ({
      documentId: d.id,
      driveFileId: d.driveFileId!,
      fileName: d.fileName,
      month: d.periodMonth ?? "",
      supplierId: d.supplierId,
      invoiceId: d.invoiceId ?? undefined,
      storedTotalMinor: d.invoiceTotal ?? null,
    }));

  // ── وملفات في الدرايف لم يُفهم اسمها فلم تدخل القاعدة أصلاً ──
  const knownIds = new Set(
    (await db.select({ id: documents.driveFileId }).from(documents))
      .map((d) => d.id).filter((v): v is string => Boolean(v)),
  );
  const orphans = await walkArchive(drive, { knownFileIds: knownIds });
  for (const o of orphans) {
    targets.push({
      driveFileId: o.file.id,
      fileName: o.file.name,
      month: o.month,
      folderName: o.folderName,
    });
  }

  console.log(`مستندات تحتاج قراءة محتوى : ${docRows.length}`);
  console.log(`ملفات في الدرايف بلا سجل  : ${orphans.length}`);
  console.log(`المجموع                    : ${targets.length}\n`);

  if (!commit) {
    console.log("معاينة فقط — لم يُقرأ محتوى ولم يُكتب شيء. أضف --commit للتنفيذ.\n");
    for (const t of targets.slice(0, 15)) console.log(`  ${t.month}/${t.fileName}`);
    if (targets.length > 15) console.log(`  … و${targets.length - 15} غيرها`);
    process.exit(0);
  }

  const outcomes: Outcome[] = [];
  let done = 0;

  for (const t of targets) {
    if (done >= limit) break;
    done++;
    const label = `[${done}/${Math.min(targets.length, limit)}] ${t.fileName.slice(0, 60)}`;

    let data: Buffer;
    let mimeType: string;
    try {
      ({ data, mimeType } = await downloadFile(drive, t.driveFileId));
    } catch (e) {
      outcomes.push({ fileName: t.fileName, status: "failed", detail: `تنزيل: ${(e as Error).message}` });
      console.log(`${label} — تعذّر التنزيل`);
      continue;
    }

    const sha256 = createHash("sha256").update(data).digest("hex");

    const extraction = await extractPatiently(
      {
        data, mimeType,
        companyVat: companyConfig.vatNumber,
        companyName: companyConfig.nameAr,
        supplierNames: supplierList.map((s) => `${s.nameAr} (${s.slug})`),
      },
      label,
    );

    if (!extraction.ok) {
      outcomes.push({ fileName: t.fileName, status: "failed", detail: extraction.reason });
      console.log(`${label} — ${extraction.reason.slice(0, 70)}`);
      await wait(delayMs);
      continue;
    }

    const x = extraction.value;
    const extractedTotal = parseRiyals(x.totalAmount);
    const extractedSubtotal = parseRiyals(x.subtotalAmount);
    const extractedVat = parseRiyals(x.vatAmount);

    // المورد: مجلد الدرايف أوثق من اسم في مستند ممسوح
    const folderSupplier = t.folderName ? byFolder.get(t.folderName.trim()) : undefined;
    const matched = matchSupplier(supplierList, {
      sellerVatNumber: x.sellerVatNumber,
      supplierNameAr: x.supplierNameAr,
      supplierNameEn: x.supplierNameEn,
    });
    const supplierId = t.supplierId ?? folderSupplier?.id ?? matched.supplier?.id ?? null;
    const supplierRec = supplierList.find((s) => s.id === supplierId);

    await db.transaction(async (tx) => {
      // ١) المستند: البصمة ومخرجات النموذج الخام
      let documentId = t.documentId;
      if (documentId) {
        await tx.update(documents).set({
          sha256,
          mimeType,
          sizeBytes: data.length,
          extractionJson: x as never,
          extractionModel: extraction.model,
          fieldConfidence: x.confidence as never,
          supplierId: supplierId ?? undefined,
          updatedAt: new Date(),
        }).where(eq(documents.id, documentId));
      } else {
        const [doc] = await tx.insert(documents).values({
          driveFileId: t.driveFileId,
          fileName: t.fileName,
          mimeType,
          sizeBytes: data.length,
          sha256,
          kind: (x.documentKind === "UNKNOWN" ? "UNKNOWN" : x.documentKind) as never,
          status: "ARCHIVED",
          periodMonth: t.month,
          supplierId,
          extractionJson: x as never,
          extractionModel: extraction.model,
          fieldConfidence: x.confidence as never,
        }).returning({ id: documents.id });
        documentId = doc.id;
      }

      // ٢) الفاتورة
      const review = reviewConfirmed(
        {
          documentKind: x.documentKind,
          supplierId,
          invoiceNumber: x.invoiceNumber,
          invoiceDate: x.invoiceDate,
          subtotalMinor: extractedSubtotal,
          vatMinor: extractedVat,
          totalMinor: extractedTotal,
          sellerVat: x.sellerVatNumber,
          buyerVat: x.buyerVatNumber,
        },
        {
          companyVat: companyConfig.vatNumber,
          supplierIssuesInvoices: supplierRec?.issuesInvoices,
          supplierContractOnFile: supplierRec?.contractOnFile,
        },
      );

      let invoiceId = t.invoiceId;

      if (invoiceId) {
        const stored = t.storedTotalMinor ?? null;
        const agrees =
          extractedTotal !== null && stored !== null && Math.abs(extractedTotal - stored) <= 1;

        if (agrees && extractedSubtotal !== null && extractedVat !== null) {
          await tx.update(invoices).set({
            subtotalMinor: extractedSubtotal,
            vatMinor: extractedVat,
            sellerVat: x.sellerVatNumber || null,
            buyerVat: x.buyerVatNumber || null,
            isTaxValid: review.isTaxValid,
            inputVatEligible: review.inputVatEligible,
            isFixedAsset: review.isFixedAsset,
            updatedAt: new Date(),
          }).where(eq(invoices.id, invoiceId));
          outcomes.push({
            fileName: t.fileName, status: "updated",
            detail: `ضريبة ${formatRiyalsDisplay(extractedVat)} · ${review.isTaxValid ? "ضريبية كاملة" : "لا تصلح للخصم"}`,
          });
        } else {
          // لا نكتب المبالغ فوق ما كتبه إنسان. نسجّل الخلاف ليراجعه.
          await tx.update(invoices).set({
            sellerVat: x.sellerVatNumber || null,
            buyerVat: x.buyerVatNumber || null,
            updatedAt: new Date(),
          }).where(eq(invoices.id, invoiceId));
          outcomes.push({
            fileName: t.fileName, status: "mismatch",
            detail: `الاسم ${stored !== null ? formatRiyalsDisplay(stored) : "—"} · المحتوى ${extractedTotal !== null ? formatRiyalsDisplay(extractedTotal) : "لم يُقرأ"}`,
          });
        }
      } else if (review.canCreateInvoice && supplierId) {
        const [inv] = await tx.insert(invoices).values({
          documentId: documentId!,
          supplierId,
          invoiceNumber: x.invoiceNumber.trim(),
          invoiceDate: new Date(`${x.invoiceDate}T00:00:00Z`),
          periodMonth: t.month || x.invoiceDate.slice(0, 7),
          subtotalMinor: extractedSubtotal ?? 0,
          vatMinor: extractedVat ?? 0,
          totalMinor: extractedTotal!,
          sellerVat: x.sellerVatNumber || null,
          buyerVat: x.buyerVatNumber || null,
          isTaxValid: review.isTaxValid,
          inputVatEligible: review.inputVatEligible,
          isFixedAsset: review.isFixedAsset,
        }).onConflictDoNothing().returning({ id: invoices.id });
        invoiceId = inv?.id;
        outcomes.push({
          fileName: t.fileName,
          status: "created",
          detail: `فاتورة ${x.invoiceNumber} · ${extractedTotal !== null ? formatRiyalsDisplay(extractedTotal) : "—"}`,
        });
      } else {
        outcomes.push({
          fileName: t.fileName, status: "skipped",
          detail: `${x.documentKind} — لا تُقيَّد فاتورة`,
        });
      }

      // ٣) البنود: تُعاد كتابتها كاملةً فيبقى السكربت قابلاً للإعادة
      if (invoiceId) {
        await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
        let added = 0;
        for (const l of x.lines) {
          const description = l.description?.trim();
          if (!description) continue;
          const unit = parseRiyals(l.unitPrice ?? "");
          const total = parseRiyals(l.lineTotal ?? "");
          // السطر بلا سعر ولا مبلغ لا يُسجَّل — صفرٌ مخترع يفسد متوسط السعر
          if (unit === null && total === null) continue;

          const qty = Number((l.quantity ?? "1").replace(/[^\d.]/g, "")) || 1;
          const lineTotal = total ?? Math.round((unit ?? 0) * qty);
          const unitPrice = unit ?? (qty > 0 ? Math.round(lineTotal / qty) : lineTotal);

          await tx.insert(invoiceLines).values({
            invoiceId,
            description,
            normalizedDescription: normalizeItem(description),
            qty: String(qty),
            unitPriceMinor: unitPrice,
            lineTotalMinor: lineTotal,
            invoiceDate: x.invoiceDate ? new Date(`${x.invoiceDate}T00:00:00Z`) : null,
            supplierId,
          });
          added++;
        }
        const last = outcomes[outcomes.length - 1];
        if (last) last.linesAdded = added;
      }
    });

    const last = outcomes[outcomes.length - 1];
    console.log(`${label} — ${last.status} · ${last.detail}${last.linesAdded ? ` · ${last.linesAdded} بند` : ""}`);
    await wait(delayMs);
  }

  // ── التقرير ──
  const count = (s: Outcome["status"]) => outcomes.filter((o) => o.status === s).length;
  const lines = outcomes.reduce((n, o) => n + (o.linesAdded ?? 0), 0);

  console.log(`\n${"═".repeat(58)}`);
  console.log("  تقرير قراءة المحتوى");
  console.log("═".repeat(58));
  console.log(`\nحُدّثت فواتيرها : ${count("updated")}`);
  console.log(`أُنشئت فواتيرها : ${count("created")}`);
  console.log(`خلاف في المبلغ  : ${count("mismatch")}`);
  console.log(`لا تُقيَّد        : ${count("skipped")}`);
  console.log(`فشلت            : ${count("failed")}`);
  console.log(`بنود مسجّلة     : ${lines}`);

  const mismatches = outcomes.filter((o) => o.status === "mismatch");
  if (mismatches.length) {
    console.log(`\n── ⚠ خلاف بين المبلغ في الاسم والمبلغ في المحتوى ──`);
    console.log(`   لم يُكتب شيء فوق المبلغ الأصلي. راجعها بنفسك:`);
    for (const m of mismatches) console.log(`   ${m.fileName}\n     ${m.detail}`);
  }

  const failures = outcomes.filter((o) => o.status === "failed");
  if (failures.length) {
    console.log(`\n── ملفات لم تُقرأ ──`);
    for (const f of failures) console.log(`   ${f.fileName} — ${f.detail}`);
  }

  mkdirSync("reports", { recursive: true });
  const path = `reports/backfill-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.json`;
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), outcomes }, null, 2));
  console.log(`\nالتقرير الكامل: ${path}`);
  console.log("لم يُعدَّل ولم يُنقل ولم يُحذف أي ملف في الدرايف.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
