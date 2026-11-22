-- 108 — فحصُ الصباح الثالث: سعرُ وحدةٍ من الفواتير يخالف كلفةَ الكتالوج أضعافاً (٢٢ نوفمبر ٢٠٢٦).
--
-- عبوةٌ كُتبت خطأً (ماءُ أوسكا «330*24 مل» ← ٣٣٠ × ٢٤ قارورة) تُصغّر تكلفةَ ما بِيع منه في «الربح»
-- بالنسبة نفسها. حسابُها يقرأ بنودَ الفواتير كلَّها فلا يجري مع كلّ صفحة: يجري صباحاً ويُحفظ صفّاً
-- في `daily_checks` تقرؤه «يحتاج قرارك». إضافةٌ خالصة: قيمةٌ جديدة في القيد، والقديمتان كما هما.

alter table daily_checks drop constraint if exists daily_checks_kind_check;
alter table daily_checks add constraint daily_checks_kind_check check (kind in ('SEAL_DRIFT', 'AI_BALANCE', 'UNIT_COST'));
