/**
 * يؤسّس سجل الموردين في قاعدة البيانات من الملف المرجعي.
 *
 *   npm run db:seed
 *
 * قابل لإعادة التشغيل بلا ضرر: يحدّث الموجود ولا يكرّره، ولا يحذف شيئاً.
 * ولا يمسّ الدرايف إطلاقاً — هذا السكربت لا يتصل به أصلاً.
 */
import { db } from "@/db";
import { suppliers, supplierAliases } from "@/db/schema";
import { SUPPLIER_SEED, normalizeName } from "@/lib/suppliers-seed";
import { eq } from "drizzle-orm";

async function main() {
  let created = 0;
  let updated = 0;
  let aliasesAdded = 0;

  for (const seed of SUPPLIER_SEED) {
    const [row] = await db
      .insert(suppliers)
      .values({
        slug: seed.slug,
        driveFolderName: seed.driveFolderName,
        nameAr: seed.nameAr,
        nameEn: seed.nameEn,
        category: seed.category,
        issuesInvoices: seed.issuesInvoices ?? true,
      })
      .onConflictDoUpdate({
        target: suppliers.slug,
        set: {
          driveFolderName: seed.driveFolderName,
          nameAr: seed.nameAr,
          nameEn: seed.nameEn,
          category: seed.category,
          issuesInvoices: seed.issuesInvoices ?? true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: suppliers.id, createdAt: suppliers.createdAt });

    const isNew = Date.now() - new Date(row.createdAt).getTime() < 5_000;
    if (isNew) created++;
    else updated++;

    // اسم المجلد نفسه اسمٌ بديل صالح للمطابقة
    const aliases: { value: string; kind: "FOLDER" | "BANK_BENEFICIARY" | "NAME_VARIANT" }[] = [
      { value: seed.driveFolderName, kind: "FOLDER" },
      { value: seed.nameAr, kind: "NAME_VARIANT" },
      ...(seed.nameEn ? [{ value: seed.nameEn, kind: "NAME_VARIANT" as const }] : []),
      ...(seed.bankAliases ?? []).map((v) => ({ value: v, kind: "BANK_BENEFICIARY" as const })),
    ];

    for (const alias of aliases) {
      const res = await db
        .insert(supplierAliases)
        .values({
          supplierId: row.id,
          value: alias.value,
          normalized: normalizeName(alias.value),
          kind: alias.kind,
          source: "MIGRATION",
        })
        .onConflictDoNothing()
        .returning({ id: supplierAliases.id });
      if (res.length > 0) aliasesAdded++;
    }
  }

  const total = await db.select({ id: suppliers.id }).from(suppliers);
  const withoutInvoices = await db
    .select({ slug: suppliers.slug })
    .from(suppliers)
    .where(eq(suppliers.issuesInvoices, false));

  console.log(`\n✓ تأسيس سجل الموردين`);
  console.log(`  مورد جديد     : ${created}`);
  console.log(`  مورد محدَّث    : ${updated}`);
  console.log(`  اسم بديل مضاف : ${aliasesAdded}`);
  console.log(`  الإجمالي      : ${total.length} مورداً`);
  console.log(`\n  موردون بلا فواتير يحتاجون عقد توريد: ${withoutInvoices.map((s) => s.slug).join("، ")}`);
  console.log(`\n  لم يُمسّ الدرايف.\n`);
  process.exit(0);
}

main().catch((e) => { console.error("خطأ:", e); process.exit(1); });
