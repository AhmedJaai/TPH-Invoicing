-- 100 — «TPH Team»: المرجعُ وطلباتُ الموظّف.
--
-- ١) `team_board`: مرجعٌ يكتبه صاحبُ المقهى ويقرؤه الفريق — لا مهامّ ولا «تم» ولا متابعة:
--    النظافةُ اليوميّة والأسبوعيّة (بيومها)، والطحنات، والوصفات، والبنُّ الحالي وقصّتُه، والإعلانات.
--    والسطرُ يُؤرشَف ولا يُحذف، وكلُّ تعديلٍ في سجلّ التدقيق.
-- ٢) `team_requests`: ما يطلبه الموظّف ويقرّره صاحبُ المقهى — اقتراحُ تعديلٍ على بطاقةٍ من المرجع،
--    وإجازة، وتبديلُ وردية، وتالفٌ أو ضائع. لا يُكتب شيءٌ في المرجع ولا في الدوام ولا في الجرد إلّا
--    بإقراره (`status` APPROVED)، والمرفوضُ يبقى بسببه.
-- إضافةٌ خالصة.

create table if not exists team_board (
  id            text primary key,
  kind          text not null check (kind in ('CLEANING_DAILY', 'CLEANING_WEEKLY', 'GRIND', 'RECIPE', 'BEAN', 'ANNOUNCEMENT')),
  title         text not null check (length(btrim(title)) between 2 and 120),
  body          text not null default '' check (length(body) <= 4000),
  -- للنظافة الأسبوعيّة: يومُها (٠ الأحد … ٦ السبت)
  weekday       smallint check (weekday between 0 and 6),
  sort          integer not null default 0,
  archived_at   timestamptz,
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint team_board_weekly_day_check check (weekday is null or kind = 'CLEANING_WEEKLY')
);
create index if not exists team_board_live_idx on team_board (kind, sort) where archived_at is null;

create table if not exists team_requests (
  id             text primary key,
  employee_id    text not null references employees(id) on delete cascade,
  kind           text not null check (kind in ('BOARD_EDIT', 'LEAVE', 'SWAP', 'WASTE')),
  -- اقتراحُ التعديل: البطاقةُ ونصُّها المقترح
  board_id       text references team_board(id) on delete set null,
  proposed_title text check (proposed_title is null or length(proposed_title) <= 120),
  proposed_body  text check (proposed_body is null or length(proposed_body) <= 4000),
  -- الإجازةُ والتبديل: من يوم إلى يوم، ومع من
  from_day       text check (from_day is null or from_day ~ '^\d{4}-\d{2}-\d{2}$'),
  to_day         text check (to_day is null or to_day ~ '^\d{4}-\d{2}-\d{2}$'),
  with_employee_id text references employees(id) on delete set null,
  -- التالف: الصنفُ وكمّيّتُه بالمِلّي ووحدتُه وسببُه
  product_id     text references products(id),
  quantity_milli bigint check (quantity_milli is null or quantity_milli > 0),
  unit           text,
  waste_reason   text,
  note           text check (note is null or length(note) <= 1000),
  status         text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  decided_by_id  text references users(id),
  decided_at     timestamptz,
  decision_note  text check (decision_note is null or length(decision_note) <= 500),
  created_at     timestamptz not null default now(),
  constraint team_requests_decided_check check ((status in ('PENDING', 'WITHDRAWN')) = (decided_at is null)),
  constraint team_requests_shape_check check (
    (kind = 'BOARD_EDIT' and board_id is not null and proposed_body is not null) or
    (kind in ('LEAVE', 'SWAP') and from_day is not null) or
    (kind = 'WASTE' and product_id is not null and quantity_milli is not null and unit is not null and waste_reason is not null) or
    (kind = 'BOARD_EDIT' and board_id is null and status <> 'PENDING')
  )
);
create index if not exists team_requests_pending_idx on team_requests (created_at) where status = 'PENDING';
create index if not exists team_requests_employee_idx on team_requests (employee_id, created_at desc);
