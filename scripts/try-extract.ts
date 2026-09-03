import { readFileSync } from "node:fs";
import { extractDocument } from "@/lib/extraction";
import { runPipeline } from "@/lib/extraction/pipeline";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import { db } from "@/db";
import { supplierAliases, suppliers } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { companyConfig } from "@/config/drive";
import { formatRiyalsDisplay } from "@/lib/money";

async function main() {
  const file = process.argv[2];
  const data = readFileSync(file);

  const rows = await db.select({
    id: suppliers.id, slug: suppliers.slug, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn,
    driveFolderName: suppliers.driveFolderName, vatNumber: suppliers.vatNumber,
    issuesInvoices: suppliers.issuesInvoices, contractOnFile: suppliers.contractOnFile,
  }).from(suppliers).where(eq(suppliers.isActive, true));
  const aliasRows = await db.select({ supplierId: supplierAliases.supplierId, normalized: supplierAliases.normalized })
    .from(supplierAliases).where(inArray(supplierAliases.supplierId, rows.map(r => r.id)));
  const list: SupplierRecord[] = rows.map(r => ({ ...r, aliases: aliasRows.filter(a => a.supplierId === r.id) }));

  console.log(`\nالملف: ${file.split("/").pop()}\n${"─".repeat(52)}`);
  const t0 = Date.now();
  const res = await extractDocument({
    data, mimeType: "application/pdf",
    companyVat: companyConfig.vatNumber, companyName: companyConfig.nameAr,
    supplierNames: list.map(s => `${s.nameAr} (${s.slug})`),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (!res.ok) { console.log(`✕ فشل (${res.provider}): ${res.reason}\n`); process.exit(1); }

  console.log(`المزوّد: ${res.provider} · ${res.model} · ${secs} ثانية`);
  if (res.usage) console.log(`الرموز: ${res.usage.inputTokens} داخل، ${res.usage.outputTokens} خارج`);

  const x = res.value;
  console.log(`\nالمستخرج:`);
  console.log(`  النوع            ${x.documentKind}`);
  console.log(`  المورّد          ${x.supplierNameEn || x.supplierNameAr}`);
  console.log(`  ضريبي البائع     ${x.sellerVatNumber}`);
  console.log(`  ضريبي المشتري    ${x.buyerVatNumber}`);
  console.log(`  رقم الفاتورة     ${x.invoiceNumber}`);
  console.log(`  التاريخ          ${x.invoiceDate}`);
  console.log(`  قبل الضريبة      ${x.subtotalAmount}`);
  console.log(`  الضريبة          ${x.vatAmount}`);
  console.log(`  الإجمالي         ${x.totalAmount}`);
  console.log(`  البنود           ${x.lines.length}`);
  for (const l of x.lines) console.log(`     · ${l.description} — ${l.quantity} × ${l.unitPrice} = ${l.lineTotal}`);

  const match = matchSupplier(list, {
    sellerVatNumber: x.sellerVatNumber, supplierNameAr: x.supplierNameAr, supplierNameEn: x.supplierNameEn,
  });
  const r = runPipeline({
    extraction: x, match, companyVat: companyConfig.vatNumber, originalFileName: file.split("/").pop()!,
  });

  console.log(`\nالقرار:`);
  console.log(`  المورّد المطابَق   ${r.supplier?.nameAr ?? "لم يُطابَق"}  (بـ${match.method})`);
  console.log(`  الاسم الجديد      ${r.proposedFileName ?? "—"}`);
  console.log(`  المجلد            ${r.proposedFolderPath ?? "—"}`);
  console.log(`  فاتورة ضريبية     ${r.isTaxValid ? "نعم" : "لا"}`);
  console.log(`  خصم المدخلات      ${r.inputVatEligible ? "نعم" : "لا"}`);
  console.log(`  الإجمالي          ${r.totalMinor !== undefined ? formatRiyalsDisplay(r.totalMinor) : "—"} ريال`);
  console.log(`  يُسمح بالأرشفة     ${r.canArchive ? "نعم" : "لا"}`);
  if (r.findings.length) { console.log(`  التنبيهات:`); for (const f of r.findings) console.log(`     [${f.severity}] ${f.message}`); }
  console.log();
  process.exit(0);
}
main().catch(e => { console.error("خطأ:", e.message); process.exit(1); });
