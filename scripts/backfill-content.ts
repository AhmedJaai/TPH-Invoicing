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
import { TAX_STATUS_LABEL } from "@/lib/validation";
import { normalizeItem } from "@/lib/items";
import { reconcileInvoiceLines, resolveLinePricing } from "@/lib/line-pricing";
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
 * قائمة نماذج تُجرَّب بالترتيب.
 *
 * حصّة الطبقة المجانية **يومية لكل نموذج على حدة**: عشرون طلباً في اليوم
 * لـgemini-3.8-flash. فقراءة مئة وخمسين ملفاً على نموذج واحد تحتاج أسبوعاً.
 * ولمّا كانت الحصص منفصلة، فالانتقال من نموذج نفدت حصّته إلى غيره يجمع
 * الحصص كلّها في شوط واحد.
 *
 * والأصغر أوّلاً عن قصد: حصّته أوسع، وخطؤه لا يفسد مالاً لأنّ السكربت لا
 * يكتب مبلغاً فوق ما كتبه إنسان — يسجّل الخلاف ويترك القرار له.
 */
const MODELS: string[] = (
  process.env.GEMINI_MODELS ??
  [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-flash-latest",
  ].join(",")
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

let modelIndex = 0;

/** يُستعمَل للخروج المنظّم حين تنفد حصص اليوم كلّها. */
class AllModelsExhausted extends Error {}

function selectModel(i: number) {
  modelIndex = i;
  process.env.GEMINI_MODEL = MODELS[i];
}

/**
 * قراءة ملف مع صبر ثم انتقال.
 *
 * تنتظر مرّة واحدة تجدّد الدقيقة — فقد يكون الحدّ لحظياً — فإن بقي الرفض
 * فالحدّ يومي، والانتظار حينئذٍ عبث. فتنتقل إلى النموذج التالي.
 */
async function extractPatiently(
  request: Parameters<typeof extractDocument>[0],
  label: string,
): Promise<Awaited<ReturnType<typeof extractDocument>>> {
  for (let i = modelIndex; i < MODELS.length; i++) {
    selectModel(i);

    let outcome = await extractDocument(request);
    if (outcome.ok || !isQuotaProblem(outcome.reason)) return outcome;

    console.log(`${label} — ${MODELS[i]} مضغوط، ننتظر ٤٠ ثانية…`);
    await wait(40_000);

    outcome = await extractDocument(request);
    if (outcome.ok || !isQuotaProblem(outcome.reason)) return outcome;

    if (i + 1 < MODELS.length) {
      console.log(`${label} — نفدت حصّة ${MODELS[i]} اليومية، ننتقل إلى ${MODELS[i + 1]}`);
    }
  }

  throw new AllModelsExhausted(
    `نفدت حصّة اليوم في كل النماذج المتاحة (${MODELS.join("، ")}).`,
  );
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
  console.log(`قارئ الفواتير: ${activeProviderName()} — ${MODELS.length} نموذجاً بالتناوب`);
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
  const { entries: orphans } = await walkArchive(drive, { knownFileIds: knownIds });
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

    let extraction: Awaited<ReturnType<typeof extractDocument>>;
    try {
      extraction = await extractPatiently(
        {
          data, mimeType,
          companyVat: companyConfig.vatNumber,
          companyName: companyConfig.nameAr,
          supplierNames: supplierList.map((s) => `${s.nameAr} (${s.slug})`),
        },
        label,
      );
    } catch (e) {
      if (e instanceof AllModelsExhausted) {
        console.log(`\n⏸  ${e.message}`);
        console.log("   ما قُرئ محفوظ. أعد تشغيل الأمر نفسه غداً ليكمل من حيث وقف.\n");
        break;
      }
      throw e;
    }

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
        // المستند قد يكون مبسّطاً بلا تفصيل ضريبي — وهذا ليس خلافاً في المبلغ
        const hasBreakdown = extractedSubtotal !== null && extractedVat !== null;

        if (agrees && hasBreakdown) {
          await tx.update(invoices).set({
            subtotalMinor: extractedSubtotal,
            vatMinor: extractedVat,
            sellerVat: x.sellerVatNumber || null,
            buyerVat: x.buyerVatNumber || null,
            taxStatus: review.taxStatus,
            inputVatStatus: review.inputVatStatus,
            isFixedAsset: review.isFixedAsset,
            updatedAt: new Date(),
          }).where(eq(invoices.id, invoiceId));
          outcomes.push({
            fileName: t.fileName, status: "updated",
            detail: `ضريبة ${formatRiyalsDisplay(extractedVat)} · ${TAX_STATUS_LABEL[review.taxStatus]}`,
          });
        } else if (agrees) {
          // المبلغ متطابق ولا تفصيل ضريبي في المستند — فاتورة مبسّطة غالباً
          await tx.update(invoices).set({
            subtotalMinor: extractedSubtotal ?? extractedTotal!,
            vatMinor: extractedVat ?? 0,
            sellerVat: x.sellerVatNumber || null,
            buyerVat: x.buyerVatNumber || null,
            taxStatus: review.taxStatus,
            inputVatStatus: review.inputVatStatus,
            isFixedAsset: review.isFixedAsset,
            updatedAt: new Date(),
          }).where(eq(invoices.id, invoiceId));
          outcomes.push({
            fileName: t.fileName, status: "updated",
            detail: "بلا تفصيل ضريبي في المستند — لا تصلح للخصم",
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
      } else if (t.documentId) {
        /*
         * مستند من الأرشيف بلا صفّ فاتورة: معناه أنّ اسم الملف لم يحمل رقماً.
         * ولا نأخذ الرقم من النموذج هنا — رأيناه يخترع «TPH-20260521» ويعطيه
         * ثقة ١٫٠ كاملة. فالثقة لا تحرس من الاختراع، والرقم المخترع في نظام
         * محاسبي أسوأ من غيابه. يُترك ليُدخله إنسان.
         */
        // الكشف وعرض السعر لا يُقيَّدان أصلاً، فرسالتهما غير رسالة الفاتورة
        const isInvoiceKind = ["TAX_INVOICE", "SIMPLIFIED_INVOICE"].includes(x.documentKind);
        outcomes.push({
          fileName: t.fileName,
          status: "skipped",
          detail: isInvoiceKind
            ? "فاتورة بلا رقم في اسم الملف — أدخل الرقم يدوياً ليُقيَّد"
            : `${x.documentKind} — لا يُقيَّد فاتورة`,
        });
      } else if (review.canCreateInvoice && supplierId) {
        const [inv] = await tx.insert(invoices).values({
          documentId: documentId!,
          supplierId,
          invoiceNumber: x.invoiceNumber.trim(),
          invoiceDate: new Date(`${x.invoiceDate}T00:00:00Z`),
          periodMonth: t.month || x.invoiceDate.slice(0, 7),
          // الفراغ يبقى فراغاً — المجهول لا يصير صفراً
          subtotalMinor: extractedSubtotal,
          vatMinor: extractedVat,
          totalMinor: extractedTotal!,
          sellerVat: x.sellerVatNumber || null,
          buyerVat: x.buyerVatNumber || null,
          taxStatus: review.taxStatus,
          inputVatStatus: review.inputVatStatus,
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
        const resolved: (NonNullable<ReturnType<typeof resolveLinePricing>> & {
          description: string; quantity: number;
        })[] = [];

        for (const l of x.lines) {
          const description = l.description?.trim();
          if (!description) continue;
          const qty = Number((l.quantity ?? "1").replace(/[^\d.]/g, "")) || 1;
          // السطر بلا سعر ولا مبلغ لا يُسجَّل — صفرٌ مخترع يفسد متوسط السعر
          const pricing = resolveLinePricing({
            quantity: qty,
            unitPriceMinor: parseRiyals(l.unitPrice ?? ""),
            lineTotalMinor: parseRiyals(l.lineTotal ?? ""),
          });
          if (!pricing) continue;
          resolved.push({ ...pricing, description, quantity: qty });
        }

        // تُسوّى بصافي الفاتورة — بعض المورّدين يكتب البنود شاملة الضريبة
        const { lines: finalLines } = reconcileInvoiceLines(
          resolved,
          extractedSubtotal ?? t.storedTotalMinor ?? null,
        );

        for (const l of finalLines) {
          await tx.insert(invoiceLines).values({
            invoiceId,
            description: l.description,
            normalizedDescription: normalizeItem(l.description),
            qty: String(l.quantity),
            unitPriceMinor: l.effectiveUnitMinor,
            lineTotalMinor: l.netTotalMinor,
            listUnitPriceMinor: l.listUnitMinor,
            discountMinor: l.discountMinor,
            pricingBasis: l.basis,
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
    console.log(
      `${label} — ${last.status} · ${last.detail}` +
        `${last.linesAdded ? ` · ${last.linesAdded} بند` : ""} · ${MODELS[modelIndex]}`,
    );
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
  console.log(`آخر نموذج       : ${MODELS[modelIndex]}`);

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
