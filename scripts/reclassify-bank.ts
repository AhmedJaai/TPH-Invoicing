/**
 * يعيد تصنيف الحركات المخزَّنة بالمحرّك الجديد.
 *
 *   npm run db:reclassify           يعرض ولا يكتب
 *   npm run db:reclassify -- apply   ينفّذ
 *
 * ولا يمسّ حركةً ربطها إنسانٌ بدفعة: تصنيفه أوثق من استنتاج الآلة.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { toCanonical } from "../src/lib/bank/canonical";
import { classify } from "../src/lib/bank/classification";
import { toCategory } from "../src/lib/bank/apply";
import { CATEGORY_LABEL } from "../src/lib/bank/rules";

const APPLY = process.argv.includes("apply");

async function main() {
  const rows = (await db.execute<{
    id: string; description: string | null; beneficiary_raw: string | null;
    transaction_type: string | null; amount_minor: number; direction: string;
    value_date: string; category: string; matched_payment_id: string | null;
  }>(sql`
    select id, description, beneficiary_raw, transaction_type, amount_minor,
           direction::text as direction, value_date, category::text as category,
           matched_payment_id
    from bank_transactions
  `)).rows;

  const changes = new Map<string, { from: string; to: string; n: number }>();
  const updates: { id: string; category: string }[] = [];
  let skipped = 0;

  for (const r of rows) {
    if (r.matched_payment_id) { skipped++; continue; }

    const c = classify(toCanonical({
      valueDate: new Date(r.value_date),
      description: r.description,
      beneficiaryRaw: r.beneficiary_raw,
      transactionType: r.transaction_type,
      amountMinor: Number(r.amount_minor),
      direction: r.direction as "DEBIT" | "CREDIT",
    }));
    const next = toCategory(c.kind);
    if (next === r.category) continue;

    const key = `${r.category}→${next}`;
    const e = changes.get(key) ?? { from: r.category, to: next, n: 0 };
    e.n++;
    changes.set(key, e);
    updates.push({ id: r.id, category: next });
  }

  console.log(`الحركات ${rows.length} · ستتغيّر ${updates.length} · مرتبطة بدفعة فتُترَك ${skipped}\n`);
  for (const c of [...changes.values()].sort((a, b) => b.n - a.n)) {
    const L = (k: string) => CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] ?? k;
    console.log(String(c.n).padStart(5), `${L(c.from)} → ${L(c.to)}`);
  }

  if (!APPLY) {
    console.log("\nعرضٌ فقط. للتنفيذ:  npm run db:reclassify -- apply");
    process.exit(0);
  }

  const CHUNK = 400;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    await db.execute(sql`
      update bank_transactions t set category = v.category::tx_category
      from (select unnest(${sql.raw(`array[${slice.map((u) => `'${u.id}'`).join(",")}]`)}::text[]) as id,
                   unnest(${sql.raw(`array[${slice.map((u) => `'${u.category}'`).join(",")}]`)}::text[]) as category
           ) v
      where t.id = v.id
    `);
  }
  console.log(`\n✓ حُدّثت ${updates.length} حركة`);
  process.exit(0);
}
main();
