-- 106 — دوامُ الموظّف يتغيّر من تاريخ (أحمد، ٢١ نوفمبر ٢٠٢٦: «إذا تغيّر وقت عمل موظف أقدر أغيّر
-- وقت عمله نافذاً من التاريخ المحدّد»).
--
-- كان الدوامُ (`employees.shift_start` · `shift_minutes` · `days_off` وأيّامُ الأسبوع في `employee_shifts`)
-- يُكتب فوق ما قبله، فيُحكم على كلّ يومٍ بآخر دوامٍ كُتب. فصار لكلّ تغييرٍ سطرٌ يسري من يومه:
-- البدايةُ وطولُها وأيّامُ الراحة ووقتُ أيّام الأسبوع المخصّصة (`week`). ودوامُ اليوم = آخرُ سطرٍ
-- بدأ فيه أو قبله، ويومٌ بعينه في `employee_shifts` يغلبه (`lib/payroll/attendance.ts` · `shiftOn`).
-- وأوّلُ تغييرٍ بتاريخٍ يحفظ الدوامَ السابق سطراً من يوم المباشرة، فلا يتبدّل حكمُ ما مضى.
-- إضافةٌ خالصة: بلا سطورٍ يبقى الحكمُ بأعمدة `employees` كما كان.

create table if not exists employee_shift_plans (
  id            text primary key,
  employee_id   text not null references employees(id) on delete cascade,
  from_day      text not null check (from_day ~ '^\d{4}-\d{2}-\d{2}$'),
  shift_start   text check (shift_start is null or shift_start ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  shift_minutes integer not null check (shift_minutes between 60 and 960),
  days_off      text not null default '' check (days_off ~ '^[0-6]{0,7}$'),
  -- [{ "weekday": 0..6, "shiftStart": "HH:MM", "shiftMinutes": 60..960 }]
  week          jsonb not null default '[]'::jsonb check (jsonb_typeof(week) = 'array'),
  created_by_id text references users(id),
  created_at    timestamptz not null default now()
);

create unique index if not exists employee_shift_plans_from_idx on employee_shift_plans (employee_id, from_day);
