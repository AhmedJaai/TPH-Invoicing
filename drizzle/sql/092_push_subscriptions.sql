-- 092 — اشتراكاتُ إشعار الصباح: جهازٌ لكلّ صفّ، يُحذف إن قالت خدمةُ الإشعار إنّه زال.
--
-- يُكتب صفٌّ حين يضغط المستخدم «فعّل إشعار الصباح» في الإعدادات ويوافق المتصفّح،
-- ويُمحى حين يوقفه أو يردّ مزوّدُ الإشعار أنّ الاشتراك انتهى (404/410). ولا يُرسَل
-- فيه مال: الإشعارُ بلا محتوى، وعاملُ الخدمة يسأل الخادمَ بجلسة صاحبه عن نصّه.
--
-- خاملٌ ما لم يوجد `VAPID_PUBLIC_KEY` و`VAPID_PRIVATE_KEY` — لا يُكتب فيه شيء قبلهما.
-- إضافةٌ خالصة: جدولٌ جديد لا تقرؤه شيفرةٌ قديمة.

create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  -- عنوانُ مزوّد الإشعار (FCM · Apple · Mozilla · Windows) — يُقبل من قائمةٍ معروفة وحدها
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_error text,
  failures integer not null default 0 check (failures >= 0)
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
