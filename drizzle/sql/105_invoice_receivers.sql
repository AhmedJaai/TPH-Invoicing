-- 105 — فواتيرُ الفريق تصل موظّفَ المشتريات في «TPH Team» (أحمد، ٨ نوفمبر ٢٠٢٦: «أي فاتورة تتصوّر
-- من أي موظف تروح لأنس… يشوفها عشان يدخلها في فودكس، ويجيه تنبيه»).
--
-- ١) `employees.invoices_since`: مَن يستلم الفواتير ومنذ متى — صلاحيةٌ يمنحها المالك، لا اسمٌ في الشيفرة.
--    وتصله الفواتيرُ من لحظة منحها لا قبلها: لا يُغرَق بمئةٍ وعشرين صورةً أُدخلت من قبل.
-- ٢) `captures.foodics_entered_at` · `foodics_entered_by`: أدخلها في فودكس — يعلّمها المستلمُ لنفسه.
-- ٣) `team_push_subscriptions`: جوالُ الموظّف المشترك في التنبيه. الإشعارُ نداءٌ فارغ، ونصُّه يُسأل
--    عنه برمز الرابط (`/api/team/push-brief`) — فلا اسمَ مورّدٍ ولا مبلغَ يمرّ بمزوّد الإشعار.
-- إضافةٌ خالصة.

alter table employees add column if not exists invoices_since timestamptz;

alter table captures add column if not exists foodics_entered_at timestamptz;
alter table captures add column if not exists foodics_entered_by text references employees(id) on delete set null;

create table if not exists team_push_subscriptions (
  id           text primary key,
  employee_id  text not null references employees(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  failures     integer not null default 0,
  last_error   text
);
create index if not exists team_push_subscriptions_employee_idx on team_push_subscriptions (employee_id);
