/**
 * ترحيل الأرشيف القائم إلى قاعدة البيانات.
 *
 *   npm run drive:migrate -- --dry     معاينة بلا كتابة (الافتراضي)
 *   npm run drive:migrate -- --commit  الكتابة فعلاً
 *
 * لا يعدّل ولا ينقل ولا يعيد تسمية أي ملف في الدرايف — قراءة فقط منه،
 * وكتابة في قاعدة البيانات وحدها. ويربط كل سجل بملفه عبر driveFileId.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents, invoices, payments, statements, suppliers, supplierAliases } from "@/db/schema";
import { driveForCli, isFolder, listChildren, type DriveFile } from "@/lib/drive";
import { parseFileName, type ParsedFileName } from "@/lib/naming";
import { driveConfig, SUPPLIER_INFO_CARD } from "@/config/drive";
import { formatRiyalsDisplay } from "@/lib/money";
import { KNOWN_SLUGS, normalizeName } from "@/lib/suppliers-seed";

/** يقرأ تفويض الدرايف من أول مستخدم سجّل دخوله. */
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

const MONTH_RE = /^\d{4}-\d{2}$/;
const commit = process.argv.includes("--commit");

interface Row {
  month: string;
  folderName: string;
  file: DriveFile;
  parsed?: ParsedFileName;
  problem?: string;
}

const KIND_TO_DOCUMENT: Record<string, string> = {
  INVOICE: "TAX_INVOICE",
  STATEMENT: "STATEMENT",
  RECEIPT: "RECEIPT",
  CASH: "CASH_RECEIPT",
  PROFORMA: "PROFORMA",
  QUOTATION: "QUOTATION",
  LEDGER: "STATEMENT",
  // فاتورة صادرة منّا لا واردة إلينا — تُحفظ ولا تدخل المشتريات
  SALES_INVOICE: "UNKNOWN",
};

async function collect(): Promise<Row[]> {
  const drive = await storedDrive();
  const rows: Row[] = [];

  for (const [year, yearFolderId] of Object.entries(driveConfig.yearFolderIds)) {
    let months: DriveFile[];
    try {
      months = await listChildren(drive, yearFolderId);
    } catch (e) {
      console.error(`تعذّر قراءة سنة ${year}: ${(e as Error).message}`);
      continue;
    }

    for (const month of months.filter(isFolder)) {
      if (!MONTH_RE.test(month.name)) continue;
      for (const folder of (await listChildren(drive, month.id)).filter(isFolder)) {
        for (const file of await listChildren(drive, folder.id)) {
          if (isFolder(file) || file.name === SUPPLIER_INFO_CARD) continue;
          const result = parseFileName(file.name, KNOWN_SLUGS);
          rows.push({
            month: month.name,
            folderName: folder.name,
            file,
            parsed: result.ok ? result.value : undefined,
            problem: result.ok ? undefined : result.reason,
          });
        }
      }
    }
  }
  return rows;
}

