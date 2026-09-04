-- ═══════════════════════════════════════════════════════════════════
--  حالات الضريبة بدل الرايات الثنائية، ومناعة الاستيراد من التكرار
-- ═══════════════════════════════════════════════════════════════════
--
--  ١. الراية الثنائية كانت تكذب: `is_tax_valid = false` تعني «ليست ضريبية»
--     و«لا نعرف» معاً. وأكثر فواتير الأرشيف رُحّلت من أسماء الملفات بلا
--     تفصيل ضريبي، فوُسمت غير صالحة وهي مجهولة. والفرق عملي: الأولى
--     تُطالِب المورّد ببديل، والثانية تُطالِبنا بقراءة المستند.
--
--  ٢. الصافي والضريبة كانا NOT NULL، فصار المجهول صفراً — وأنتج ذلك
--     «ضريبة معرّضة: صفر ريال» وهي في الحقيقة غير معلومة.
--
--  ٣. الاستيراد لم يكن منيعاً من التكرار: استُورد كشف واحد ثلاث مرّات
--     فصارت كل حركة ثلاثاً. الفحص في الكود يفلت من طلبين متزامنين،
--     والقيد في القاعدة لا يفلت.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── ١) حالات الضريبة ──
DO $$ BEGIN
  CREATE TYPE tax_status AS ENUM ('VALID', 'INVALID', 'UNKNOWN', 'NOT_APPLICABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE input_vat_status AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_status tax_status NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS input_vat_status input_vat_status NOT NULL DEFAULT 'UNKNOWN';

-- تُشتقّ من الرايات القديمة قبل إسقاطها
UPDATE invoices SET
  tax_status = (CASE WHEN is_tax_valid THEN 'VALID' ELSE 'INVALID' END)::tax_status,
  input_vat_status = (CASE WHEN input_vat_eligible THEN 'ELIGIBLE' ELSE 'NOT_ELIGIBLE' END)::input_vat_status
WHERE TRUE;

-- ── ٢) المجهول لا يكون صفراً ──
ALTER TABLE invoices ALTER COLUMN subtotal_minor DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN vat_minor DROP NOT NULL;

UPDATE invoices
   SET subtotal_minor = NULL,
       vat_minor = NULL,
       tax_status = 'UNKNOWN',
       input_vat_status = 'UNKNOWN',
       updated_at = now()
 WHERE subtotal_minor = 0 AND vat_minor = 0 AND total_minor > 0;

ALTER TABLE invoices DROP COLUMN IF EXISTS is_tax_valid;
ALTER TABLE invoices DROP COLUMN IF EXISTS input_vat_eligible;

CREATE INDEX IF NOT EXISTS invoices_tax_status_idx ON invoices (tax_status);

-- ── ٣) مناعة المستندات ──
DROP INDEX IF EXISTS documents_sha_idx;
CREATE UNIQUE INDEX IF NOT EXISTS documents_sha_uniq
  ON documents (sha256) WHERE status <> 'REJECTED';

-- ── ٤) مناعة كشف البنك ──
ALTER TABLE bank_imports ADD COLUMN IF NOT EXISTS file_sha256 text;
ALTER TABLE bank_imports ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE bank_imports ADD COLUMN IF NOT EXISTS new_row_count integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS bank_imports_file_sha_uniq ON bank_imports (file_sha256);

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS external_id text;

-- ترتيب التكرار جزء من الهوية: الكشف قد يحمل حركتين متطابقتين حقيقيتين في
-- اليوم الواحد، فلو أهملناه ابتلعت البصمة إحداهما.
WITH numbered AS (
  SELECT t.id,
         encode(digest(
           coalesce(bi.account_number, '') || '|' ||
           to_char(t.value_date, 'YYYY-MM-DD') || '|' ||
           t.amount_minor::text || '|' || t.direction::text || '|' ||
           coalesce(t.description, '') || '|' ||
           (row_number() OVER (
              PARTITION BY t.bank_import_id, t.value_date, t.amount_minor,
                           t.direction, coalesce(t.description, '')
              ORDER BY t.id))::text
         , 'sha256'), 'hex') AS fp
  FROM bank_transactions t
  JOIN bank_imports bi ON bi.id = t.bank_import_id
  WHERE t.external_id IS NULL
)
UPDATE bank_transactions t SET external_id = n.fp FROM numbered n WHERE n.id = t.id;

CREATE UNIQUE INDEX IF NOT EXISTS bank_tx_external_uniq ON bank_transactions (external_id);
CREATE INDEX IF NOT EXISTS bank_tx_category_idx ON bank_transactions (category);
