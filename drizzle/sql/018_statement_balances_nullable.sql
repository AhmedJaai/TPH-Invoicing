-- ٠١٨ — رصيد الكشف المجهول يُحفَظ مجهولاً، وأسطره تُحفَظ حين تُقرأ.
--
-- كان `opening_balance_minor` و`closing_balance_minor` غير قابلَين للفراغ
-- وافتراضهما صفر. فكشفٌ لم يُقرأ رصيدُه يُحفَظ «رصيده صفر» — أي أنّ
-- المورّد لا يطالبنا بشيء. وهذا أخطر ما يُقال عن دائن.
--
-- والقاعدة الرابعة في `CLAUDE.md`: المجهول ليس صفراً. فالعمودان يقبلان
-- `NULL`، ومن يقرأ يفرّق بين «قُرئ وكان صفراً» و«لم يُقرأ».
--
-- ولا يُحوَّل الصفر القائم إلى `NULL` هنا: الصفر الذي كُتب قبل هذه الهجرة
-- لا يُعرف أكان قراءةً أم افتراضاً، وتخمينُه يستبدل كذباً بكذب. تُصحَّح
-- بإعادة مطابقة الكشف من `/statements`، وهي تكتب المقروء.

ALTER TABLE statements ALTER COLUMN opening_balance_minor DROP NOT NULL;
ALTER TABLE statements ALTER COLUMN opening_balance_minor DROP DEFAULT;

ALTER TABLE statements ALTER COLUMN closing_balance_minor DROP NOT NULL;
ALTER TABLE statements ALTER COLUMN closing_balance_minor DROP DEFAULT;

-- الرصيد إن كُتب فهو موجب أو صفر — الكشف الدائن لا يُمثَّل بسالب هنا.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'statements_balances_nonneg'
  ) THEN
    ALTER TABLE statements ADD CONSTRAINT statements_balances_nonneg CHECK (
      (opening_balance_minor IS NULL OR opening_balance_minor >= 0)
      AND (closing_balance_minor IS NULL OR closing_balance_minor >= 0)
    );
  END IF;
END $$;
