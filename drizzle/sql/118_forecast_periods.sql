-- 118 — التوقّع بالأشهر: كم يُقفل هذا الشهر، والذي بعده، وحتى نهاية السنة القادمة (أحمد، ٢٦ نوفمبر ٢٠٢٦).
--
-- لكلّ شهرٍ مجموعُ المتوقَّع من `from_day` إلى آخره (ما قبله من الشهر الجاري واقعٌ يضيفه التطبيق من فودكس).
-- p10 · p50 · p90 هللاتٌ أو طلباتٌ صحيحة. و`meta`: مصدرُ الرقم (يوميّ · بنيويّ)، وما فيه بلا مثالٍ سابق
-- (رمضان · عيد الفطر)، ووسومُه. جدولٌ جديد منعزلٌ كبقيّة `forecast_*`: إضافةٌ خالصة.

create table if not exists forecast_periods (
  run_id   text not null references forecast_runs(id) on delete cascade,
  period   text not null check (period ~ '^\d{4}-\d{2}$'),
  metric   text not null check (metric in ('NET_MINOR', 'ORDERS')),
  from_day text not null check (from_day ~ '^\d{4}-\d{2}-\d{2}$' and left(from_day, 7) = period),
  days     smallint not null check (days between 1 and 31),
  p10      bigint not null check (p10 >= 0),
  p50      bigint not null,
  p90      bigint not null,
  meta     jsonb not null default '{}'::jsonb,
  primary key (run_id, period, metric),
  constraint forecast_periods_order_check check (p10 <= p50 and p50 <= p90)
);
