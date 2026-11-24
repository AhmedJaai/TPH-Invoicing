-- «للعلم»: رقمٌ محاسبيّ يُعرض تحت الربح ولا يُطرح منه — الإهلاكُ ورأسُ مال الافتتاح (أحمد، ٢٤ نوفمبر ٢٠٢٦).
-- إضافةٌ لا حذف: القيمُ القائمة كلُّها تبقى مقبولة.
ALTER TABLE finance_declarations DROP CONSTRAINT IF EXISTS finance_declarations_kind_check;
ALTER TABLE finance_declarations ADD CONSTRAINT finance_declarations_kind_check
  CHECK (kind IN ('SPREAD', 'OFF_BOOK', 'NONE', 'MEMO'));
