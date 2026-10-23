-- 085 — الخصمُ بلوائح السعوديّة: جدولُ المخالفات والجزاءات في لائحة تنظيم العمل النموذجيّة.
--
-- أحمد (٢٣ أكتوبر ٢٠٢٦): «الخصم يكون بناءً على لوائح السعوديّة».
--
-- الجزاءُ يُحسب ولا يُخزَّن (`lib/payroll/saudi-rules.ts`): بنده من مدّة التأخير أو الغياب، ومرّتُه من
-- السجلّ خلال ١٨٠ يوماً، ومبلغُه من الأجر اليوميّ، وحدودُه من نظام العمل. فما يُخزَّن هنا وقائعُ وحدها:
--   payroll_attendance.disrupted       — التأخيرُ عطّل عمّالاً آخرين (بندٌ أشدّ في الجدول)
--   payroll_attendance.penalty_waived  — عفا صاحبُ العمل عن جزائه (يُحسم أجرُ الوقت ولا جزاء، ولا يُعدّ تكراراً)
--   payroll_violations                 — مخالفةٌ من بقيّة الجدول يسجّلها بيده (التلاعب في الحضور، التعليمات الصحّيّة…)
--
-- إضافةٌ خالصة.

alter table payroll_attendance add column if not exists disrupted boolean not null default false;
alter table payroll_attendance add column if not exists penalty_waived boolean not null default false;

create table if not exists payroll_violations (
  id            text primary key,
  employee_id   text not null references employees(id) on delete cascade,
  day           text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  -- رقمُ البند في جدول اللائحة (٢/٧ · ٣/٤ …)
  code          text not null check (code ~ '^[1-3]/[0-9]{1,2}$'),
  note          text check (note is null or length(note) <= 300),
  waived        boolean not null default false,
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  voided_by_id  text references users(id)
);
create index if not exists payroll_violations_employee_idx on payroll_violations (employee_id, day) where voided_at is null;