async function main() {
  console.log(`\nوضع التشغيل: ${commit ? "كتابة فعلية" : "معاينة فقط (أضف --commit للكتابة)"}\n`);

  const rows = await collect();
  const parsed = rows.filter((r) => r.parsed);
  const failed = rows.filter((r) => !r.parsed);

  const supplierRows = await db
    .select({ id: suppliers.id, slug: suppliers.slug, folder: suppliers.driveFolderName })
    .from(suppliers);
  const bySlug = new Map(supplierRows.map((s) => [s.slug, s]));

  const existing = new Set(
    (await db.select({ driveFileId: documents.driveFileId }).from(documents))
      .map((d) => d.driveFileId)
      .filter((v): v is string => Boolean(v)),
  );

  let created = 0;
  let skipped = 0;
  let invoicesCreated = 0;
  let statementsCreated = 0;
  let paymentsCreated = 0;
  const learnedAliases = new Map<string, Set<string>>();
  const needsAttention: string[] = [];

  for (const row of parsed) {
    const p = row.parsed!;
    if (row.file.id && existing.has(row.file.id)) {
      skipped++;
      continue;
    }

    const supplier = p.slug ? bySlug.get(p.slug) : undefined;
    if (p.slug && !supplier) {
      needsAttention.push(`${row.month}/${row.file.name} — المورد ${p.slug} غير مسجّل`);
    }
    if (p.amountMinor === undefined) {
      needsAttention.push(`${row.month}/${row.file.name} — لا مبلغ في الاسم، سُجّل كمستند بلا قيد`);
    }
    if (p.monthOnly) {
      needsAttention.push(`${row.month}/${row.file.name} — الاسم يحمل الشهر بلا يوم`);
    }
    if (p.kind === "INVOICE" && !p.invoiceNumber) {
      needsAttention.push(`${row.month}/${row.file.name} — فاتورة بلا رقم في الاسم`);
    }
    if (p.kind === "SALES_INVOICE") {
      needsAttention.push(`${row.month}/${row.file.name} — فاتورة صادرة منّا، لا تدخل المشتريات`);
    }

    // أسماء المستفيدين البنكية هدية مجانية من أسماء ملفات الإيصالات
    if (p.kind === "RECEIPT" && p.beneficiary && p.slug) {
      const set = learnedAliases.get(p.slug) ?? new Set<string>();
      set.add(p.beneficiary);
      learnedAliases.set(p.slug, set);
    }

    if (!commit) {
      created++;
      continue;
    }

    const date = new Date(`${p.date}T00:00:00Z`);
    await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          driveFileId: row.file.id,
          driveFolderId: row.file.parents?.[0] ?? null,
          fileName: row.file.name,
          mimeType: row.file.mimeType,
          sizeBytes: row.file.size ?? null,
          kind: KIND_TO_DOCUMENT[p.kind] as never,
          status: "ARCHIVED",
          periodMonth: row.month,
          supplierId: supplier?.id ?? null,
        })
        .returning({ id: documents.id });
      created++;

      if (p.kind === "INVOICE" && supplier && p.invoiceNumber && p.amountMinor !== undefined) {
        await tx
          .insert(invoices)
          .values({
            documentId: doc.id,
            supplierId: supplier.id,
            invoiceNumber: p.invoiceNumber,
            invoiceDate: date,
            periodMonth: row.month,
            // الأرشيف يحمل الإجمالي وحده؛ التفصيل الضريبي يأتي بإعادة القراءة لاحقاً
            subtotalMinor: 0,
            vatMinor: 0,
            totalMinor: p.amountMinor,
          })
          .onConflictDoNothing();
        invoicesCreated++;
      }

      if ((p.kind === "STATEMENT" || p.kind === "LEDGER") && supplier && p.amountMinor !== undefined) {
        const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
        await tx.insert(statements).values({
          documentId: doc.id,
          supplierId: supplier.id,
          periodStart: start,
          periodEnd: date,
          closingBalanceMinor: p.amountMinor,
        });
        statementsCreated++;
      }

      if ((p.kind === "RECEIPT" || p.kind === "CASH") && p.amountMinor !== undefined) {
        await tx.insert(payments).values({
          documentId: doc.id,
          supplierId: supplier?.id ?? null,
          paidAt: date,
          amountMinor: p.amountMinor,
          method: p.kind === "CASH" ? "CASH" : "BANK_TRANSFER",
          beneficiaryNameRaw: p.beneficiary ?? null,
          appliesToMonth: row.month,
        });
        paymentsCreated++;
      }
    });
  }

  // ── الأسماء البديلة المستخلصة ──
  let aliasesAdded = 0;
  if (commit) {
    for (const [slug, names] of learnedAliases) {
      const supplier = bySlug.get(slug);
      if (!supplier) continue;
      for (const value of names) {
        const res = await db
          .insert(supplierAliases)
          .values({
            supplierId: supplier.id,
            value,
            normalized: normalizeName(value),
            kind: "BANK_BENEFICIARY",
            source: "MIGRATION",
          })
          .onConflictDoNothing()
          .returning({ id: supplierAliases.id });
        if (res.length > 0) aliasesAdded++;
      }
    }
  }

  // ── التقرير ──
  const totalMinor = parsed.reduce((sum, r) => sum + (r.parsed!.amountMinor ?? 0), 0);
  console.log("═".repeat(58));
  console.log("  تقرير الترحيل");
  console.log("═".repeat(58));
  console.log(`\nملفات في الأرشيف        : ${rows.length}`);
  console.log(`فُهم اسمها               : ${parsed.length}`);
  console.log(`تحتاج تدخلاً يدوياً       : ${failed.length}`);
  console.log(`سُجّلت في قاعدة البيانات : ${created}`);
  console.log(`موجودة مسبقاً فتُخطّت    : ${skipped}`);
  if (commit) {
    console.log(`\n  فواتير  : ${invoicesCreated}`);
    console.log(`  كشوف    : ${statementsCreated}`);
    console.log(`  مدفوعات : ${paymentsCreated}`);
    console.log(`  أسماء بديلة مستخلصة: ${aliasesAdded}`);
  }
  console.log(`\nمجموع المبالغ المقروءة  : ${formatRiyalsDisplay(totalMinor)} ريال`);

  if (learnedAliases.size > 0) {
    console.log(`\n── أسماء المستفيدين المستخلصة من ملفات الإيصالات ──`);
    for (const [slug, names] of [...learnedAliases].sort()) {
      console.log(`  ${slug.padEnd(18)} ← ${[...names].join("، ")}`);
    }
  }

  if (needsAttention.length > 0) {
    console.log(`\n── ⚠ تحتاج انتباهك ──`);
    for (const line of needsAttention.slice(0, 30)) console.log(`  ${line}`);
    if (needsAttention.length > 30) console.log(`  … و${needsAttention.length - 30} غيرها`);
  }

  if (failed.length > 0) {
    console.log(`\n── ⚠ ملفات لم يُفهم اسمها ──`);
    for (const r of failed) console.log(`  ${r.month}/${r.folderName}/${r.file.name} — ${r.problem}`);
  }

  mkdirSync("reports", { recursive: true });
  const path = `reports/migration-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
  writeFileSync(
    path,
    JSON.stringify(
      {
        mode: commit ? "commit" : "dry-run",
        generatedAt: new Date().toISOString(),
        totals: { files: rows.length, parsed: parsed.length, failed: failed.length, created, skipped },
        learnedAliases: Object.fromEntries([...learnedAliases].map(([k, v]) => [k, [...v]])),
        needsAttention,
        failures: failed.map((r) => ({ path: `${r.month}/${r.folderName}/${r.file.name}`, reason: r.problem })),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\nالتقرير الكامل: ${path}`);
  console.log(`لم يُعدَّل ولم يُنقل ولم يُحذف أي ملف في الدرايف.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\nخطأ:", e.message);
  process.exit(1);
});
