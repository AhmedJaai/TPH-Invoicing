/**
 * «ETH 1kg» — كيسُ إثيوبي كيلو، بيع منه ٣ على House Account يوم ٨ نوفمبر ٢٠٢٦ ولم يُربط بصنف،
 * فلم يخرج من مخزون Ethiopia guji (نقصُ جرد ٨–١٤ نوفمبر −٣٬٤٥٣ جراماً). بإذن أحمد (١٥ نوفمبر):
 *
 *   ١. يُعاد فتح جرد ٨–١٤ نوفمبر بسببٍ مكتوب (الوصفةُ في أسبوعٍ مقفل تُرفض).
 *   ٢. يُربط «ETH 1kg» بصنف قائمةٍ جديدٍ باسمه.
 *   ٣. وصفتُه ١٠٠٠ جرام Ethiopia guji، تسري من ٨ نوفمبر.
 *   ٤. يُعاد حسابُ الجرد ويُقفل من جديد.
 *
 * بخدمات التطبيق نفسها (الأثرُ في سجلّ التدقيق باسم المالك). ومرّتين = مرّة: ما وقع لا يُعاد.
 *
 *   npx tsx --env-file=.env scripts/fix-eth-1kg-house-account.ts                              ← يعرض
 *   npx tsx --env-file=.env scripts/fix-eth-1kg-house-account.ts --i-know-this-is-production  ← ينفّذ
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { finaliseCount, recomputeCount, reopenCount } from "@/services/inventory.service";
import { mapPosProducts } from "@/services/pos-mapping.service";
import { saveRecipeVersion } from "@/services/recipe.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const WEEK = { start: "2026-11-08", end: "2026-11-14" };


async function ethiopiaLine(countId: string) {
  return (await db.execute<{ used: string; expected: string; actual: string; diff: string }>(sql`
    select l.theoretical_consumption_milli as used, l.theoretical_closing_milli as expected, l.actual_milli as actual, l.variance_milli as diff
      from inventory_count_lines l join products p on p.id = l.product_id
     where l.count_id = ${countId} and p.name_ar = 'Ethiopia guji'
  `)).rows[0];
}

async function main() {
  const owner = (await db.execute<{ id: string; name: string | null }>(sql`select id, name from users where role = 'OWNER' and is_active order by created_at limit 1`)).rows[0];
  const pos = (await db.execute<{ id: string; product_id: string | null }>(sql`select id, product_id from pos_products where name = 'ETH 1kg'`)).rows[0];
  const eth = (await db.execute<{ id: string; base_unit: string }>(sql`select id, base_unit from products where name_ar = 'Ethiopia guji' and is_stock_item`)).rows[0];
  const count = (await db.execute<{ id: string; status: string }>(sql`
    select id, status from inventory_counts where period_start = ${WEEK.start} and period_end = ${WEEK.end} and branch_id is not null
  `)).rows[0];
  if (!owner || !pos || !eth || !count) throw new Error(`ناقص: مالك ${!!owner} · ETH 1kg ${!!pos} · Ethiopia guji ${!!eth} · جرد ${!!count}`);
  const before = await ethiopiaLine(count.id);
  console.log(`المالك: ${owner.name} · جرد ${WEEK.start}→${WEEK.end} (${count.id.slice(0, 8)}) ${count.status} · ETH 1kg ${pos.product_id ? "مربوط" : "غير مربوط"} · Ethiopia guji بوحدة ${eth.base_unit}`);
  console.log(`الإثيوبي قبل: استهلاك ${Number(before?.used) / 1000} · متوقّع ${Number(before?.expected) / 1000} · وُجد ${Number(before?.actual) / 1000} · فرق ${Number(before?.diff) / 1000} (جرام)`);
  if (eth.base_unit !== "G") throw new Error("وحدةُ Ethiopia guji ليست الجرام — الوصفةُ تُكتب بالجرام، فتوقّف.");
  const recipeBefore = pos.product_id ? (await db.execute<{ n: number }>(sql`select count(*)::int as n from recipes where product_id = ${pos.product_id}`)).rows[0] : undefined;
  const alreadyDone = !!pos.product_id && !!recipeBefore?.n;
  /* مرّتين = مرّة: الربطُ والوصفةُ قائمان والجردُ مقفل — لا يُعاد فتحُه */
  if (alreadyDone && count.status === "FINALISED") { console.log("الربطُ والوصفةُ قائمان والجردُ مقفل — لا شيء يُصلَح."); return; }
  if (!WRITE) {
    console.log("\nسيُعاد فتح الجرد، ويُربط ETH 1kg، وتُكتب وصفةُ ١٠٠٠ جرام، ثمّ يُقفل. لم يُكتب شيء — أعِد الأمر مع --i-know-this-is-production");
    return;
  }

  if (count.status === "FINALISED") {
    await reopenCount(count.id, "بيعُ ٣ أكياس «ETH 1kg» على House Account يوم ٨ نوفمبر لم يُربط بصنف فلم يُحسب استهلاكاً — يُربط بوصفة ١٠٠٠ جرام إثيوبي ويُعاد الإقفال (بإذن أحمد)", owner.id);
    console.log("← أُعيد فتح الجرد");
  }
  let menuId = pos.product_id;
  if (!menuId) {
    const m = await mapPosProducts({ posProductIds: [pos.id], newProductName: "ETH 1kg", category: "COFFEE", actorId: owner.id });
    menuId = m.productId;
    console.log(`← رُبط ETH 1kg بـ«${m.productName}»${m.createdProduct ? " (صنف جديد)" : ""}`);
  }
  const hasRecipe = (await db.execute<{ n: number }>(sql`select count(*)::int as n from recipes where product_id = ${menuId}`)).rows[0];
  if (!hasRecipe?.n) {
    const r = await saveRecipeVersion({
      menuProductId: menuId, effectiveFrom: WEEK.start, yieldQuantityMilli: null, yieldUnit: null,
      note: "كيسُ إثيوبي كيلو يُباع كما هو", activate: true, actorId: owner.id,
      ingredients: [{ productId: eth.id, quantityMilli: 1_000_000, unit: "G", prepLossBp: null, note: null }],
    });
    console.log(`← وصفةُ ETH 1kg: النسخة ${r.version}${r.activated ? " سارية" : " مسودة"}`);
  }
  await recomputeCount(count.id);
  const after = await ethiopiaLine(count.id);
  console.log(`الإثيوبي بعد: استهلاك ${Number(after?.used) / 1000} · متوقّع ${Number(after?.expected) / 1000} · وُجد ${Number(after?.actual) / 1000} · فرق ${Number(after?.diff) / 1000} (جرام)`);
  if (!alreadyDone && Number(after?.used) - Number(before?.used) !== 3_000_000) {
    console.log("✕ لم يزد الاستهلاكُ ٣٠٠٠ جرام بالضبط — لم يُقفل الجرد، فراجعه بيدك.");
    return;
  }
  await finaliseCount(count.id, owner.id);
  console.log("← أُقفل الجرد من جديد");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
