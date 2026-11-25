-- 117 — التنبّؤ: صفحةٌ منعزلة تعرض المتوقَّع ولا تقرّر شيئاً (أحمد، ٢٥ نوفمبر ٢٠٢٦).
--
-- «التنبّؤ مجرد صفحة إضافية وليست من أساس العمل ولا تقوم باتخاذ أي قرار بل فقط تعطيني
-- صور للمتوقع». فجداولُه هنا وحدها: لا يقرؤها حسابُ مال ولا جرد ولا مطابقة، ولا تكتب
-- إلّا في نفسها. يكتبها المحرّك الليليّ (`forecast/` — Python على GitHub Actions) عبر
-- `/api/cron/forecast` وحده، ويكتب الإنسانُ `forecast_events` من الصفحة.
--
-- المالُ هللاتٌ والكمّيّةُ مِلّي، أعداداً صحيحة (bigint). والمتوقَّعُ ثلاثُ نقاط:
-- p10 · p50 · p90 — مدىً لا رقمٌ واحد.
--
-- جداولُ جديدة: إضافةٌ خالصة، والشيفرةُ القديمة لا تعرفها.

create table if not exists forecast_runs (
  id             text primary key,
  -- يومُ الرياض الذي صدر فيه التنبّؤ؛ وأوّلُ يومٍ متوقَّع هو هذا اليوم نفسه
  issued_on      text not null check (issued_on ~ '^\d{4}-\d{2}-\d{2}$'),
  history_from   text not null check (history_from ~ '^\d{4}-\d{2}-\d{2}$'),
  history_to     text not null check (history_to ~ '^\d{4}-\d{2}-\d{2}$'),
  engine_version text not null,
  -- النماذجُ التي شاركت وأوزانُها، ومصادرُ المتغيّرات وما تعذّر منها
  models         jsonb not null default '{}'::jsonb,
  -- خلاصةُ الاختبار الرجوعيّ (الخطأ بحسب المدى) — للعرض
  summary        jsonb not null default '{}'::jsonb,
  duration_ms    integer check (duration_ms is null or duration_ms >= 0),
  created_at     timestamptz not null default now(),
  constraint forecast_runs_history_check check (history_from <= history_to)
);
create index if not exists forecast_runs_issued_idx on forecast_runs (issued_on desc, created_at desc);

create table if not exists forecast_points (
  run_id  text not null references forecast_runs(id) on delete cascade,
  -- 'total' أو 'item:<pos_product_id>'
  series  text not null check (series = 'total' or series ~ '^item:.+'),
  metric  text not null check (metric in ('NET_MINOR', 'ORDERS', 'QTY_MILLI')),
  day     text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  -- ساعةُ الرياض 0–23، أو NULL لليوم كلّه
  hour    smallint check (hour is null or hour between 0 and 23),
  p10     bigint not null check (p10 >= 0),
  p50     bigint not null,
  p90     bigint not null,
  constraint forecast_points_order_check check (p10 <= p50 and p50 <= p90)
);
create unique index if not exists forecast_points_uniq
  on forecast_points (run_id, series, metric, day, coalesce(hour, -1));
create index if not exists forecast_points_day_idx on forecast_points (series, metric, day) where hour is null;

-- ما يعرفه المحرّك عن كلّ يومٍ متوقَّع: الطقسُ والتقويمُ وأثرُ كلٍّ — «لماذا هذا الرقم؟»
create table if not exists forecast_day_context (
  run_id  text not null references forecast_runs(id) on delete cascade,
  day     text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  context jsonb not null,
  primary key (run_id, day)
);

-- الاختبارُ الرجوعيّ: كم أخطأ كلُّ نموذجٍ لو تنبّأ في الماضي بما لم يره
create table if not exists forecast_backtests (
  run_id      text not null references forecast_runs(id) on delete cascade,
  model       text not null,
  series      text not null,
  metric      text not null check (metric in ('NET_MINOR', 'ORDERS', 'QTY_MILLI')),
  horizon     text not null check (horizon in ('D1', 'D2_7', 'D8_31', 'H_D1')),
  -- نِسَبٌ بالنقطة الأساس (١٠٠٠٠ = ١٠٠٪) — أعدادٌ صحيحة
  wape_bp     integer not null check (wape_bp >= 0),
  bias_bp     integer not null,
  coverage_bp integer check (coverage_bp is null or coverage_bp between 0 and 10000),
  n           integer not null check (n > 0),
  primary key (run_id, model, series, metric, horizon)
);

-- ما يعرفه أحمد ولا تعرفه البيانات: فعاليّة · عرض · إغلاق · نفادُ صنف
create table if not exists forecast_events (
  id             text primary key,
  kind           text not null check (kind in ('EVENT', 'PROMO', 'CLOSED', 'STOCKOUT', 'OTHER')),
  label          text not null check (length(btrim(label)) between 2 and 120),
  from_day       text not null check (from_day ~ '^\d{4}-\d{2}-\d{2}$'),
  to_day         text not null check (to_day ~ '^\d{4}-\d{2}-\d{2}$'),
  -- النفادُ لصنفٍ ومن ساعةٍ: ما بيع بعدها ليس الطلبَ الحقيقيّ
  pos_product_id text references pos_products(id) on delete set null,
  from_hour      smallint check (from_hour is null or from_hour between 0 and 23),
  created_by_id  text references users(id),
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  constraint forecast_events_range_check check (from_day <= to_day),
  constraint forecast_events_stockout_check check (kind <> 'STOCKOUT' or pos_product_id is not null)
);
create index if not exists forecast_events_open_idx on forecast_events (from_day) where voided_at is null;
