-- 098 — «TPH Team»: رابطُ الموظّف الواحد يسجّل حضورَه، ويصوّر الفواتير، ويرسل للإدارة.
--
-- ١) صورُ الفواتير من رابط الموظّف تُنسب إليه: `capture_links.employee_id`. رابطُ تصويرٍ
--    واحدٌ قائم لكلّ موظّف، بلا رمزٍ خاصّ به — رمزُه رمزُ حضوره (`employees.checkin_token_hash`)،
--    فيُلغى بإلغائه ويتجدّد بتجدّده. فصار `token_hash` يُترك فارغاً لهذه الروابط وحدها.
-- ٢) اقتراحاتُ الفريق وشكاواه: `team_messages`. المرسَلةُ بلا اسمٍ لا يُحفظ معها الموظّف أصلاً
--    (`employee_id` فارغ) — لا «مخفيّ عن المدير» يبقى في القاعدة.
--
-- إضافةٌ خالصة: الشيفرةُ القديمة تكتب `token_hash` دائماً ولا تعرف العمودَ ولا الجدول.

alter table capture_links add column if not exists employee_id text references employees(id) on delete set null;
alter table capture_links alter column token_hash drop not null;
alter table capture_links drop constraint if exists capture_links_key_check;
alter table capture_links add constraint capture_links_key_check check (token_hash is not null or employee_id is not null);
create unique index if not exists capture_links_employee_live_idx on capture_links (employee_id) where employee_id is not null and revoked_at is null;

create table if not exists team_messages (
  id            text primary key,
  employee_id   text references employees(id) on delete set null,
  kind          text not null check (kind in ('SUGGESTION', 'COMPLAINT', 'OTHER')),
  body          text not null check (length(btrim(body)) between 3 and 2000),
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  read_by_id    text references users(id),
  reply         text check (reply is null or length(btrim(reply)) between 1 and 1000),
  replied_at    timestamptz,
  replied_by_id text references users(id),
  closed_at     timestamptz,
  closed_by_id  text references users(id),
  -- الردُّ له وقتُه، ولا وقتَ بلا ردّ
  constraint team_messages_reply_pair_check check ((reply is null) = (replied_at is null))
);

create index if not exists team_messages_unread_idx on team_messages (created_at) where read_at is null;
create index if not exists team_messages_employee_idx on team_messages (employee_id, created_at desc) where employee_id is not null;
