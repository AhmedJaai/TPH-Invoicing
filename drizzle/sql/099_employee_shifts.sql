-- 099 — الدوامُ المخصَّص: وقتٌ لكلّ يومٍ من الأسبوع، وتغييرٌ ليومٍ بعينه.
--
-- أحمد (٧ نوفمبر ٢٠٢٦): «يومٌ يداوم ٣ ويومٌ ٤ ويومٌ ٣:٣٠ على حسب جدولٍ مخصّص». فالدوامُ الأصليّ
-- (`employees.shift_start` · `shift_minutes` · `days_off`) يبقى، وفوقه:
--   • سطرٌ لكلّ يومٍ من الأسبوع (`weekday` ٠ الأحد … ٦ السبت) بوقته وطوله؛
--   • وسطرٌ ليومٍ بعينه (`day`) بوقته، أو راحة (`off`).
-- واليومُ بعينه يغلب يومَ الأسبوع، ويومُ الأسبوع يغلب الأصل (`lib/payroll/attendance.ts` · `shiftOn`).
-- إضافةٌ خالصة.

create table if not exists employee_shifts (
  id            text primary key,
  employee_id   text not null references employees(id) on delete cascade,
  weekday       smallint check (weekday between 0 and 6),
  day           text check (day is null or day ~ '^\d{4}-\d{2}-\d{2}$'),
  shift_start   text check (shift_start is null or shift_start ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  shift_minutes integer check (shift_minutes is null or shift_minutes between 60 and 960),
  off           boolean not null default false,
  note          text check (note is null or length(note) <= 200),
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  -- يومُ أسبوعٍ أو يومٌ بعينه، لا الاثنان ولا لا شيء
  constraint employee_shifts_target_check check ((weekday is null) <> (day is null)),
  -- راحةٌ بلا وقت، أو وقتٌ بطوله
  constraint employee_shifts_time_check check (
    (off and shift_start is null and shift_minutes is null) or
    (not off and shift_start is not null and shift_minutes is not null)
  ),
  -- يومُ الأسبوع وقتٌ لا راحة: راحتُه في `employees.days_off`
  constraint employee_shifts_weekday_off_check check (weekday is null or not off)
);

create unique index if not exists employee_shifts_weekday_idx on employee_shifts (employee_id, weekday) where weekday is not null;
create unique index if not exists employee_shifts_day_idx on employee_shifts (employee_id, day) where day is not null;
