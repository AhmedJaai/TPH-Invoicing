-- 059 — يومُ فتح الحساب البنكيّ: ما قبله لا يُعدّ «بلا كشف».
--
-- إقفالُ مايو ٢٠٢٦ يُردّ بـ«٧ أيام من الشهر بلا كشف» — والحسابُ فُتح في مايو، فأوّلُ حركةٍ
-- فيه ٨ مايو. القاعدةُ صحيحة (يومٌ لا كشفَ له لا يُعرف ما جرى فيه)، وما قبل فتح الحساب
-- لم يكن فيه حسابٌ أصلاً. فيُكتب يومُ الفتح، وتبدأ التغطيةُ منه في شهره.
--
-- عمودٌ يقبل الفراغ: إضافةٌ آمنة — والفراغُ «لم يُذكر» فتبقى القاعدةُ كما هي.
alter table bank_accounts add column if not exists opened_on text;
alter table bank_accounts drop constraint if exists bank_accounts_opened_on_format;
alter table bank_accounts add constraint bank_accounts_opened_on_format
  check (opened_on is null or opened_on ~ '^\d{4}-\d{2}-\d{2}$');
