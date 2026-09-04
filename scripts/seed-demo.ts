/**
 * بيانات تجريبية للتحقّق من الصفحات التحليلية.
 *
 *   npm run db:demo         يضيف بيانات وهمية
 *   npm run db:demo -- --clear   يحذفها وحدها ويترك بياناتك
 *
 * كل ما ينشئه موسوم بـ DEMO في اسم الملف، فلا يختلط ببياناتك الحقيقية.
 */
import { eq, like } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoiceLines, invoices, paymentAllocations, payments, suppliers } from "@/db/schema";
import { normalizeItem } from "@/lib/items";

const clear = process.argv.includes("--clear");
const MARK = "DEMO-";

async function wipe() {
  // الفواتير التجريبية تُعرف بوسمها في رقم الفاتورة، والدفعات المرتبطة بها
  // تُحذف عبر تخصيصاتها — لأنّ الدفعة المنشأة بلا مستند لا يطالها حذف المستند.
  const demoInvoices = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(like(invoices.invoiceNumber, `${MARK}%`));

  let payDeleted = 0;
  for (const inv of demoInvoices) {
    const allocs = await db
      .select({ paymentId: paymentAllocations.paymentId })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.invoiceId, inv.id));
    for (const a of allocs) {
      await db.delete(payments).where(eq(payments.id, a.paymentId));
      payDeleted++;
    }
  }

  const docs = await db.select({ id: documents.id }).from(documents).where(like(documents.fileName, `${MARK}%`));
  for (const d of docs) await db.delete(documents).where(eq(documents.id, d.id));

  console.log(`حُذف ${docs.length} مستنداً و${payDeleted} دفعة تجريبية.`);
}

async function main() {
  if (clear) {
    await wipe();
    process.exit(0);
  }
  await wipe();

  const all = await db.select({ id: suppliers.id, slug: suppliers.slug, folder: suppliers.driveFolderName }).from(suppliers);
  const find = (slug: string) => all.find((s) => s.slug === slug);

  const olive = find("OliveLeaves");
  const becof = find("BeCof");
  const aval = find("AVAL");
  if (!olive || !becof || !aval) {
    console.error("شغّل npm run db:seed أولاً.");
    process.exit(1);
  }

  // حليب من مورّدين بسعرين مختلفين، وبنّ ارتفع سعره
  const plan = [
    { s: olive, month: "2026-06", date: "2026-06-05", no: "260101", total: 46000, vat: 6000, valid: true,
      lines: [{ d: "حليب طازج 2 لتر", q: 40, u: 1000 }, { d: "زبدة 500 جم", q: 4, u: 1500 }] },
    { s: olive, month: "2026-07", date: "2026-07-06", no: "260202", total: 46000, vat: 6000, valid: true,
      lines: [{ d: "حليب طازج ٢ لتر", q: 40, u: 1000 }, { d: "زبدة 500 جم", q: 4, u: 1500 }] },
    { s: olive, month: "2026-08", date: "2026-08-07", no: "260302", total: 52000, vat: 6783, valid: true,
      lines: [{ d: "حليب طازج 2ل", q: 40, u: 1000 }, { d: "زبدة 500 جم", q: 8, u: 1500 }] },
    { s: becof, month: "2026-07", date: "2026-07-10", no: "BC-771", total: 40000, vat: 5217, valid: true,
      lines: [{ d: "حليب طازج 2 لتر", q: 50, u: 800 }] },
    { s: becof, month: "2026-08", date: "2026-08-12", no: "BC-812", total: 40000, vat: 5217, valid: true,
      lines: [{ d: "حليب طازج 2 لتر", q: 50, u: 800 }] },
    { s: aval, month: "2026-06", date: "2026-06-15", no: "AV-330", total: 50000, vat: 6522, valid: true,
      lines: [{ d: "بن اثيوبي 1 كجم", q: 10, u: 5000 }] },
    { s: aval, month: "2026-07", date: "2026-07-15", no: "AV-401", total: 50000, vat: 6522, valid: true,
      lines: [{ d: "بن اثيوبي 1 كيلو", q: 10, u: 5000 }] },
    // ارتفاع سعر البنّ ٢٠٪ — يجب أن يظهر في التدقيق ولوحة القيادة
    { s: aval, month: "2026-08", date: "2026-08-16", no: "AV-489", total: 60000, vat: 7826, valid: true,
      lines: [{ d: "بن اثيوبي 1 كجم", q: 10, u: 6000 }] },
    // فاتورة مبسطة تُفقد خصم المدخلات
    { s: becof, month: "2026-08", date: "2026-08-20", no: "BC-830", total: 23000, vat: 3000, valid: false,
      lines: [{ d: "أكياس ورقية", q: 20, u: 1000 }] },
  ];

  let created = 0;
  for (const p of plan) {
    const [doc] = await db.insert(documents).values({
      fileName: `${MARK}${p.date}_${p.s.slug}_Invoice_${p.no}_SAR${(p.total / 100).toFixed(2)}.pdf`,
      mimeType: "application/pdf",
      kind: p.valid ? "TAX_INVOICE" : "SIMPLIFIED_INVOICE",
      status: "ARCHIVED",
      periodMonth: p.month,
      supplierId: p.s.id,
    }).returning({ id: documents.id });

    const [inv] = await db.insert(invoices).values({
      documentId: doc.id,
      supplierId: p.s.id,
      invoiceNumber: `${MARK}${p.no}`,
      invoiceDate: new Date(`${p.date}T00:00:00Z`),
      periodMonth: p.month,
      subtotalMinor: p.total - p.vat,
      vatMinor: p.vat,
      totalMinor: p.total,
      taxStatus: p.valid ? "VALID" : "INVALID",
      inputVatStatus: p.valid ? "ELIGIBLE" : "NOT_ELIGIBLE",
    }).returning({ id: invoices.id });

    for (const l of p.lines) {
      await db.insert(invoiceLines).values({
        invoiceId: inv.id,
        description: l.d,
        normalizedDescription: normalizeItem(l.d),
        qty: String(l.q),
        unitPriceMinor: l.u,
        lineTotalMinor: l.q * l.u,
        invoiceDate: new Date(`${p.date}T00:00:00Z`),
        supplierId: p.s.id,
      });
    }

    // فواتير يونيو ويوليو مسدَّدة؛ أغسطس معلّقة
    if (p.month !== "2026-08") {
      const [pay] = await db.insert(payments).values({
        supplierId: p.s.id,
        paidAt: new Date(`${p.month}-28T00:00:00Z`),
        amountMinor: p.total,
        method: "BANK_TRANSFER",
        appliesToMonth: p.month,
      }).returning({ id: payments.id });
      await db.insert(paymentAllocations).values({
        paymentId: pay.id, invoiceId: inv.id, amountMinor: p.total,
      });
    }
    created++;
  }

  console.log(`\n✓ أُنشئت ${created} فاتورة تجريبية ببنودها.`);
  console.log(`  للحذف: npm run db:demo -- --clear\n`);
  process.exit(0);
}

main().catch((e) => { console.error("خطأ:", e); process.exit(1); });
