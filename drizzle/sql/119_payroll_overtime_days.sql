-- 119 — العملُ الإضافيّ يوماً بيوم (أحمد، ٢٧ نوفمبر ٢٠٢٦: «يقترحه التطبيق من تسجيل الحضور وأنا أقرّه»).
--
-- ما أقرّه المالك يبقى بنداً «عمل إضافي» في `payroll_adjustments` كما كان، ومعه يومُه ودقائقُه، فيُعرف
-- أيُّ يومٍ حُسب ولا يُحسب مرّتين (فهرسٌ فريد على الموظّف واليوم لما لم يُسحب). إضافةٌ خالصة: أعمدةٌ تقبل الفراغ،
-- والبنودُ القديمة بلا يوم.

alter table payroll_adjustments add column if not exists work_day text
  check (work_day is null or work_day ~ '^\d{4}-\d{2}-\d{2}$');
alter table payroll_adjustments add column if not exists minutes integer
  check (minutes is null or minutes between 1 and 960);
alter table payroll_adjustments drop constraint if exists payroll_adjustments_work_day_kind_check;
alter table payroll_adjustments add constraint payroll_adjustments_work_day_kind_check
  check (work_day is null or kind = 'OVERTIME');

create unique index if not exists payroll_adjustments_overtime_day_uq
  on payroll_adjustments (employee_id, work_day)
  where work_day is not null and voided_at is null;
