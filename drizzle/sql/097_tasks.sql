-- 097 — قائمةُ المهام والتذكيرات: ما على الفريق أن يفعله ومتى.
--
-- صفٌّ لكلّ مهمّةٍ يكتبها إنسان: عنوانٌ وموعدٌ اختياريّ (`due_on`) وتذكيرٌ اختياريّ
-- (`remind_on`) وتكرارٌ (يوميّ · أسبوعيّ · شهريّ). تُغلَق بـ`closed_at` وسببِه
-- (`outcome`: أُنجزت · أُسقطت) فلا حذفَ، وتُعاد بالتراجع. والمكرَّرةُ تلد تاليتَها عند
-- إنجازها (`successor_id`) فيُمسَح التاليةَ إن نُقض الإنجاز.
-- لا مالَ فيها، والتواريخُ نصٌّ YYYY-MM-DD بتوقيت الرياض كما في `obligations`.
--
-- جدولٌ جديد: إضافةٌ خالصة، والشيفرةُ القديمة لا تعرفه.

create table if not exists tasks (
  id            text primary key,
  title         text not null check (length(btrim(title)) between 2 and 160),
  note          text check (note is null or length(note) <= 1000),
  priority      text not null default 'NORMAL' check (priority in ('NORMAL', 'HIGH')),
  due_on        text check (due_on is null or due_on ~ '^\d{4}-\d{2}-\d{2}$'),
  remind_on     text check (remind_on is null or remind_on ~ '^\d{4}-\d{2}-\d{2}$'),
  repeat        text not null default 'NONE' check (repeat in ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY')),
  closed_at     timestamptz,
  closed_by_id  text references users(id),
  outcome       text check (outcome in ('DONE', 'DROPPED')),
  successor_id  text references tasks(id) on delete set null,
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- التكرارُ يحتاج موعداً يُبنى عليه التالي
  constraint tasks_repeat_needs_due_check check (repeat = 'NONE' or due_on is not null),
  -- المغلقةُ لها سببُها، والمفتوحةُ بلا سبب
  constraint tasks_closed_outcome_check check ((closed_at is null) = (outcome is null))
);

create index if not exists tasks_open_due_idx on tasks (due_on) where closed_at is null;
