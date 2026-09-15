/**
 * يثبت أنّ القاعدة نفسها ترفض ما يجب رفضه — **بالقيد الذي يُسمّيه الفحص**.
 *
 * القيد الذي لا يُختبَر ادّعاء. وكلّ محاولة هنا تُنفَّذ داخل معاملة تُلغى
 * بعدها، على اتّصالٍ مخصَّص، فلا تمسّ بياناً.
 *
 * ── لماذا يُطابَق سببُ الرفض ──
 *
 * كان `mustFail` يعدّ **أيّ** خطأ رفضاً: خطأ الصياغة، والعمود الغائب، وقيدَ
 * فرادةٍ لا علاقة له. ففحصا الفاتورة الماليّان كانا يُدرجان صفّاً بمستند
 * الفاتورة نفسها فيردّهما `invoices_document_id_unique` — ولو حُذف القيدان
 * الماليّان بقي الفحص أخضر. وفحص «سباق دفعتين» كان يُردّ بحدّ **الدفعة**
 * لا الفاتورة. فصار كلّ فحصٍ يسمّي رمز الخطأ ونصّه، وما رُفض لسببٍ آخر
 * يُعلَن فشلاً.
 */
import { Pool, type DatabaseError } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

interface Expect {
  /** رمز Postgres: 23514 check · 23505 unique · P0001 raise. */
  code: string;
  /** اسم القيد، أو جزءٌ من نصّ الرسالة. */
  constraint?: string;
  message?: RegExp;
}

