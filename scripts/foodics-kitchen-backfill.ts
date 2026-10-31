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

/**
 * اتّصالٌ ينقطع (شبكةُ جوّال، مهلةُ Neon) يُعاد عليه أربع مرّات بمهلةٍ تتضاعف؛ ثمّ يُقال
 * سطراً واحداً — كان يطبع آلافَ المعاملات ويقف، ولا يُعرف أين.
 */
async function withRetry<T>(what: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      const cause = (e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message.split("\n")[0];
      if (attempt >= 4) {
        console.error(`\n✕ تعذّر الاتّصال بالقاعدة (${what}): ${cause.slice(0, 160)}`);
        console.error("  ما كُتب قبله محفوظ. أعد تشغيل الأمر نفسه، فيكمل من حيث وقف.");
        process.exit(1);
      }
      console.log(`  … انقطع الاتّصال (${what})، محاولة ${attempt + 1} بعد ${2 ** attempt} ثوانٍ`);
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
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
  let read = 0, updated = 0, withKitchen = 0, wasted = 0, skipped = 0;
  for (let start = from; start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6) < to ? addDays(start, 6) : to;
    /*
      يكمل من حيث وقف: أسبوعٌ قُرئت طلباتُه كلُّها (`wasted_lines` غيرُ فارغ) لا يُقرأ ثانيةً.
      انقطع الاتّصالُ مرّةً عند أسبوع ٧–١٣ يوليو، فكان التشغيلُ التالي يبدأ من مايو.
    */
    const [left] = (await withRetry(`فحص ${start}`, () => db.execute<{ n: number }>(sql`
      select count(*)::int as n from foodics_orders where business_date between ${start} and ${end} and wasted_lines is null`))).rows;
    if ((left?.n ?? 0) === 0) { skipped++; console.log(`${start} → ${end}: مكتمل من قبل`); continue; }
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
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200);
      const values = sql.join(part.map((r) => sql`(${r.id}, ${r.kitchenReceivedAt?.toISOString() ?? null}::timestamptz, ${r.kitchenDoneAt?.toISOString() ?? null}::timestamptz, ${r.wastedLines}::int)`), sql`, `);
      const res = await withRetry(`كتابة ${start}`, () => db.execute(sql`
        update foodics_orders o
           set kitchen_received_at = v.received, kitchen_done_at = v.done, wasted_lines = v.wasted
          from (values ${values}) as v(id, received, done, wasted)
         where o.id = v.id`));
      updated += res.rowCount ?? 0;
    }
    withKitchen += rows.filter((r) => r.kitchenDoneAt !== null).length;
    wasted += rows.reduce((s, r) => s + r.wastedLines, 0);
    console.log(`${start} → ${end}: ${rows.length} طلباً`);
  }
  console.log(`\nقُرئ ${read} طلباً، وحُدّث ${updated} في المرآة. بأوقات تحضير: ${withKitchen}. أسطرٌ هُدرت مكوّناتها: ${wasted}. أسابيع مكتملة من قبل: ${skipped}.`);
  process.exit(0);
}

void main();
