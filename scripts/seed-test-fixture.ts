/**
 * أقلُّ ما يحتاجه `db:verify` ليفحص شيئاً — على قاعدة اختبارٍ وحدها.
 *
 *   DATABASE_URL=postgres://…localhost…/x_test npm run db:test-fixture
 *
 * `db:verify` يختار فاتورةً وحركةَ بنكٍ قائمتين ويحاول خرق القيود عليهما.
 * وعلى قاعدةٍ فارغة يقول «لا بيانات كافية» ويخرج بنجاح — فيخضرّ CI وقد
 * فحص صفراً من القيود. فهذا يُدرج مورّداً وفاتورةً وحسابًا وحركةً لها مرجعُ
 * عمليّةٍ وهويّة، ويرفض أيّ قاعدةٍ ليست محلّيّةً منتهيةً بـ`_test`.
 */
import { Client } from "pg";
import { testDatabaseProblem } from "@/lib/ops/test-database";

async function main() {
  const problem = testDatabaseProblem(process.env.DATABASE_URL);
  if (problem) {
    console.error(`✕ ${problem} — التجهيز لا يكتب إلّا في قاعدة اختبار`);
    process.exit(2);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query(`
      insert into suppliers (id, slug, drive_folder_name, name_ar, is_active)
        values ('fx-supplier', 'fx-supplier', 'fx-supplier', 'مورّد التجهيز', true);
      insert into documents (id, file_name, mime_type, supplier_id, period_month, kind, status)
        values ('fx-doc', 'fx.pdf', 'application/pdf', 'fx-supplier', '2026-08', 'TAX_INVOICE', 'ARCHIVED');
      insert into invoices (id, document_id, supplier_id, invoice_number, invoice_date, period_month,
                            subtotal_minor, vat_minor, total_minor)
        values ('fx-invoice', 'fx-doc', 'fx-supplier', 'FX-1', '2026-08-10', '2026-08', 434783, 65217, 500000);
      insert into bank_accounts (id, bank_name, label, account_number)
        values ('fx-account', 'الأهلي', 'حساب التجهيز', 'fx-account-number');
      insert into bank_imports (id, file_name, bank_account_id)
        values ('fx-import', 'fx.xlsx', 'fx-account');
      insert into bank_transactions (id, bank_import_id, value_date, description, amount_minor, direction,
                                     occurrence, bank_account_id, operation_ref, identity_key, external_id)
        values ('fx-tx', 'fx-import', '2026-08-20', 'TRF FX-SUPPLIER مرجع 999000111', 500000, 'DEBIT',
                0, 'fx-account', '999000111', 'REF:fx-account:999000111', 'fx-external');
    `);
    await c.query("commit");
    console.log("✓ جُهّزت قاعدة الاختبار: مورّد · فاتورة · حساب · حركة بمرجع وهويّة");
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("✕", (e as Error).message); process.exit(1); });
