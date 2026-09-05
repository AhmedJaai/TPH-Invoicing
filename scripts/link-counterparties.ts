/**
 * يقترح ربط الجهات بالمورّدين — بدليلٍ ماليّ لا بتشابه اسم.
 *
 * هذه هي علّة شكوى أحمد: «فواتير مسدَّدة والنظام لا يعرفها». والسبب أنّ
 * الدفعات تذهب إلى **أشخاص** — سالم باحاج، ماريه بامخشب — والفواتير
 * باسم **منشآت** مسجّلة. فلا حرف مشترك، ولا ذاكرة تربطهما.
 *
 * والدليل هنا ماليّ: دفعةٌ بمبلغٍ يطابق فاتورةً مفتوحة لمورّدٍ في
 * تاريخٍ قريب. وهو أقوى من تشابه الأسماء بكثير — والاسم يخدع.
 *
 * ولا يُكتَب شيء: يُعرَض ليُقرّه أحمد.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

/** أقصى فرق أيام بين الدفعة والفاتورة يُقبَل دليلاً. */
const WINDOW_DAYS = 45;

/** أقصى فرق في المبلغ — هللة. */
const TOLERANCE = 1;

interface Suggestion {
  counterpartyId: string;
  counterpartyName: string;
  supplierId: string;
  supplierName: string;
  matches: number;
  amountMinor: number;
  samples: string[];
}

async function main() {
  const rows = (
    await db.execute<Record<string, string | number>>(sql`
      select
        cp.id            as counterparty_id,
        cp.display_name  as counterparty_name,
        s.id             as supplier_id,
        s.name_ar        as supplier_name,
        count(*)::int    as matches,
        sum(t.amount_minor)::bigint as amount,
        string_agg(
          to_char(t.value_date, 'YYYY-MM-DD') || ' · ' ||
          (t.amount_minor / 100.0)::text || ' ← فاتورة ' || coalesce(i.invoice_number, '؟'),
          ' | '
        ) as samples
      from bank_transactions t
      join counterparties cp on cp.id = t.counterparty_id
      join invoices i
        on i.supplier_id is not null
       and abs(i.total_minor - coalesce((
             select sum(pa.amount_minor)::int from payment_allocations pa
             where pa.invoice_id = i.id), 0) - t.amount_minor) <= ${TOLERANCE}
       and abs(extract(epoch from (i.invoice_date - t.value_date)) / 86400) <= ${WINDOW_DAYS}
      join suppliers s on s.id = i.supplier_id
      where cp.supplier_id is null
        and cp.kind = 'SUPPLIER'
        and t.matched_payment_id is null
      group by cp.id, cp.display_name, s.id, s.name_ar
      order by count(*) desc, sum(t.amount_minor) desc
    `)
  ).rows;

  const suggestions: Suggestion[] = rows.map((r) => ({
    counterpartyId: r.counterparty_id as string,
    counterpartyName: r.counterparty_name as string,
    supplierId: r.supplier_id as string,
    supplierName: r.supplier_name as string,
    matches: Number(r.matches),
    amountMinor: Number(r.amount),
    samples: String(r.samples).split(" | ").slice(0, 3),
  }));

  if (suggestions.length === 0) {
    console.log("لا اقتراحات: لا جهةَ بلا مورّد يطابق مبلغُ حركتها فاتورةً مفتوحة.");
    process.exit(0);
  }

  /*
    الجهة قد تطابق مورّدين: تُعرَض كلّها ولا يُختار أحدها بصمت. واختيار
    الأكثر تطابقاً تلقائياً يُنتج ربطاً خاطئاً يصعب تتبّعه.
  */
  const byParty = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const list = byParty.get(s.counterpartyId) ?? [];
    list.push(s);
    byParty.set(s.counterpartyId, list);
  }

  console.log(`اقتراحات ربط: ${byParty.size} جهة\n`);

  for (const [, list] of byParty) {
    const first = list[0];
    console.log(`▸ ${first.counterpartyName}`);
    for (const s of list) {
      const flag = list.length > 1 ? "  ⚠ يطابق أكثر من مورّد" : "";
      console.log(
        `    → ${s.supplierName.padEnd(22)} ${s.matches} مطابقة · ` +
        `${(s.amountMinor / 100).toFixed(2)} ريال${flag}`,
      );
      for (const sample of s.samples) console.log(`        ${sample}`);
    }
    console.log(`    الأمر: npm run db:link -- ${first.counterpartyId} <supplierId>`);
    console.log();
  }

  console.log("لا يُكتَب شيء تلقائياً — الربط قرارك.");
  process.exit(0);
}

main();
