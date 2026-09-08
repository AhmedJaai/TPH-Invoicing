/**
 * حذفُ نسخةٍ كاذبة من حركة بنك — بإذنٍ صريح، وبأثر.
 *
 *   npm run db:remove-dupe -- --id <معرّف الحركة>            ← معاينة
 *   npm run db:remove-dupe -- --id <معرّف الحركة> --apply     ← تنفيذ
 *
 * ── متى يُستعمَل ──
 *
 * حين يُثبت **إنسان** أنّ صفّين في القاعدة لعمليّةٍ واحدة وقعت مرّة.
 * ولا يكفي تشابهُ المبلغ والتاريخ: الكشف يذكر الحركة بعدد ما وقعت،
 * وحركتان متطابقتان في اليوم قد تكونان حقيقيّتين — وفي أرشيف المقهى
 * ثلاثٌ وعشرون مجموعةً متكرّرة حقيقيّة. فالحاكم شهادةُ صاحب الحساب:
 * «حوالتان فقط، يوم ٥ ويوم ١٢».
 *
 * ── وما يقع بالترتيب ──
 *
 * ١ · يُدمَج ما في المحذوف من حقولٍ يفتقدها الباقي — فلا يشتري
 *     التنظيفُ إزالةَ تكرارٍ بثمنِ حقلٍ لا يُستعاد إلّا بإعادة استيراد.
 * ٢ · تُفَكّ تخصيصات دفعته، **فتعود الفاتورة مستحقّةً** — وهو الصواب:
 *     لم تُدفَع مرّتين.
 * ٣ · تُحذَف الدفعة التي لا أصل لها بعد فكّ تخصيصها.
 * ٤ · يُحذَف الصفّ.
 * ٥ · يُعاد ترقيم `occurrence` لئلّا تبقى ثغرةٌ يدخل منها استيرادٌ
 *     قادم فتعود الحركة مرّتين.
 * ٦ · ويُكتب كلُّ ذلك في سجلّ التدقيق قبل الحذف — بنصّ الصفّ كاملاً،
 *     فما يُحذَف يبقى مقروءاً بعد حذفه.
 *
 * وكلُّه في معاملةٍ واحدة: إمّا أن يتمّ كلُّه أو لا يقع منه شيء.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const id = args[args.indexOf("--id") + 1];

const riyals = (m: unknown) => (Number(m) / 100).toFixed(2);

async function main() {
  if (!id || id.startsWith("--")) {
    console.error("يلزم --id <معرّف الحركة>");
    process.exit(1);
  }

  const [row] = (
    await db.execute(sql`
      select bt.*, coalesce(s.name_ar, s.name_en) sup
      from bank_transactions bt
      left join suppliers s on s.id = bt.supplier_id
      where bt.id = ${id}
    `)
  ).rows as unknown as Record<string, unknown>[];

  if (!row) {
    console.error("لا حركة بهذا المعرّف");
    process.exit(1);
  }

  /* التوأم: الصفّ الباقي — نفس المفتاح الطبيعيّ وترتيبٌ أقلّ */
  const twins = (
    await db.execute(sql`
      select id, occurrence, operation_ref, transaction_type, matched_payment_id
      from bank_transactions
      where coalesce(bank_account_id::text,'~') = coalesce(${row.bank_account_id ?? null}::text,'~')
        and value_date = ${row.value_date}
        and amount_minor = ${row.amount_minor}
        and direction = ${row.direction}
        and id <> ${id}
      order by occurrence
    `)
  ).rows as unknown as Record<string, unknown>[];

  const keeper = twins[0];

  const allocs = (
    await db.execute(sql`
      select pa.id, pa.invoice_id, pa.amount_minor, i.invoice_number
      from payment_allocations pa
      join invoices i on i.id = pa.invoice_id
      where pa.payment_id = ${row.matched_payment_id ?? null}
    `)
  ).rows as unknown as Record<string, unknown>[];

  console.log("── سيُحذَف ──");
  console.log(`  ${String(row.value_date).slice(0, 10)} · ${riyals(row.amount_minor)} · ${row.direction}`);
  console.log(`  المورّد: ${row.sup ?? "—"} · occurrence=${row.occurrence} · مرجع=${row.operation_ref ?? "(فارغ)"}`);
  console.log(`  الوصف: ${String(row.description ?? "").slice(0, 60)}`);

  console.log("\n── الباقي ──");
  console.log(
    keeper
      ? `  occurrence=${keeper.occurrence} · مرجع=${keeper.operation_ref ?? "(فارغ)"} · دفعة=${keeper.matched_payment_id ? String(keeper.matched_payment_id).slice(0, 8) : "—"}`
      : "  ⚠ لا توأم — لا تحذف صفّاً وحيداً",
  );

  console.log("\n── ما يُفَكّ ويعود مستحقّاً ──");
  if (allocs.length === 0) console.log("  لا تخصيصات");
  for (const a of allocs) {
    console.log(`  فاتورة ${a.invoice_number} ← يعود ${riyals(a.amount_minor)} إلى المستحقّ`);
  }
  console.log(`  والدفعة ${String(row.matched_payment_id ?? "—").slice(0, 8)} تُحذَف بعد فكّها`);

  if (!keeper) {
    console.error("\n✗ أُوقف: لا صفّ باقياً — الحذف يُفقد الحركة كلّها.");
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\nمعاينة فقط. للتنفيذ أضف --apply");
    return;
  }

  await db.transaction(async (t) => {
    /* ١ · الدمج: ما يحمله المحذوف ويفتقده الباقي */
    if (row.transaction_type && !keeper.transaction_type) {
      await t.execute(sql`
        update bank_transactions set transaction_type = ${row.transaction_type}
        where id = ${keeper.id}`);
      console.log("  ✓ نُقل «نوع العملية» إلى الباقي");
    }
    if (row.operation_ref && !keeper.operation_ref) {
      await t.execute(sql`
        update bank_transactions set operation_ref = ${row.operation_ref}
        where id = ${keeper.id}`);
      console.log("  ✓ نُقل مرجع العمليّة إلى الباقي");
    }

    /* ٢ · الأثر يُكتب قبل الحذف — بنصّ الصفّ كاملاً */
    await t.execute(sql`
      insert into audit_logs (id, actor_id, action, entity_type, entity_id, before, after)
      values (gen_random_uuid(),
              (select id from users order by created_at limit 1),
              'DELETE_DUPLICATE_TRANSACTION', 'bank_transaction', ${id},
              ${JSON.stringify(row)}::jsonb, null)`);

    /* ٣ · فكّ التخصيصات — فتعود الفاتورة مستحقّة */
    if (row.matched_payment_id) {
      await t.execute(sql`delete from payment_allocations where payment_id = ${row.matched_payment_id}`);
      await t.execute(sql`update bank_transactions set matched_payment_id = null where id = ${id}`);
      await t.execute(sql`delete from payments where id = ${row.matched_payment_id}`);
      console.log("  ✓ فُكَّت التخصيصات وحُذفت الدفعة");
    }

    /* ٤ · الحذف */
    await t.execute(sql`delete from bank_transactions where id = ${id}`);
    console.log("  ✓ حُذف الصفّ");

    /*
      ٥ · إعادة الترقيم.

      `occurrence` جزءٌ من المفتاح الطبيعيّ، فثغرةٌ فيه تعني أنّ
      استيراداً قادماً يكتب الرقم الغائب فلا يصطدم بشيء — فتعود الحركة
      مرّتين. ويُرقَّم على مرحلتين لأنّ الفهرس فريد.
    */
    await t.execute(sql`
      with ranked as (
        select id, row_number() over (order by occurrence) - 1 rn
        from bank_transactions
        where coalesce(bank_account_id::text,'~') = coalesce(${row.bank_account_id ?? null}::text,'~')
          and value_date = ${row.value_date}
          and amount_minor = ${row.amount_minor}
          and direction = ${row.direction}
      )
      update bank_transactions b set occurrence = ranked.rn + 1000
      from ranked where b.id = ranked.id`);
    await t.execute(sql`
      update bank_transactions set occurrence = occurrence - 1000
      where occurrence >= 1000`);
    console.log("  ✓ أُعيد ترقيم occurrence");
  });

  console.log("\nتمّ.");
}

main().then(() => process.exit(0));
