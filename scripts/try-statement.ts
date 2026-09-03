/** يجرّب مطابقة كشف مورّد مؤرشف: يقرأ محتواه ويقابله بفواتيرنا. لا يكتب شيئاً. */
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents, invoices, statements, suppliers } from "@/db/schema";
import { driveForCli, downloadFile } from "@/lib/drive";
import { extractDocument } from "@/lib/extraction";
import { reconcileStatement, buildDiscrepancyMemo, type StatementLineInput } from "@/lib/statement-match";
import { parseRiyals, formatRiyalsDisplay } from "@/lib/money";
import { companyConfig } from "@/config/drive";

async function main() {
  const wanted = process.argv[2];

  const rows = await db
    .select({
      id: statements.id,
      supplierId: statements.supplierId,
      supplierName: suppliers.nameAr,
      periodStart: statements.periodStart,
      periodEnd: statements.periodEnd,
      driveFileId: documents.driveFileId,
      fileName: documents.fileName,
    })
    .from(statements)
    .leftJoin(suppliers, eq(statements.supplierId, suppliers.id))
    .innerJoin(documents, eq(documents.id, statements.documentId));

  const row = wanted
    ? rows.find((r) => r.fileName.includes(wanted) || r.supplierName?.includes(wanted))
    : rows[0];

  if (!row?.driveFileId) {
    console.log("الكشوف المتاحة:");
    for (const r of rows) console.log(`  ${r.supplierName} — ${r.fileName}`);
    process.exit(1);
  }

  console.log(`\nالكشف: ${row.fileName}`);
  console.log(`المورّد: ${row.supplierName}`);
  console.log(`الفترة: ${row.periodStart.toISOString().slice(0,10)} → ${row.periodEnd.toISOString().slice(0,10)}\n`);

  const drive = await driveForCli(async () => {
    const [a] = await db.select({ token: accounts.refresh_token }).from(accounts)
      .where(eq(accounts.provider, "google")).limit(1);
    return a?.token ?? null;
  });

  const { data, mimeType } = await downloadFile(drive, row.driveFileId);
  console.log(`نُزّل ${(data.length / 1024).toFixed(0)} ك.بايت — يقرأ…\n`);

  const supplierNames = (await db.select({ nameAr: suppliers.nameAr, slug: suppliers.slug }).from(suppliers))
    .map((s) => `${s.nameAr} (${s.slug})`);

  const out = await extractDocument({
    data, mimeType,
    companyVat: companyConfig.vatNumber,
    companyName: companyConfig.nameAr,
    supplierNames,
  });

  if (!out.ok) { console.log("فشل:", out.reason); process.exit(1); }
  const x = out.value;

  console.log(`النوع: ${x.documentKind}`);
  console.log(`سطور استخرجها النموذج: ${x.statementLines.length}`);
  console.log(`الرصيد الافتتاحي: ${x.openingBalance || "—"}   الختامي: ${x.closingBalance || "—"}\n`);

  const lines: StatementLineInput[] = [];
  for (const l of x.statementLines) {
    const debit = parseRiyals(l.debit ?? "") ?? 0;
    const credit = parseRiyals(l.credit ?? "") ?? 0;
    if (debit === 0 && credit === 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date)) continue;
    lines.push({ date: new Date(`${l.date}T00:00:00Z`), ref: l.ref, description: l.description, debitMinor: debit, creditMinor: credit });
  }
  console.log(`سطور صالحة: ${lines.length}\n`);
  for (const l of lines.slice(0, 6)) {
    console.log(`  ${l.date.toISOString().slice(0,10)}  ${(l.ref || l.description || "—").slice(0,34).padEnd(36)} مدين ${formatRiyalsDisplay(l.debitMinor).padStart(10)}  دائن ${formatRiyalsDisplay(l.creditMinor).padStart(10)}`);
  }
  if (lines.length > 6) console.log(`  … و${lines.length - 6} غيرها`);

  // الفترة من سطور الكشف نفسها — الكشف يغطّي ما تغطّيه سطوره لا ما يقوله اسمه
  const times = lines.map((l) => l.date.getTime());
  const start = new Date(Math.min(...times));
  const end = new Date(Math.max(...times));
  console.log(`\nالفترة الفعلية من سطوره: ${start.toISOString().slice(0,10)} → ${end.toISOString().slice(0,10)}`);

  const ours = await db.select({
    invoiceId: invoices.id, invoiceNumber: invoices.invoiceNumber,
    invoiceDate: invoices.invoiceDate, totalMinor: invoices.totalMinor,
  }).from(invoices).where(and(
    eq(invoices.supplierId, row.supplierId),
    // نافذة أوسع بأسبوع: تاريخ المورّد للحركة ليس تاريخ فاتورتنا
    gte(invoices.invoiceDate, new Date(start.getTime() - 7 * 86_400_000)),
    lte(invoices.invoiceDate, new Date(end.getTime() + 7 * 86_400_000)),
  ));

  const r = reconcileStatement(lines, ours, {
    openingBalanceMinor: parseRiyals(x.openingBalance ?? "") ?? 0,
    closingBalanceMinor: parseRiyals(x.closingBalance ?? "") ?? undefined,
  });

  console.log(`\n${"═".repeat(56)}`);
  console.log(`فواتيرنا في الفترة : ${ours.length}`);
  console.log(`طوبقت              : ${r.matchedCount}`);
  console.log(`حمّلها ولا ملف لها : ${r.missingFromArchive.length}`);
  console.log(`فروق مبالغ         : ${r.amountMismatches.length}`);
  console.log(`عندنا ولم ترد عنده : ${r.notInStatement.length}`);
  console.log(`ما حمّله           : ${formatRiyalsDisplay(r.theirBilledMinor)}`);
  console.log(`ما لدينا           : ${formatRiyalsDisplay(r.ourBilledMinor)}`);
  console.log(`الفرق              : ${formatRiyalsDisplay(r.billedDifferenceMinor)}`);
  console.log(`حساب كشفه مستقيم؟  : ${r.balanceArithmeticOk === null ? "لم يُفحص" : r.balanceArithmeticOk ? "نعم" : "لا"}`);

  if (r.missingFromArchive.length) {
    console.log(`\n── فواتير حمّلها ولا ملف لها عندنا ──`);
    for (const l of r.missingFromArchive)
      console.log(`   ${l.line.date.toISOString().slice(0,10)}  ${(l.line.ref || l.line.description || "—").slice(0,40)}  ${formatRiyalsDisplay(l.line.debitMinor)}`);
  }
  if (r.amountMismatches.length) {
    console.log(`\n── فروق ──`);
    for (const l of r.amountMismatches)
      console.log(`   ${l.invoice!.invoiceNumber}: عنده ${formatRiyalsDisplay(l.line.debitMinor)} · عندنا ${formatRiyalsDisplay(l.invoice!.totalMinor)}`);
  }

  console.log(`\n── المذكّرة ──\n`);
  console.log(buildDiscrepancyMemo(row.supplierName ?? "المورّد", `${start.toISOString().slice(0,10)} إلى ${end.toISOString().slice(0,10)}`, r));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
