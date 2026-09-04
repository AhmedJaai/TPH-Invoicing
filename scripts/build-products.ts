/**
 * بناء أصناف المورّدين من بنود الفواتير.
 *
 *   npm run db:products
 *
 * لا يربط أصناف مورّدين مختلفين بصنف معياري واحد — ذلك قرار إنسان،
 * ودرس «العنب» أنّ الاسم الواحد قد يخفي شيئين. هنا يُبنى ما يخصّ كل
 * مورّد بوصفه هو، وتُعرض المرشّحات للربط.
 */
import { buildSupplierProducts, listSupplierProducts, mappingCoverage } from "@/services/product.service";
import { suggestMerges, type SupplierItem } from "@/lib/products";
import { formatRiyalsDisplay } from "@/lib/money";

async function main() {
  const result = await buildSupplierProducts();
  console.log(`\nأصناف مورّدين أُنشئت : ${result.created}`);
  console.log(`موجودة مسبقاً        : ${result.existing}`);
  console.log(`بنود رُبطت           : ${result.linkedLines}`);

  const rows = await listSupplierProducts();
  const items: SupplierItem[] = rows.map((r) => ({
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    normalized: r.normalized,
    displayName: r.displayName,
    lastUnitPriceMinor: r.lastUnitPriceMinor,
    orderCount: r.orderCount,
  }));

  const merges = suggestMerges(items);
  const cov = await mappingCoverage();

  console.log(`\nربط بصنف معياري      : ${cov.mapped} من ${cov.total}`);
  console.log(`مرشّحات للجمع        : ${merges.length}\n`);

  for (const m of merges.slice(0, 15)) {
    const mark = m.strength === "STRONG" ? "✓" : "⚠";
    console.log(`  ${mark} «${m.normalized}»`);
    for (const i of m.items) {
      console.log(`      ${i.supplierName.padEnd(20)} ${formatRiyalsDisplay(i.lastUnitPriceMinor).padStart(10)}  ${i.displayName.slice(0, 38)}`);
    }
    for (const c of m.caveats) console.log(`      ← ${c}`);
  }
  if (merges.length > 15) console.log(`\n  … و${merges.length - 15} غيرها`);

  console.log(`\nالربط يُؤكَّد من صفحة الأصناف — لا يقع آلياً.\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
