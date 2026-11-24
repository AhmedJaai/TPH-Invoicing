-- افتتاحيٌّ صفرٌ بدليل: صنفٌ لم يُشترَ ولم يُستلَم ولم يُعدّ قبل الفترة، وأوّلُ دخوله فيها أو بعدها (٢٥ نوفمبر ٢٠٢٦).
-- إضافةٌ لا حذف: القيمُ القائمة كلُّها تبقى مقبولة.
ALTER TABLE inventory_count_lines DROP CONSTRAINT IF EXISTS inventory_count_lines_opening_source_ok;
ALTER TABLE inventory_count_lines ADD CONSTRAINT inventory_count_lines_opening_source_ok
  CHECK (opening_source IN ('MANUAL', 'PREVIOUS_COUNT', 'MOVEMENT', 'NEVER_STOCKED', 'UNKNOWN'));
