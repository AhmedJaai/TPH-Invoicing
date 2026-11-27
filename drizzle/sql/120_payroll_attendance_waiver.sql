-- 120 — الإعفاءُ الكامل من خصم يوم (أحمد، ٢٧ نوفمبر ٢٠٢٦: «اعفاء جماعي عن كل التأخيرات هذا الشهر،
-- ولكن يُكتب في القسيمة كم الخصم وكم كان سيصل وأنّه أُعفي»).
--
-- يبقى البندُ قائماً (لا يُلغى) فيُعرف ما كان، ولا يُحسم منه شيء: أجرُ الوقت ولا الجزاء. ويُحفظ ما كان
-- سيُحسم لحظةَ الإعفاء (أجرُ الوقت · الجزاء) ليُقال للموظّف، وحالُ العفو عن الجزاء قبله ليعود إن سُحب
-- الإعفاء. إضافةٌ خالصة: أعمدةٌ تقبل الفراغ.

alter table payroll_attendance add column if not exists waived_at timestamptz;
alter table payroll_attendance add column if not exists waived_by_id text references users(id);
alter table payroll_attendance add column if not exists waived_wage_minor integer check (waived_wage_minor is null or waived_wage_minor >= 0);
alter table payroll_attendance add column if not exists waived_penalty_minor integer check (waived_penalty_minor is null or waived_penalty_minor >= 0);
alter table payroll_attendance add column if not exists waived_prev_penalty boolean;
alter table payroll_attendance drop constraint if exists payroll_attendance_waiver_check;
alter table payroll_attendance add constraint payroll_attendance_waiver_check
  check ((waived_at is null) = (waived_wage_minor is null) and (waived_at is null) = (waived_penalty_minor is null));
