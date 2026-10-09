-- 069 — فهارسُ ما يُسأل عنه كثيراً: مستنداتُ المورّد، وسطورُ الفواتير بوصفها، وحركاتُ البنك بقاعدتها.
--
-- مفاتيحُ أجنبيّة يُرشَّح بها ويُجمَّع ولا فهرسَ يخدمها — إضافةٌ خالصة،
-- لا تمسّ صفّاً ولا قيداً:
--
--   documents(supplier_id, created_at desc)
--       ترشيحُ صفحة المستندات بالمورّد. الفهرسُ القائم يبدأ بـperiod_month
--       فلا يخدمه. (created_at هو عمودُ uploadedAt.)
--   invoice_lines(supplier_id, normalized_description)
--       تجميعُ الأصناف بمورّدها (product.service) ودمجُ أصناف المورّد
--       (supplier-item-merge.service).
--   bank_transactions(rule_id) حيث rule_id غير فارغ
--       حذفُ قاعدةِ تصنيفٍ (ON DELETE SET NULL) كان يمسح الجدول كلَّه.
--
-- الجداول صغيرة، فالإنشاءُ العاديّ (غير المتزامن) يكفي ويجري داخل معاملة الهجرة.

create index if not exists documents_supplier_created_idx
  on documents (supplier_id, created_at desc);

create index if not exists invoice_lines_supplier_item_idx
  on invoice_lines (supplier_id, normalized_description);

create index if not exists bank_tx_rule_idx
  on bank_transactions (rule_id)
  where rule_id is not null;
