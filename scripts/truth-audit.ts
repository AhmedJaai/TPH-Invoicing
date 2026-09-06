/**
 * تدقيق الحقيقة: الأصل في الدرايف مقابل القيد في القاعدة.
 *
 *   npm run ops:truth
 *
 * **قراءةٌ محضة.** لا يحذف ولا ينقل ولا يعيد تسمية شيئاً في الدرايف،
 * ولا يعدّل صفّاً في القاعدة. يقول ما وجد، ويترك القرار لصاحبه.
 *
 * والحكم في `lib/ops/truth-audit.ts` دوالَّ خالصة؛ وهذا يجلب الطرفين.
 */
import { writeFileSync } from "node:fs";
import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents, invoices, suppliers } from "@/db/schema";
import { driveForCli, isFolder, listChildren, type DriveFile } from "@/lib/drive";
import { parseFileName } from "@/lib/naming";
import { driveConfig, SERVICE_FOLDER_NAMES } from "@/config/drive";
import { KNOWN_SLUGS } from "@/lib/suppliers-seed";
import {
  VERDICT_LABEL, auditTruth, isClean, summarize,
  type ArchiveFile, type DbRecord, type TruthVerdict,
} from "@/lib/ops/truth-audit";

const MARK: Record<TruthVerdict, string> = {
  VERIFIED: "✓", CORRECTED: "✕", DUPLICATE: "✕", MISSING: "✕", AMBIGUOUS: "؟",
};

/** يمشي على الأرشيف كلّه — مجلّداتِ السنة فالشهر فالمورّد. */
async function walkArchive(
  drive: Awaited<ReturnType<typeof driveForCli>>,
  rootId: string,
  depth = 0,
): Promise<DriveFile[]> {
  if (depth > 4) return [];
  const children = await listChildren(drive, rootId);
  const out: DriveFile[] = [];

  for (const child of children) {
    if (SERVICE_FOLDER_NAMES.includes(child.name)) continue;
    if (isFolder(child)) out.push(...(await walkArchive(drive, child.id, depth + 1)));
    else out.push(child);
  }
  return out;
}

async function main() {
  console.log("\n═══════════ تدقيق الحقيقة ═══════════");
  console.log("  (قراءةٌ محضة — لا يُمَسّ الأرشيف ولا القاعدة)\n");

  /* ── الطرف الأوّل: الأرشيف ── */
  const drive = await driveForCli(async () => {
    const [a] = await db
      .select({ token: accounts.refresh_token })
      .from(accounts)
      .where(eq(accounts.provider, "google"))
      .limit(1);
    return a?.token ?? null;
  });

  const files = await walkArchive(drive, driveConfig.accountsFolderId);
  console.log(`  الأرشيف: ${files.length} ملفّاً\n`);

  const archive: ArchiveFile[] = files.map((f) => {
    const parsed = parseFileName(f.name, KNOWN_SLUGS);
    const value = parsed.ok ? parsed.value : null;
    return {
      driveId: f.id,
      fileName: f.name,
      supplierSlug: value?.slug ?? null,
      periodMonth: value?.date ? value.date.slice(0, 7) : null,
      invoiceNumber: value?.invoiceNumber ?? null,
      totalMinor: value?.amountMinor ?? null,
    };
  });

  /* ── الطرف الثاني: القاعدة ── */
  const rows = await db
    .select({
      documentId: documents.id,
      driveId: documents.driveFileId,
      fileName: documents.fileName,
      supplierSlug: suppliers.slug,
      periodMonth: documents.periodMonth,
      invoiceNumber: invoices.invoiceNumber,
      totalMinor: invoices.totalMinor,
      hasInvoice: sql<boolean>`${invoices.id} is not null`,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .where(isNotNull(documents.fileName));

  const records: DbRecord[] = rows.map((r) => ({
    documentId: r.documentId,
    driveId: r.driveId,
    fileName: r.fileName,
    supplierSlug: r.supplierSlug,
    periodMonth: r.periodMonth,
    invoiceNumber: r.invoiceNumber,
    totalMinor: r.totalMinor,
    hasInvoice: Boolean(r.hasInvoice),
  }));

  console.log(`  القاعدة: ${records.length} قيداً\n`);

  /* ── المقابلة ── */
  const findings = auditTruth(archive, records);
  const counts = summarize(findings);

  console.log("───────────────────────────────────\n");
  for (const [verdict, n] of Object.entries(counts)) {
    const v = verdict as TruthVerdict;
    console.log(`  ${MARK[v]} ${VERDICT_LABEL[v].padEnd(16)} ${n}`);
  }

  /* والمشكل يُعرَض بنصّه — لا عدّاداً وحده */
  const problems = findings.filter((f) => f.verdict !== "VERIFIED");
  if (problems.length > 0) {
    console.log("\n───────────────────────────────────\n");
    for (const f of problems.slice(0, 40)) {
      console.log(`  ${MARK[f.verdict]} ${f.label.slice(0, 70)}`);
      console.log(`      ${f.detail}`);
      if (f.suggestion) console.log(`      → ${f.suggestion}`);
      console.log("");
    }
    if (problems.length > 40) console.log(`  وأخرى: ${problems.length - 40}\n`);
  }

  const out = "truth-audit.json";
  writeFileSync(out, JSON.stringify({ counts, findings }, null, 2), "utf8");
  console.log(`───────────────────────────────────\n`);
  console.log(`  التفصيل كاملاً في ${out}`);
  console.log(`  الحكم: ${isClean(counts) ? "نقيّة" : "تحتاج مراجعة"}\n`);

  /*
    و«لا يُقطَع فيه» لا تمنع: الجهل ليس خطأً. والذي يمنع قيدٌ يخالف
    أصله، أو قيدان لأصلٍ واحد، أو قيدٌ بلا أصل.
  */
  process.exit(isClean(counts) ? 0 : 1);
}

main().catch((e) => { console.error("\n✕", e.message, "\n"); process.exit(1); });
