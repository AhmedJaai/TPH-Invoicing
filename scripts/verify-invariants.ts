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
    ── قيودُ الجرد تُنشئ بياناتها بنفسها ──

    قيودُ المال تُختبَر على فاتورةٍ وحركةٍ قائمتين لأنّها تقيس حدوداً
    نسبيّة (ما بقي على الفاتورة). وقيودُ الجرد مطلقة، فتُنشأ صفوفُها
    داخل المعاملة نفسِها — فتُفحَص على قاعدةٍ فارغة كما تُفحَص على
    قاعدةِ الإنتاج، ولا تصير «لم تُفحَص» لأنّ المقهى لم يجرد بعد.
  */
  const inventory = [
    await mustFail("كتابةُ عدٍّ في جردٍ مقفَل",
      `insert into products (id, name_ar) values ('t-inv-p1', 'صنف اختبار');
       insert into inventory_counts (id, period_start, period_end)
         values ('t-inv-c1', '2099-01-01', '2099-01-07');
       insert into inventory_count_lines (id, count_id, product_id, base_unit)
         values ('t-inv-l1', 't-inv-c1', 't-inv-p1', 'KG');
       update inventory_counts set status = 'FINALISED', finalised_at = now() where id = 't-inv-c1';
       update inventory_count_lines set actual_milli = 1 where id = 't-inv-l1'`,
      { code: "23514", message: /مقفَل/ }),

    /* 050: الهدرُ والحركاتُ كالاستلام — لا تُكتب في أسبوعٍ جردُه مقفَل */
    await mustFail("هدرٌ في أسبوعٍ جردُه مقفَل",
      `insert into products (id, name_ar) values ('t-inv-pw', 'صنف اختبار');
       insert into inventory_counts (id, period_start, period_end, status, finalised_at)
         values ('t-inv-cw', '2099-02-01', '2099-02-07', 'FINALISED', now());
       insert into waste_records (id, product_id, quantity_milli, unit, occurred_on, reason)
         values ('t-inv-w', 't-inv-pw', 1000, 'KG', '2099-02-03', 'EXPIRED')`,
      { code: "23514", message: /مقفَل/ }),
    await mustPass("والهدرُ في أسبوعٍ لا جردَ مقفَلاً فيه مقبول",
      `insert into products (id, name_ar) values ('t-inv-pw2', 'صنف اختبار');
       insert into waste_records (id, product_id, quantity_milli, unit, occurred_on, reason)
         values ('t-inv-w2', 't-inv-pw2', 1000, 'KG', '2099-02-20', 'EXPIRED')`),

    await mustFail("حذفُ لقطةِ جردٍ مقفَل",
      `insert into inventory_counts (id, period_start, period_end, status, finalised_at)
         values ('t-inv-c2', '2099-01-08', '2099-01-14', 'FINALISED', now());
       insert into inventory_count_snapshots (count_id, engine_version, payload, provenance, checksum)
         values ('t-inv-c2', 'x', '{}'::jsonb, '{}'::jsonb, 'x');
       delete from inventory_count_snapshots where count_id = 't-inv-c2'`,
      { code: "23514", message: /لا تُعدَّل/ }),

    await mustFail("نسختا وصفةٍ ساريتان تتداخلان",
      `insert into products (id, name_ar) values ('t-inv-p2', 'صنف مباع');
       insert into recipes (id, product_id) values ('t-inv-r1', 't-inv-p2');
       insert into recipe_versions (id, recipe_id, version, status, effective_from, effective_to)
         values ('t-inv-v1', 't-inv-r1', 1, 'ACTIVE', '2099-01-01', '2099-01-31');
       insert into recipe_versions (id, recipe_id, version, status, effective_from)
         values ('t-inv-v2', 't-inv-r1', 2, 'ACTIVE', '2099-01-15')`,
      { code: "23514", message: /تتداخل/ }),

    await mustPass("ونسختان متتاليتان بلا تداخلٍ مقبولتان — القيدُ الذي يرفض كلَّ شيء يمنع الواقع",
      `insert into products (id, name_ar) values ('t-inv-p3', 'صنف مباع');
       insert into recipes (id, product_id) values ('t-inv-r2', 't-inv-p3');
       insert into recipe_versions (id, recipe_id, version, status, effective_from, effective_to)
         values ('t-inv-v3', 't-inv-r2', 1, 'ACTIVE', '2099-01-01', '2099-01-14');
       insert into recipe_versions (id, recipe_id, version, status, effective_from)
         values ('t-inv-v4', 't-inv-r2', 2, 'ACTIVE', '2099-01-15')`),

    await mustFail("ملفُّ مبيعاتٍ ببصمةٍ مكرَّرة",
      `insert into sales_sources (id, name) values ('t-inv-s1', 'مصدر اختبار');
       insert into sales_imports (id, source_id, file_name, file_sha256, adapter)
         values ('t-inv-i1', 't-inv-s1', 'a.xlsx', 't-inv-sha', 'X');
       insert into sales_imports (id, source_id, file_name, file_sha256, adapter)
         values ('t-inv-i2', 't-inv-s1', 'b.xlsx', 't-inv-sha', 'X')`,
      { code: "23505" }),

    /* والفترةُ المتطابقة حالةٌ خاصّة من التداخل — يمسكها المؤثِّر أوّلاً */
    await mustFail("جردان لفترةٍ واحدة في فرعٍ واحد",
      `insert into inventory_counts (id, period_start, period_end)
         values ('t-inv-c3', '2099-02-01', '2099-02-07');
       insert into inventory_counts (id, period_start, period_end)
         values ('t-inv-c4', '2099-02-01', '2099-02-07')`,
      { code: "23514", message: /تتداخل/ }),

    await mustPass("والفترةُ نفسُها في فرعٍ آخر جردٌ آخر",
      `insert into branches (id, name_ar, code) values ('t-inv-b1', 'فرع اختبار', 't-inv-b1');
       insert into inventory_counts (id, period_start, period_end)
         values ('t-inv-c5', '2099-03-01', '2099-03-07');
       insert into inventory_counts (id, branch_id, period_start, period_end)
         values ('t-inv-c6', 't-inv-b1', '2099-03-01', '2099-03-07')`),

    await mustFail("فترتا جردٍ تتداخلان في الفرع نفسه",
      `insert into inventory_counts (id, period_start, period_end)
         values ('t-inv-ov1', '2099-04-01', '2099-04-07');
       insert into inventory_counts (id, period_start, period_end)
         values ('t-inv-ov2', '2099-04-05', '2099-04-11')`,
      { code: "23514", message: /تتداخل/ }),

    await mustPass("والفترةُ الملاصقة مقبولة — ٨ يبدأ بعد ٧",
      `insert into inventory_counts (id, period_start, period_end)
         values ('t-inv-ov3', '2099-05-01', '2099-05-07');
       insert into inventory_counts (id, period_start, period_end)
         values ('t-inv-ov4', '2099-05-08', '2099-05-14')`),

    await mustFail("مكوّنُ وصفةٍ بكمّيّةٍ صفر",
      `insert into products (id, name_ar) values ('t-inv-p4', 'صنف مباع');
       insert into products (id, name_ar) values ('t-inv-p5', 'مكوّن');
       insert into recipes (id, product_id) values ('t-inv-r3', 't-inv-p4');
       insert into recipe_versions (id, recipe_id, version, effective_from)
         values ('t-inv-v5', 't-inv-r3', 1, '2099-01-01');
       insert into recipe_ingredients (id, recipe_version_id, product_id, quantity_milli, unit)
         values ('t-inv-g1', 't-inv-v5', 't-inv-p5', 0, 'G')`,
      { code: "23514", constraint: "recipe_ingredients_qty_positive" }),
  ];

  /*
    بلا بياناتٍ لا يُفحَص قيد — و«لم يُفحَص» ليس نجاحاً. فعلى الجهاز يُقال
    ويخرج بسلام، وفي CI (`--require-data`) يُعدّ فشلاً كي لا يخضرّ فحصُ صفرٍ من القيود.
  */
  if (!inv || !tx) {
    const strict = process.argv.includes("--require-data");
    const ok = inventory.filter(Boolean).length;
    console.log(
      `\n${ok} من ${inventory.length} من قيود الجرد يعمل.`
      + `\nولا بيانات كافية لقيود المال${!inv ? " (لا فاتورة)" : " (لا حركة بنك)"}${strict ? " — ولم تُفحَص." : "."}`,
    );
    await pool.end();
    /* و«لم يُفحَص» ليس نجاحاً: في CI يُعدّ فشلاً كما كان */
    process.exit(strict || ok !== inventory.length ? 1 : 0);
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

    /* 048: الحدُّ صافي الدفعة بعد رسمها — لا مبلغُها كلُّه */
    await mustFail("تخصيصٌ يتجاوز صافي الدفعة بعد الرسم",
      `insert into payments (id, supplier_id, paid_at, amount_minor, fee_minor, method, status)
         values ('t-p-fee', '${inv.supplier_id}', now(), 1000, 100, 'BANK_TRANSFER', 'UNAPPLIED');
       insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
       values ('t-fee', 't-p-fee', '${inv.id}', 950)`,
      { code: "23514", message: /صافي الدفعة/ }),
    /* 048: والحدُّ يُسأل حين يتغيّر الأصل — لا التخصيصُ وحده */
    /*
      يُبنى ما يُفحَص داخل المعاملة — لا يُعتمَد على تخصيصٍ قائم: في قاعدةٍ
      فارغة (CI) لا تخصيصَ فيُحدَّث لا شيء و«يُقبَل»، فيبدو القيدُ معطَّلاً وهو
      لم يُسأل. فالفاتورةُ تُفرَّغ من تخصيصها، وتُخصَّص لها دفعةٌ من الفحص.
    */
    await mustFail("خفضُ مبلغ دفعةٍ تحت ما خُصّص منها",
      `delete from payment_allocations where invoice_id = '${inv.id}';
       ${payment("t-p-cut", total)};
       insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
         values ('t-cut', 't-p-cut', '${inv.id}', ${total});
       update payments set amount_minor = 1, fee_minor = 0 where id = 't-p-cut'`,
      { code: "23514", message: /خُصّص منها/ }),
    await mustFail("خفضُ إجماليّ فاتورةٍ تحت ما سُدّد منها",
      `delete from payment_allocations where invoice_id = '${inv.id}';
       ${payment("t-p-shrink", total)};
       insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
         values ('t-shrink', 't-p-shrink', '${inv.id}', ${total});
       update invoices set total_minor = 1, subtotal_minor = null, vat_minor = null where id = '${inv.id}'`,
      { code: "23514", message: /سُدّد منها/ }),
    await mustFail("حذفُ دفعةٍ في شهرٍ مقفل",
      `insert into payments (id, supplier_id, paid_at, amount_minor, method, status, applies_to_month)
         values ('t-p-del', '${inv.supplier_id}', now(), 100, 'BANK_TRANSFER', 'UNAPPLIED', '2099-04');
       insert into month_closes (id, month, status) values ('t-mc-del', '2099-04', 'CLOSED');
       delete from payments where id = 't-p-del'`,
      { code: "P0001", message: /مقفل/ }),

    /* تعديلٌ على الفاتورة نفسها — لا إدراجٌ يردّه قيدُ فرادة المستند */
    await mustFail("فاتورة بإجمالي صفر",
      /* تخصيصاتُها تُفَكّ أوّلاً (والمعاملةُ تُلغى) — فيُسأل قيدُ الإجماليّ لا حدُّ السداد (048) */
      `delete from payment_allocations where invoice_id = '${inv.id}';
       update invoices set total_minor = 0, subtotal_minor = null, vat_minor = null where id = '${inv.id}'`,
      { code: "23514", constraint: "invoices_total_positive" }),

    await mustFail("فاتورة مجموعها يخالف إجماليها بأكثر من ريال",
      `delete from payment_allocations where invoice_id = '${inv.id}';
       update invoices set subtotal_minor = 10000, vat_minor = 1500, total_minor = 20000 where id = '${inv.id}'`,
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

    ...(tx ? [await mustFail("حركتا بنكٍ لدفعةٍ واحدة",
      /* حركتان يصنعهما الفحصُ من حركةٍ قائمة — لا يُعتمَد على حركتين بلا دفعة */
      `insert into payments (id, supplier_id, paid_at, amount_minor, method, status)
         values ('t-p-two', '${inv.supplier_id}', now(), 100, 'BANK_TRANSFER', 'UNAPPLIED');
       insert into bank_transactions
         (id, bank_import_id, value_date, description, amount_minor, direction, occurrence, identity_key, matched_payment_id)
       select 't-two-' || n, bank_import_id, value_date, description, amount_minor, direction,
              occurrence + 900 + n, 't-two-identity-' || n, 't-p-two'
         from bank_transactions, generate_series(1, 2) as n
        where id = (select id from bank_transactions limit 1)`,
      { code: "23505", constraint: "bank_tx_matched_payment_uniq" })] : []),

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

  const all = [...results, ...inventory];
  const passed = all.filter(Boolean).length;
  console.log(`\n${passed} من ${all.length} قيداً يعمل.`);
  await pool.end();
  process.exit(passed === all.length ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
