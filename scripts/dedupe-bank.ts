/**
 * يزيل تكرار حركات البنك الناتج عن اختلاف صيغة التصدير.
 *
 * سببه أنّ رقم الحساب كان جزءاً من بصمة الحركة، وهو خاصّية ملفٍ لا
 * خاصّية حركة: كشفان لنفس الحساب، أحدهما يحمل رقمه والآخر لا، فاختلفت
 * بصمتا حركة واحدة بعينها ودخلت مرّتين.
 *
 * البصمة أُصلحت في `identity.ts`، وهذا يعالج ما دخل قبل الإصلاح.
 *
 *   npm run db:dedupe          يعرض ولا يحذف
 *   npm run db:dedupe -- apply  ينفّذ
 *
 * والأقدم يبقى والأحدث يُحذف، فلا تنكسر إحالةٌ إلى حركة قديمة. وما
 * كان مرتبطاً بدفعة يبقى مهما كان ترتيبه.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const APPLY = process.argv.includes("apply");

async function main() {
  const before = (await db.execute<{ n: number }>(sql`
    select count(*)::int as n from bank_transactions
  `)).rows[0];

  /*
    المجموعة: نفس التاريخ والمبلغ والاتجاه والوصف الموحَّد.
    ويُحتفظ بالأقدم — والمرتبط بدفعة يُقدَّم على غيره مهما كان تاريخه،
    لأنّ حذفه يقطع إثبات سداد.
  */
  const plan = (await db.execute<{ groups: number; extra: number; s: string }>(sql`
    with ranked as (
      select t.id, t.amount_minor, t.matched_payment_id,
             row_number() over (
               partition by t.value_date, t.amount_minor, t.direction,
                            upper(regexp_replace(coalesce(t.description,''), '\\s+', ' ', 'g'))
               order by (t.matched_payment_id is null), i.created_at, t.id
             ) as rn
      from bank_transactions t
      join bank_imports i on i.id = t.bank_import_id
    )
    select count(distinct 1)::int                       as groups,
           count(*)::int                                as extra,
           coalesce(sum(amount_minor),0)::bigint        as s
    from ranked where rn > 1
  `)).rows[0];

  const withPayment = (await db.execute<{ n: number }>(sql`
    with ranked as (
      select t.matched_payment_id,
             row_number() over (
               partition by t.value_date, t.amount_minor, t.direction,
                            upper(regexp_replace(coalesce(t.description,''), '\\s+', ' ', 'g'))
               order by (t.matched_payment_id is null), i.created_at, t.id
             ) as rn
      from bank_transactions t
      join bank_imports i on i.id = t.bank_import_id
    )
    select count(*)::int as n from ranked where rn > 1 and matched_payment_id is not null
  `)).rows[0];

  console.log(`الحركات الآن           ${before.n}`);
  console.log(`الزائدة                ${plan.extra}`);
  console.log(`مبلغها المكرّر         ${(Number(plan.s) / 100).toFixed(2)} ريال`);
  console.log(`منها مرتبطة بدفعة      ${withPayment.n}  ${withPayment.n > 0 ? "⚠ تُفحص يدوياً" : "(لا شيء)"}`);
  console.log(`ستبقى                  ${before.n - plan.extra}`);

  if (!APPLY) {
    console.log("\nعرضٌ فقط. للتنفيذ:  npm run db:dedupe -- apply");
    process.exit(0);
  }

  if (withPayment.n > 0) {
    console.log("\n✕ توقّف: بعض المكرّر مرتبط بدفعات. راجعها قبل الحذف.");
    process.exit(1);
  }

  const res = await db.execute(sql`
    with ranked as (
      select t.id,
             row_number() over (
               partition by t.value_date, t.amount_minor, t.direction,
                            upper(regexp_replace(coalesce(t.description,''), '\\s+', ' ', 'g'))
               order by (t.matched_payment_id is null), i.created_at, t.id
             ) as rn
      from bank_transactions t
      join bank_imports i on i.id = t.bank_import_id
    )
    delete from bank_transactions where id in (select id from ranked where rn > 1)
  `);

  const after = (await db.execute<{ n: number }>(sql`
    select count(*)::int as n from bank_transactions
  `)).rows[0];
  console.log(`\n✓ حُذف ${res.rowCount} · بقي ${after.n}`);
  process.exit(0);
}

main();
