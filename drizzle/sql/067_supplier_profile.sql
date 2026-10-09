-- 067 — ملفُّ المورّد: أجلُ السداد وجهةُ الاتّصال والآيبان المكتوب بيد.
--
-- بياناتُ المورّد التي يكتبها الإنسان ولا تُشتقّ — إضافةٌ خالصة، كلُّها تقبل الفراغ:
--
--   payment_terms_days  أجلُ السداد بالأيّام. NULL = «غير معروف» لا صفر (الصفرُ «نقداً»).
--                       كان payment_terms نصّاً حرّاً لا يقرؤه شيء، والمتأخّرُ ٦٠ يوماً
--                       لكلّ مورّد. يبقى العمودُ النصّيّ كما هو.
--   phone_e164 · email · contact_name
--                       ليُفتح واتساب على رقمه لا على شاشة اختيار جهة.
--   iban · iban_set_at · iban_set_by_id
--                       آيبانٌ يكتبه إنسانٌ لمورّدٍ لم يُحوَّل له من قبل (لا دليلَ له في
--                       الكشوف بعد). وأدلّةُ الكشف تبقى الحَكَم: إن خالفته قيل ذلك ولم
--                       يُكتب في ملفّ التحويلات.
--
-- والقيدان على عمودين جديدين كلُّ صفوفهما NULL — فلا صفَّ قائماً يخالفهما.

alter table suppliers
  add column if not exists payment_terms_days integer,
  add column if not exists phone_e164 text,
  add column if not exists email text,
  add column if not exists contact_name text,
  add column if not exists iban text,
  add column if not exists iban_set_at timestamptz,
  add column if not exists iban_set_by_id text references users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_payment_terms_days_range') then
    alter table suppliers add constraint suppliers_payment_terms_days_range
      check (payment_terms_days is null or payment_terms_days between 0 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'suppliers_iban_shape') then
    alter table suppliers add constraint suppliers_iban_shape
      check (iban is null or iban ~ '^SA[0-9]{22}$');
  end if;
end $$;
