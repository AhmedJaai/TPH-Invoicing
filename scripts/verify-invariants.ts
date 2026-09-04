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

async function main() {
  const [inv] = (await db.execute<{ id: string; total: number }>(sql`
    select i.id, i.total_minor as total from invoices i order by i.total_minor desc limit 1
  `)).rows;
  const [pay] = (await db.execute<{ id: string; amount: number }>(sql`
    select id, amount_minor as amount from payments order by amount_minor desc limit 1
  `)).rows;

  if (!inv || !pay) { console.log("لا بيانات كافية للفحص."); process.exit(0); }

  const results = [
    await mustFail("تخصيص بمبلغ سالب",
      `insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
       values ('t-neg', '${pay.id}', '${inv.id}', -100)`),
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
  ];

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} من ${results.length} قيداً يعمل.`);
  process.exit(passed === results.length ? 0 : 1);
}
main();
