-- 094 — «المستشار»: محادثاتُه، وخطّتُه التي يتابعها مع صاحب المقهى.
--
-- المستشارُ موظّفٌ يتذكّر: كلُّ محادثةٍ تُحفَظ برسائلها، وما اتّفقا عليه يُكتب بنداً
-- في الخطّة بأفقه (30 · 60 · 90 يوماً) ومؤشّره، فيسأل عنه في المرّة القادمة.
-- ولا مال هنا: النصائحُ نصّ، والأرقامُ تُحسَب من الدفاتر لحظةَ السؤال لا تُخزَّن رقماً
-- يُبنى عليه. و`verified` ما طابق من أرقام الجواب حقيقةً حسبها الخادم — للعرض وحده.
-- إضافةٌ خالصة: جداولُ جديدة لا تقرؤها شيفرةٌ قديمة.

create table if not exists advisor_threads (
  id            text primary key,
  title         text not null,
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists advisor_threads_updated_idx on advisor_threads (updated_at desc);

create table if not exists advisor_messages (
  id         text primary key,
  thread_id  text not null references advisor_threads(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (length(content) between 1 and 40000),
  -- أرقامُ الجواب التي طابقت حقيقةً: {"28.4": "تكلفة المبيعات من الإيراد"}
  verified   jsonb,
  -- ما راجعه قبل أن يجيب: [{"name": "month_pnl", "label": "ربح سبتمبر"}]
  tools      jsonb,
  model      text,
  created_at timestamptz not null default now()
);
create index if not exists advisor_messages_thread_idx on advisor_messages (thread_id, created_at);

create table if not exists advisor_plan_items (
  id            text primary key,
  title         text not null check (length(title) between 1 and 300),
  detail        text check (detail is null or length(detail) <= 2000),
  horizon_days  integer not null check (horizon_days in (30, 60, 90)),
  -- ما يُقاس به: «متوسط الطلب» — والرقمُ يُقرأ من الدفاتر حين يُسأل، لا يُخزَّن
  metric        text check (metric is null or length(metric) <= 200),
  status        text not null default 'OPEN' check (status in ('OPEN', 'DONE', 'DROPPED')),
  thread_id     text references advisor_threads(id) on delete set null,
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists advisor_plan_status_idx on advisor_plan_items (status, created_at);
