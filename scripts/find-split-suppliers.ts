/**
 * يكشف المورّد الواحد المسجَّل مرّتين.
 *
 * وهذه علّةٌ حقيقية وجدناها: دفعةُ ١١٬٦٠٠ نُسبت إلى «سرد كو»،
 * والفاتورةُ بنفس المبلغ ونفس اليوم مسجَّلة على «سرد للتجارة — معدات».
 * فالمحرّك يقول «مورّد معروف بلا فاتورة مفتوحة» وهو محقّ — لأنّ
 * الفاتورة عند مورّدٍ آخر في القاعدة، وهو نفسه في الواقع.
 *
 * والكشف بدليلين لا بتشابه اسمٍ وحده:
 *   ١. تشابه الاسم بعد التوحيد.
 *   ٢. **دفعةٌ لأحدهما تطابق فاتورةً للآخر** مبلغاً وتاريخاً.
 *
 * والثاني أقوى: الاسم قد يتشابه بين مورّدين حقيقيّين، أمّا أن تطابق
 * دفعةُ هذا فاتورةَ ذاك في اليوم نفسه فدليلٌ ماليّ.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

async function main() {
  const rows = (
    await db.execute<Record<string, string | number>>(sql`
      select
        ts.id            as pay_supplier_id,
        ts.name_ar       as pay_supplier,
        isup.id          as inv_supplier_id,
        isup.name_ar     as inv_supplier,
        count(*)::int    as hits,
        sum(t.amount_minor)::bigint as amount,
        string_agg(
          to_char(t.value_date,'YYYY-MM-DD') || ' · ' ||
          (t.amount_minor/100.0)::text || ' ← ' || coalesce(i.invoice_number,'؟'),
          ' | '
        ) as samples
      from bank_transactions t
      join suppliers ts on ts.id = t.supplier_id
      join invoices i
        on i.supplier_id <> t.supplier_id
       and abs(i.total_minor - coalesce((select sum(pa.amount_minor)::int
             from payment_allocations pa where pa.invoice_id = i.id), 0) - t.amount_minor) <= 1
       and abs(extract(epoch from (i.invoice_date - t.value_date)) / 86400) <= 7
      join suppliers isup on isup.id = i.supplier_id
      where t.matched_payment_id is null and t.direction = 'DEBIT'
      group by ts.id, ts.name_ar, isup.id, isup.name_ar
      order by count(*) desc, sum(t.amount_minor) desc
    `)
  ).rows;

  if (rows.length === 0) {
    console.log("لا مورّد يبدو مسجّلاً مرّتين بدليلٍ ماليّ.");
    process.exit(0);
  }

  console.log(`مورّدون يبدو أنّهم واحد: ${rows.length}\n`);
  for (const r of rows) {
    console.log(`▸ «${r.pay_supplier}»  ⟷  «${r.inv_supplier}»`);
    console.log(`    ${r.hits} مطابقة · ${(Number(r.amount) / 100).toFixed(2)} ريال`);
    for (const s of String(r.samples).split(" | ").slice(0, 3)) {
      console.log(`      ${s}`);
    }
    console.log(`    الدمج: npm run db:merge -- ${r.inv_supplier_id} ${r.pay_supplier_id}`);
    console.log();
  }
  console.log("لا يُدمَج شيء تلقائياً — الدمج قرارك، والمورّد المدموج يُعطَّل ولا يُحذف.");
  process.exit(0);
}
main();
