-- 101 — تبديلُ الراحة لمرّةٍ أو دائماً (أحمد، ٨ نوفمبر ٢٠٢٦).
-- `permanent`: يتبادل الموظّفان يومَي راحتهما الأسبوعيّين (`employees.days_off`) من الإقرار فصاعداً؛
-- وبلاه تبديلٌ لمرّةٍ بالتاريخين (`from_day` · `to_day`). إضافةٌ خالصة.
alter table team_requests add column if not exists permanent boolean not null default false;
