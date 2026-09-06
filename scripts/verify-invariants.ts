/**
 * يثبت أنّ القاعدة نفسها ترفض ما يجب رفضه.
 *
 * القيد الذي لا يُختبَر ادّعاء. كل محاولة هنا تُنفَّذ داخل معاملة
 * تُلغى بعدها، فلا تمسّ بياناً.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

async function mustFail(label: string, statement: string): Promise<boolean> {
  try {
    await db.execute(sql.raw(`begin; ${statement}; rollback;`));
    console.log("  ✕", label, "— القاعدة قبلته!");
    return false;
  } catch {
    try { await db.execute(sql.raw("rollback")); } catch { /* لا معاملة مفتوحة */ }
    console.log("  ✓", label, "— رُفض");
    return true;
  }
}

/**
 * وبعضُ القيود يُثبَت بالقبول لا بالرفض.
 *
 * فالقيد الذي يرفض كلّ شيء «يعمل» بالمعنى الساذج ويمنع الواقع. ومرجعُ
 * عمليّةٍ واحد في حسابين بنكيّين حركتان حقيقيّتان — فيجب أن يُقبَل.
 */
async function mustPass(label: string, statement: string): Promise<boolean> {
  try {
    await db.execute(sql.raw(`begin; ${statement}; rollback;`));
    console.log("  ✓", label, "— قُبل");
    return true;
  } catch (e) {
    try { await db.execute(sql.raw("rollback")); } catch { /* لا معاملة مفتوحة */ }
    console.log("  ✕", label, "— رفضته القاعدة!", (e as Error).message.slice(0, 90));
    return false;
  }
}

async function main() {
  const [inv] = (await db.execute<{ id: string; total: number }>(sql`
    select i.id, i.total_minor as total from invoices i order by i.total_minor desc limit 1
  `)).rows;
  const [pay] = (await db.execute<{ id: string; amount: number }>(sql`
    select id, amount_minor as amount from payments order by amount_minor desc limit 1
  `)).rows;

  /* حركةٌ قائمة — تُنسَخ حرفاً بحرف ليُختبَر ردُّ المكرَّر. */
  const [tx] = (await db.execute<{ id: string }>(sql`
    select id from bank_transactions order by amount_minor desc limit 1
  `)).rows;

  if (!inv || !pay) { console.log("لا بيانات كافية للفحص."); process.exit(0); }

  const results = [
    await mustFail("تخصيص بمبلغ سالب",
      `insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
       values ('t-neg', '${pay.id}', '${inv.id}', -100)`),
    /*
      وسباقُ دفعتين على فاتورةٍ واحدة يُحسَم في القاعدة لا في الترتيب.

      دفعتان تقرآن «المستحقّ ٣٬٠٠٠» في اللحظة نفسها ثمّ تخصّصانه
      كلتاهما — والمؤثِّر يرفض الثانية. ولولاه لصارت الفاتورة مسدَّدة
      مرّتين، ولخرج من الحساب ستّة آلاف عن ثلاثة.
    */
    await mustFail("تخصيصٌ يتجاوز إجمالي الفاتورة (سباق دفعتين)",
      `insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
       values ('t-race', '${pay.id}', '${inv.id}', ${Number(inv.total)})`),

    await mustFail("تخصيص أكبر من قيمة الدفعة",
      `insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
       values ('t-over', '${pay.id}', '${inv.id}', ${Number(pay.amount) + 1000})`),
    await mustFail("فاتورة بإجمالي صفر",
      `insert into invoices (id, document_id, supplier_id, period_month, invoice_date, total_minor)
       select 't-zero', document_id, supplier_id, period_month, invoice_date, 0 from invoices where id = '${inv.id}'`),
    await mustFail("فاتورة مجموعها يخالف إجماليها بأكثر من ريال",
      `insert into invoices (id, document_id, supplier_id, period_month, invoice_date, subtotal_minor, vat_minor, total_minor)
       select 't-math', document_id, supplier_id, period_month, invoice_date, 10000, 1500, 20000 from invoices where id = '${inv.id}'`),
    await mustFail("مصروف بمبلغ سالب",
      `insert into expenses (id, period_month, occurred_on, category, label, amount_minor, source)
       values ('t-exp', '2026-08', '2026-08-01', 'RENT', 'اختبار', -1, 'MANUAL')`),
    await mustFail("مصروف شهره يخالف تاريخه",
      `insert into expenses (id, period_month, occurred_on, category, label, amount_minor, source)
       values ('t-exp2', '2026-07', '2026-08-01', 'RENT', 'اختبار', 100, 'MANUAL')`),

    /*
      الهويّة المخزَّنة: لا صفّان بمفتاحٍ واحد.

      وهي التي يُقرَّر بها «أهذه الحركة عندنا؟». فإن لم تُقيَّد في
      القاعدة كان المنع في الشيفرة وحدها — والشيفرة تفلت من طلبين
      متزامنين، ومن نصٍّ يُشغَّل بيد.
    */
    /*
      مرجعُ العمليّة: فريدٌ **داخل الحساب** لا في النظام كلّه.

      فحوالتان بمرجعٍ واحد في الحساب نفسه حوالةٌ واحدة قُيّدت مرّتين؛
      وفي حسابين مختلفين حوالتان حقيقيّتان. والقيد يجب أن يفرّق —
      وإلّا منع الواقع بحجّة منع الخطأ.
    */
    ...(tx ? [await mustFail("مرجعُ عمليّةٍ مكرَّر في الحساب نفسه",
      `insert into bank_transactions
         (id, bank_import_id, value_date, description, amount_minor, direction,
          occurrence, bank_account_id, operation_ref, identity_key)
       select 't-ref-same', bank_import_id, value_date, description, amount_minor,
              direction, occurrence + 77, bank_account_id, operation_ref,
              't-ref-same-identity'
       from bank_transactions where operation_ref is not null limit 1`)] : []),

    ...(tx ? [await mustPass("المرجعُ نفسه في حسابٍ آخر — حركتان",
      `insert into bank_accounts (id, bank_name, label, account_number)
         values ('t-acct', 'بنك اختبار', 'اختبار', 't-acct-number');
       insert into bank_transactions
         (id, bank_import_id, value_date, description, amount_minor, direction,
          occurrence, bank_account_id, operation_ref, identity_key)
       select 't-ref-other', bank_import_id, value_date, description, amount_minor,
              direction, occurrence, 't-acct', operation_ref, 't-ref-other-identity'
       from bank_transactions where operation_ref is not null limit 1`)] : []),

    ...(tx ? [await mustFail("حركتان بهويّةٍ مخزَّنة واحدة",
      `insert into bank_transactions
         (id, bank_import_id, value_date, description, transaction_type, beneficiary_raw,
          amount_minor, direction, external_id, occurrence, bank_account_id, identity_key)
       select 't-dup-identity', bank_import_id, value_date, description, transaction_type,
              beneficiary_raw, amount_minor, direction, 't-dup-id-fp', occurrence + 99,
              bank_account_id, identity_key
       from bank_transactions where id = '${tx.id}' and identity_key is not null`)] : []),

  ];

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} من ${results.length} قيداً يعمل.`);
  process.exit(passed === results.length ? 0 : 1);
}
main();
