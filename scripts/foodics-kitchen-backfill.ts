/**
 * تعبئةُ أوقات شاشة التحضير وجوابِ الكاشير عن المرتجَع (٠٩٣) لما قُرئ قبلها.
 *
 *   npm run foodics:kitchen-backfill -- --from 2026-05-05 --to 2026-10-31 --i-know-this-is-production
 *
 * المزامنةُ الجارية تكتب الأعمدةَ الثلاثة لكلّ طلبٍ تقرؤه؛ وما قُرئ قبل الهجرة لا يُعاد
 * (`updated_after`). فهذا يقرأ الطلباتِ أسبوعاً أسبوعاً بـ`GET` وحده، ويكتب **الأعمدةَ
 * الثلاثة وحدها** لطلبٍ موجودٍ في المرآة — لا مالَ ولا مبيعاتٍ ولا دفعات. ومرّتان
 * تعطيان النتيجةَ نفسها.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fetchAll } from "@/lib/foodics/client";
import { mirrorOrder } from "@/lib/foodics/orders";
import { FoodicsOrder } from "@/lib/foodics/types";
import { addDays } from "@/lib/riyadh-time";
import { assertWriteAllowed } from "./lib/guard-write";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  assertWriteAllowed("تعبئةُ أوقات التحضير");
  const from = arg("--from");
  const to = arg("--to");
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.error("حدّد --from و--to بصيغة YYYY-MM-DD");
    process.exit(1);
  }
  console.log(`الوجهة: ${new URL(process.env.DATABASE_URL ?? "postgres://?").host}`);
  let read = 0, updated = 0, withKitchen = 0, wasted = 0;
  for (let start = from; start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6) < to ? addDays(start, 6) : to;
    /* حدّا فودكس حصريّان — يوماً قبل ويوماً بعد */
    const { items } = await fetchAll("orders", FoodicsOrder, {
      "filter[business_date_after]": addDays(start, -1),
      "filter[business_date_before]": addDays(end, 1),
      include: "products",
    });
    const rows = items.flatMap((o) => {
      const m = mirrorOrder(o);
      return m ? [m.order] : [];
    });
    read += rows.length;
    /* دفعةً واحدة للأسبوع: `update … from (values …)` — لا صفّاً صفّاً */
    for (let i = 0; i < rows.length; i += 400) {
      const part = rows.slice(i, i + 400);
      const values = sql.join(part.map((r) => sql`(${r.id}, ${r.kitchenReceivedAt?.toISOString() ?? null}::timestamptz, ${r.kitchenDoneAt?.toISOString() ?? null}::timestamptz, ${r.wastedLines}::int)`), sql`, `);
      const res = await db.execute(sql`
        update foodics_orders o
           set kitchen_received_at = v.received, kitchen_done_at = v.done, wasted_lines = v.wasted
          from (values ${values}) as v(id, received, done, wasted)
         where o.id = v.id`);
      updated += res.rowCount ?? 0;
    }
    withKitchen += rows.filter((r) => r.kitchenDoneAt !== null).length;
    wasted += rows.reduce((s, r) => s + r.wastedLines, 0);
    console.log(`${start} → ${end}: ${rows.length} طلباً`);
  }
  console.log(`\nقُرئ ${read} طلباً، وحُدّث ${updated} في المرآة. بأوقات تحضير: ${withKitchen}. أسطرٌ هُدرت مكوّناتها: ${wasted}.`);
  process.exit(0);
}

void main();
