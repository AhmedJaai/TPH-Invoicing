/**
 * دمج مورّد مكرّر في مورّد آخر.
 *
 *   npm run db:merge -- Ganache-AGK Ganache            معاينة
 *   npm run db:merge -- Ganache-AGK Ganache --commit   تنفيذ
 *
 * الأرشيف حمل للمورّد الواحد صيغتَي اسم، فأنشأ الترحيل صفّين. والصفّان
 * يقسمان بياناته: كشفه هنا وفواتيره هناك، فتُعلن مطابقة الكشف أنّ عشر
 * فواتير «ناقصة» وهي عندنا تحت الصيغة الأخرى.
 *
 * لا يحذف الصفّ المكرّر بل يُعطّله — فما أُسند إليه سابقاً يبقى مفهوماً،
 * ولا تُكسر أي إشارة إليه.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  documents, invoiceLines, invoices, payments, statements, supplierAliases, suppliers,
} from "@/db/schema";

const commit = process.argv.includes("--commit");
const [fromSlug, toSlug] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function main() {
  if (!fromSlug || !toSlug) {
    console.error("الاستعمال: npm run db:merge -- <المكرّر> <الباقي> [--commit]");
    process.exit(1);
  }

  const rows = await db
    .select({ id: suppliers.id, slug: suppliers.slug, nameAr: suppliers.nameAr })
    .from(suppliers)
    .where(sql`${suppliers.slug} in (${fromSlug}, ${toSlug})`);

  const from = rows.find((r) => r.slug === fromSlug);
  const to = rows.find((r) => r.slug === toSlug);

  if (!from || !to) {
    console.error(`لم يوجد: ${!from ? fromSlug : toSlug}`);
    process.exit(1);
  }
  if (from.id === to.id) {
    console.error("المورّدان واحد");
    process.exit(1);
  }

  const counts = await db
    .select({
      docs: sql<number>`(select count(*)::int from documents where supplier_id = ${from.id})`,
      inv: sql<number>`(select count(*)::int from invoices where supplier_id = ${from.id})`,
      lines: sql<number>`(select count(*)::int from invoice_lines where supplier_id = ${from.id})`,
      stmt: sql<number>`(select count(*)::int from statements where supplier_id = ${from.id})`,
      pay: sql<number>`(select count(*)::int from payments where supplier_id = ${from.id})`,
      alias: sql<number>`(select count(*)::int from supplier_aliases where supplier_id = ${from.id})`,
    })
    .from(suppliers)
    .limit(1);

  const c = counts[0];
  console.log(`\n${from.nameAr} (${from.slug})  →  ${to.nameAr} (${to.slug})\n`);
  console.log(`  مستندات : ${c.docs}`);
  console.log(`  فواتير  : ${c.inv}`);
  console.log(`  بنود    : ${c.lines}`);
  console.log(`  كشوف    : ${c.stmt}`);
  console.log(`  مدفوعات : ${c.pay}`);
  console.log(`  أسماء   : ${c.alias}\n`);

  if (!commit) {
    console.log("معاينة فقط — أضف --commit للتنفيذ.\n");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    await tx.update(documents).set({ supplierId: to.id }).where(eq(documents.supplierId, from.id));
    await tx.update(invoices).set({ supplierId: to.id }).where(eq(invoices.supplierId, from.id));
    await tx.update(invoiceLines).set({ supplierId: to.id }).where(eq(invoiceLines.supplierId, from.id));
    await tx.update(statements).set({ supplierId: to.id }).where(eq(statements.supplierId, from.id));
    await tx.update(payments).set({ supplierId: to.id }).where(eq(payments.supplierId, from.id));

    // الاسم البديل قد يكون مسجّلاً عند الباقي أصلاً — الفهرس الفريد يمنع تكراره
    const moving = await tx
      .select({ id: supplierAliases.id, normalized: supplierAliases.normalized, kind: supplierAliases.kind })
      .from(supplierAliases)
      .where(eq(supplierAliases.supplierId, from.id));

    for (const a of moving) {
      const dup = await tx
        .select({ id: supplierAliases.id })
        .from(supplierAliases)
        .where(and(
          eq(supplierAliases.supplierId, to.id),
          eq(supplierAliases.normalized, a.normalized),
          eq(supplierAliases.kind, a.kind),
        ))
        .limit(1);

      if (dup.length > 0) await tx.delete(supplierAliases).where(eq(supplierAliases.id, a.id));
      else await tx.update(supplierAliases).set({ supplierId: to.id }).where(eq(supplierAliases.id, a.id));
    }

    // لا يُحذف بل يُعطَّل، فيبقى أثره مفهوماً ولا تُكسر إشارة إليه
    await tx.update(suppliers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(suppliers.id, from.id));
  });

  console.log(`✓ دُمج ${from.slug} في ${to.slug}، وعُطّل الصفّ المكرّر ولم يُحذف.\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