async function attempt(statement: string): Promise<DatabaseError | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(statement);
    return null;
  } catch (e) {
    return e as DatabaseError;
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

async function mustFail(label: string, statement: string, expect: Expect): Promise<boolean> {
  const e = await attempt(statement);
  if (!e) {
    console.log("  ✕", label, "— القاعدة قبلته!");
    return false;
  }
  const codeOk = e.code === expect.code;
  const constraintOk = !expect.constraint || e.constraint === expect.constraint;
  const messageOk = !expect.message || expect.message.test(e.message);
  if (codeOk && constraintOk && messageOk) {
    console.log("  ✓", label, "— رُفض بقيده");
    return true;
  }
  console.log("  ✕", label, `— رُفض لسببٍ آخر: [${e.code}] ${e.constraint ?? ""} ${e.message.slice(0, 90)}`);
  return false;
}

/**
 * وبعضُ القيود يُثبَت بالقبول لا بالرفض.
 *
 * فالقيد الذي يرفض كلّ شيء «يعمل» بالمعنى الساذج ويمنع الواقع. ومرجعُ
 * عمليّةٍ واحد في حسابين بنكيّين حركتان حقيقيّتان — فيجب أن يُقبَل.
 */
async function mustPass(label: string, statement: string): Promise<boolean> {
  const e = await attempt(statement);
  if (!e) {
    console.log("  ✓", label, "— قُبل");
    return true;
  }
  console.log("  ✕", label, "— رفضته القاعدة!", `[${e.code}]`, e.message.slice(0, 90));
  return false;
}

async function one<T>(q: string): Promise<T | undefined> {
  const client = await pool.connect();
  try {
    return (await client.query(q)).rows[0] as T | undefined;
  } finally {
    client.release();
  }
}

async function main() {
  /* فاتورةٌ مفتوحة فيها متّسع، ومورّدها — لتُنشأ الدفعة داخل المعاملة */
  const inv = await one<{ id: string; total: string; allocated: string; supplier_id: string; period_month: string }>(`
    select i.id, i.total_minor as total, i.supplier_id, i.period_month,
           coalesce((select sum(amount_minor) from payment_allocations where invoice_id = i.id), 0) as allocated
      from invoices i
     where i.supplier_id is not null
     order by i.total_minor desc limit 1
  `);
  const tx = await one<{ id: string }>(`select id from bank_transactions order by amount_minor desc limit 1`);

  /*
    بلا بياناتٍ لا يُفحَص قيد — و«لم يُفحَص» ليس نجاحاً. فعلى الجهاز يُقال
    ويخرج بسلام، وفي CI (`--require-data`) يُعدّ فشلاً كي لا يخضرّ فحصُ صفرٍ من القيود.
  */
  if (!inv || !tx) {
    const strict = process.argv.includes("--require-data");
    console.log(`لا بيانات كافية للفحص${!inv ? " (لا فاتورة)" : " (لا حركة بنك)"}${strict ? " — ولم يُفحَص شيء." : "."}`);
    await pool.end();
    process.exit(strict ? 1 : 0);
  }

  const total = Number(inv.total);
  const room = total - Number(inv.allocated);
  /* دفعةٌ يُنشئها الفحص نفسه داخل المعاملة — فلا يُقاس حدٌّ بحدٍّ غيره */
  const payment = (id: string, amount: number) =>
    `insert into payments (id, supplier_id, paid_at, amount_minor, method, status)
       values ('${id}', '${inv.supplier_id}', now(), ${amount}, 'BANK_TRANSFER', 'UNAPPLIED')`;

  const results = [
    await mustFail("تخصيص بمبلغ سالب",
      `${payment("t-p-neg", 1000)};
       insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
       values ('t-neg', 't-p-neg', '${inv.id}', -100)`,
      { code: "23514", constraint: "payment_allocations_positive" }),

    /*
      سباقُ دفعتين على فاتورةٍ واحدة: دفعةٌ فيها متّسعٌ كبير تُخصَّص فوق
      ما بقي على الفاتورة — فالرفض بحدّ الفاتورة وحده، لا بحدّ الدفعة.
    */
    await mustFail("تخصيصٌ يتجاوز إجمالي الفاتورة (سباق دفعتين)",
      `${payment("t-p-race", total * 3 + 100)};
       insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
       values ('t-race', 't-p-race', '${inv.id}', ${Math.max(1, room) + total})`,
      { code: "23514", message: /الفاتورة/ }),

    await mustFail("تخصيص أكبر من قيمة الدفعة",
      `${payment("t-p-over", 100)};
       insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
       values ('t-over', 't-p-over', '${inv.id}', ${Math.min(200, Math.max(101, room))})`,
      { code: "23514", message: /الدفعة/ }),

    /* تعديلٌ على الفاتورة نفسها — لا إدراجٌ يردّه قيدُ فرادة المستند */
    await mustFail("فاتورة بإجمالي صفر",
      `update invoices set total_minor = 0, subtotal_minor = null, vat_minor = null where id = '${inv.id}'`,
      { code: "23514", constraint: "invoices_total_positive" }),

    await mustFail("فاتورة مجموعها يخالف إجماليها بأكثر من ريال",
      `update invoices set subtotal_minor = 10000, vat_minor = 1500, total_minor = 20000 where id = '${inv.id}'`,
      { code: "23514", constraint: "invoices_parts_sum_to_total" }),

    await mustFail("مصروف بمبلغ سالب",
      `insert into expenses (id, period_month, occurred_on, category, label, amount_minor, source)
       values ('t-exp', '2026-08', '2026-08-01', 'RENT', 'اختبار', -1, 'MANUAL')`,
      { code: "23514" }),
    await mustFail("مصروف شهره يخالف تاريخه",
      `insert into expenses (id, period_month, occurred_on, category, label, amount_minor, source)
       values ('t-exp2', '2026-07', '2026-08-01', 'RENT', 'اختبار', 100, 'MANUAL')`,
      { code: "23514", constraint: "expenses_period_matches_date" }),

    /*
      الشهر المقفل لا يُكتب فيه (الهجرة ٠٢٨): يُقفَل شهرُ الفاتورة داخل
      المعاملة، ثمّ يُحاوَل تعديلُ مبلغها وتخصيصُها وقيدُ دفعةٍ فيه.
    */
    await mustFail("تعديل مبلغ فاتورةٍ في شهرٍ مقفل",
      `insert into month_closes (id, month, status) values ('t-mc', '${inv.period_month}', 'CLOSED')
         on conflict (month) do update set status = 'CLOSED';
       update invoices set total_minor = total_minor + 1, subtotal_minor = null, vat_minor = null where id = '${inv.id}'`,
      { code: "P0001", message: /مقفل/ }),
    await mustFail("تخصيصٌ على فاتورةٍ في شهرٍ مقفل",
      `insert into month_closes (id, month, status) values ('t-mc2', '${inv.period_month}', 'CLOSED')
         on conflict (month) do update set status = 'CLOSED';
       insert into payments (id, supplier_id, paid_at, amount_minor, method, status, applies_to_month)
         values ('t-p-mc', '${inv.supplier_id}', now(), 100, 'BANK_TRANSFER', 'UNAPPLIED', '2099-01');
       insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
         values ('t-alloc-mc', 't-p-mc', '${inv.id}', 1)`,
      { code: "P0001", message: /مقفل/ }),
    await mustFail("قيدُ دفعةٍ في شهرٍ مقفل",
      `insert into month_closes (id, month, status) values ('t-mc3', '2099-02', 'CLOSED');
       insert into payments (id, supplier_id, paid_at, amount_minor, method, status, applies_to_month)
         values ('t-p-mc3', '${inv.supplier_id}', now(), 100, 'BANK_TRANSFER', 'UNAPPLIED', '2099-02')`,
      { code: "P0001", message: /مقفل/ }),
    await mustPass("وتعديلُ حال الدفعة في الشهر المقفل مقبول — لا يغيّر المال",
      `insert into month_closes (id, month, status) values ('t-mc4', '2099-03', 'CLOSED');
       update payments set status = status where id = (select id from payments limit 1)`),

    /*
      مرجعُ العمليّة: فريدٌ **داخل الحساب** لا في النظام كلّه.
    */
    ...(tx ? [await mustFail("مرجعُ عمليّةٍ مكرَّر في الحساب نفسه",
      `insert into bank_transactions
         (id, bank_import_id, value_date, description, amount_minor, direction,
          occurrence, bank_account_id, operation_ref, identity_key)
       select 't-ref-same', bank_import_id, value_date, description, amount_minor,
              direction, occurrence + 77, bank_account_id, operation_ref,
              't-ref-same-identity'
       from bank_transactions where operation_ref is not null limit 1`,
      { code: "23505" })] : []),

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
       from bank_transactions where id = '${tx.id}' and identity_key is not null`,
      { code: "23505" })] : []),
  ];

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} من ${results.length} قيداً يعمل.`);
  await pool.end();
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
