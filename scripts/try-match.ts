import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankRules, invoices, paymentAllocations, supplierAliases, suppliers } from "@/db/schema";
import { parseBankStatement } from "@/lib/bank/parse";
import { matchBankTransactions, findDuplicatePayments, type BankTx, type OpenInvoice, type SupplierAliasIndex } from "@/lib/bank/match";
import { CATEGORY_LABEL, type BankRule, type TxCategory } from "@/lib/bank/rules";
import { normalizeName } from "@/lib/suppliers-seed";
import { formatRiyalsDisplay } from "@/lib/money";

async function main() {
  const parsed = parseBankStatement(readFileSync(process.argv[2]));
  const txs: BankTx[] = parsed.rows.map((r, i) => ({
    id: `t${i}`, valueDate: r.valueDate, description: r.description,
    transactionType: r.transactionType, amountMinor: r.amountMinor, direction: r.direction,
  }));

  const sup = await db.select({
    id: suppliers.id, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn, folder: suppliers.driveFolderName,
  }).from(suppliers).where(eq(suppliers.isActive, true));
  const aliases = await db.select({ supplierId: supplierAliases.supplierId, value: supplierAliases.value })
    .from(supplierAliases).where(inArray(supplierAliases.supplierId, sup.map(s => s.id)));

  const index: SupplierAliasIndex[] = sup.map(s => ({
    supplierId: s.id, supplierName: s.nameAr,
    normalizedNames: [...new Set([s.nameAr, s.nameEn ?? "", s.folder,
      ...aliases.filter(a => a.supplierId === s.id).map(a => a.value)]
      .filter(Boolean).map(normalizeName))],
  }));

  const invRows = await db.select({
    invoiceId: invoices.id, supplierId: invoices.supplierId, supplierName: suppliers.nameAr,
    invoiceNumber: invoices.invoiceNumber, invoiceDate: invoices.invoiceDate,
    periodMonth: invoices.periodMonth, totalMinor: invoices.totalMinor,
    allocated: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}),0)::int`,
  }).from(invoices).leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(paymentAllocations, eq(paymentAllocations.invoiceId, invoices.id))
    .groupBy(invoices.id, suppliers.nameAr);

  const open: OpenInvoice[] = invRows.map(r => ({
    invoiceId: r.invoiceId, supplierId: r.supplierId, supplierName: r.supplierName ?? "—",
    invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate, periodMonth: r.periodMonth,
    outstandingMinor: r.totalMinor - Number(r.allocated),
  })).filter(i => i.outstandingMinor > 0);

  const rules: BankRule[] = await db
    .select({
      id: bankRules.id, normalized: bankRules.normalized,
      category: bankRules.category, supplierId: bankRules.supplierId,
    })
    .from(bankRules);
  console.log(`قواعد تصنيف مسجَّلة: ${rules.length}`);

  const matches = matchBankTransactions(txs, open, index, rules);

  const byCat = new Map<TxCategory, { n: number; sum: number }>();
  for (const m of matches) {
    const e = byCat.get(m.category) ?? { n: 0, sum: 0 };
    e.n++; e.sum += m.tx.amountMinor;
    byCat.set(m.category, e);
  }
  console.log(`\n── الحركات حسب تصنيفها ──`);
  for (const [c, v] of [...byCat].sort((a, b) => b[1].sum - a[1].sum))
    console.log(`  ${CATEGORY_LABEL[c].padEnd(24)} ${String(v.n).padStart(5)}  ${formatRiyalsDisplay(v.sum).padStart(13)}`);
  const real = matches.filter(m => m.kind !== "INTERNAL");
  const exact = real.filter(m => m.kind === "EXACT_INVOICE" || m.kind === "INVOICE_GROUP");
  const supOnly = real.filter(m => m.kind === "SUPPLIER_ONLY");
  const none = real.filter(m => m.kind === "NONE");
  const matchedInvoices = new Set(exact.flatMap(m => m.invoices.map(i => i.invoiceId)));

  console.log(`\n${"═".repeat(58)}`);
  console.log(`  مطابقة كشف البنك`);
  console.log(`${"═".repeat(58)}\n`);
  console.log(`  حركات الكشف          : ${txs.length}`);
  console.log(`  تشغيلية (نقاط بيع…)  : ${matches.length - real.length}`);
  console.log(`  مدفوعات محتملة       : ${real.length}`);
  console.log(`\n  ✓ طوبقت بفواتير      : ${exact.length}  (${matchedInvoices.size} فاتورة)`);
  console.log(`  ~ عُرف المورّد فقط    : ${supOnly.length}`);
  console.log(`  ✕ مجهولة              : ${none.length}`);
  console.log(`\n  فواتير مفتوحة قبل    : ${open.length}`);
  console.log(`  تبقى مفتوحة بعد      : ${open.length - matchedInvoices.size}`);

  console.log(`\n── عيّنة مطابقات ناجحة ──`);
  for (const m of exact.slice(0, 10)) {
    console.log(`  ${m.tx.valueDate.toISOString().slice(0,10)}  ${formatRiyalsDisplay(m.tx.amountMinor).padStart(10)}  ${(m.supplierName ?? "").padEnd(22)} ${m.invoices.length} فاتورة`);
  }

  console.log(`\n── أكبر الحركات المجهولة ──`);
  for (const m of none.sort((a,b)=>b.tx.amountMinor-a.tx.amountMinor).slice(0, 8)) {
    console.log(`  ${formatRiyalsDisplay(m.tx.amountMinor).padStart(11)}  ${m.tx.description.slice(0, 58)}`);
  }

  const dups = findDuplicatePayments(txs);
  console.log(`\n── مدفوعات يُشتبه بتكرارها: ${dups.length} ──`);
  for (const g of dups.slice(0, 5)) {
    console.log(`  ${g[0].valueDate.toISOString().slice(0,10)}  ${formatRiyalsDisplay(g[0].amountMinor)}  ×${g.length}  ${g[0].description.slice(0,40)}`);
  }
  console.log();
  process.exit(0);
}
main().catch(e => { console.error("خطأ:", e.message); process.exit(1); });
