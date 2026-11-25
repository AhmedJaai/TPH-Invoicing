-- توزيعٌ بالأيّام: دفعةٌ تغطّي من يومٍ إلى يوم (الإيجار ١٠ أغسطس – ٩ فبراير) تُقسَم على أشهرها بأيّامها
-- لا بالتساوي — كان أغسطس يحمل شهراً كاملاً من الدفعة الثانية فوق تسعة أيّامٍ من الأولى (أحمد، ٢٥ نوفمبر ٢٠٢٦).
-- إضافةٌ لا حذف: العمودان فارغان لكلّ ما قبلها، فيبقى توزيعُه بالأشهر كما هو.
ALTER TABLE finance_declarations ADD COLUMN IF NOT EXISTS from_day text;
ALTER TABLE finance_declarations ADD COLUMN IF NOT EXISTS to_day text;
ALTER TABLE finance_declarations DROP CONSTRAINT IF EXISTS finance_declarations_days_check;
ALTER TABLE finance_declarations ADD CONSTRAINT finance_declarations_days_check CHECK (
  (from_day IS NULL AND to_day IS NULL)
  OR (kind = 'SPREAD'
      AND from_day ~ '^\d{4}-\d{2}-\d{2}$' AND to_day ~ '^\d{4}-\d{2}-\d{2}$'
      AND from_day <= to_day
      AND left(from_day, 7) = from_month AND left(to_day, 7) = to_month)
);
