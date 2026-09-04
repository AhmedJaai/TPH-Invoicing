/**
 * إعادة حساب أسعار البنود المسجَّلة، فاتورةً فاتورة.
 *
 *   npm run db:reprice            معاينة
 *   npm run db:reprice -- --commit
 *
 * خطوتان: تسوية كل سطر على حدة (خصم أو ضريبة داخل السطر)، ثم تسوية البنود
 * كلّها بصافي فاتورتها — فالسطر وحده لا يُعرف أصافٍ هو أم شامل للضريبة،
 * ومجموع البنود مقابل صافي الفاتورة يحسم الأمر بلا تخمين.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, invoices, suppliers } from "@/db/schema";
import { reconcileInvoiceLines, resolveLinePricing } from "@/lib/line-pricing";
import { formatRiyalsDisplay } from "@/lib/money";

const commit = process.argv.includes("--commit");

async function main() {
  const rows = await db
    .select({
      id: invoiceLines.id,
      invoiceId: invoiceLines.invoiceId,
      description: invoiceLines.description,
      qty: invoiceLines.qty,
      unitPriceMinor: invoiceLines.unitPriceMinor,
      lineTotalMinor: invoiceLines.lineTotalMinor,
      listUnitPriceMinor: invoiceLines.listUnitPriceMinor,
      subtotalMinor: invoices.subtotalMinor,
      invoiceNumber: invoices.invoiceNumber,
      supplierName: suppliers.nameAr,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .leftJoin(suppliers, eq(suppliers.id, invoiceLines.supplierId));

  const byInvoice = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byInvoice.get(r.invoiceId) ?? [];
    list.push(r);
    byInvoice.set(r.invoiceId, list);
  }

  const verdicts = new Map<string, number>();
  const bases = new Map<string, number>();
  const changes: string[] = [];

  for (const [, list] of byInvoice) {
    const resolved = list.map((r) => {
      const qty = Number(r.qty) || 1;
      /*
       * المصدر: سعر القائمة إن حُفظ، وإلّا فالسعر المخزَّن. فإعادة التشغيل
       * يجب أن تنطلق من القراءة الأصلية لا من نتيجة تسوية سابقة، وإلّا
       * قسمنا على ١٫١٥ مرّتين.
       */
      const sourceUnit = r.listUnitPriceMinor ?? r.unitPriceMinor;
      const p = resolveLinePricing({
        quantity: qty,
        unitPriceMinor: sourceUnit,
        lineTotalMinor: r.lineTotalMinor,
      })!;
      return { ...p, row: r, quantity: qty };
    });

    const { lines, verdict } = reconcileInvoiceLines(resolved, list[0].subtotalMinor);
    verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + 1);

    for (const l of lines) {
      bases.set(l.basis, (bases.get(l.basis) ?? 0) + 1);
      const r = l.row;

      if (l.effectiveUnitMinor !== r.unitPriceMinor || l.netTotalMinor !== r.lineTotalMinor) {
        changes.push(
          `  ${String(r.supplierName ?? "—").slice(0, 13).padEnd(15)} ${String(r.description).slice(0, 30).padEnd(32)} ` +
            `${formatRiyalsDisplay(r.unitPriceMinor).padStart(10)} → ${formatRiyalsDisplay(l.effectiveUnitMinor).padStart(10)}  [${verdict}]`,
        );
      }

      if (commit) {
        await db
          .update(invoiceLines)
          .set({
            unitPriceMinor: l.effectiveUnitMinor,
            lineTotalMinor: l.netTotalMinor,
            listUnitPriceMinor: l.listUnitMinor,
            discountMinor: l.discountMinor,
            pricingBasis: l.basis,
          })
          .where(eq(invoiceLines.id, r.id));
      }
    }
  }

  console.log(`\nفواتير ذات بنود: ${byInvoice.size}   بنود: ${rows.length}`);
  console.log(`\nتسوية الفاتورة بصافيها:`);
  for (const [v, n] of [...verdicts].sort((a, b) => b[1] - a[1])) console.log(`  ${v.padEnd(20)} ${n}`);
  console.log(`\nأساس السطر:`);
  for (const [b, n] of [...bases].sort((a, b) => b[1] - a[1])) console.log(`  ${b.padEnd(20)} ${n}`);
  console.log(`\nسعرها تغيّر: ${changes.length}`);
  for (const c of changes.slice(0, 20)) console.log(c);
  if (changes.length > 20) console.log(`  … و${changes.length - 20} غيرها`);
  console.log(commit ? "\n✓ حُدّثت.\n" : "\nمعاينة فقط — أضف --commit.\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
