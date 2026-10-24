-- 089 — ختمُ أرقام الشهر عند إقفاله، وفحصُ الصباح يقارنها بالآن.
--
-- الإقفالُ شهادة، والشهادةُ بلا أرقامها لا تُقارَن بشيء: «عليك للمورّدين في آخر الشهر»
-- ورصيدُ ختام كلّ حساب ووارده وصادره وضريبتا المخرجات والمدخلات تُكتب لحظةَ الإقفال
-- (`month_seals`) بالخدمات التي ترسم الشاشات. وإعادةُ الإقفال بعد فتحٍ تكتب ختماً جديداً:
-- لا تعديلَ ولا حذف — مؤثِّرٌ يرفضهما.
--
-- وفحصُ الصباح (`/api/cron/daily`) يعيد الحساب لكلّ شهرٍ مقفل ويكتب ما اختلف، ورصيدَ
-- القراءة الذكيّة، صفّاً في `daily_checks` تقرؤه «يحتاج قرارك» — فلا يُعاد الحسابُ مع كلّ صفحة.
--
-- إضافةٌ خالصة: جدولان جديدان لا تقرؤهما شيفرةٌ قديمة.

create table if not exists month_seals (
  id text primary key,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  -- CLOSE: كُتب لحظةَ الإقفال. BACKFILL: شهرٌ أُقفل قبل الختم، خُتم عند أوّل فحصٍ بعده.
  origin text not null check (origin in ('CLOSE', 'BACKFILL')),
  figures jsonb not null,
  sealed_at timestamptz not null default now(),
  sealed_by_id text references users(id)
);

create index if not exists month_seals_month_idx on month_seals (month, sealed_at desc);

create or replace function reject_month_seal_change() returns trigger as $$
begin
  raise exception 'أرقام الشهر المختومة لا تُعدَّل ولا تُحذف — إعادة الإقفال تكتب ختماً جديداً'
    using errcode = 'P0001';
end;
$$ language plpgsql;

drop trigger if exists month_seals_append_only on month_seals;
create trigger month_seals_append_only
  before update or delete on month_seals
  for each row execute function reject_month_seal_change();

create table if not exists daily_checks (
  id text primary key,
  kind text not null check (kind in ('SEAL_DRIFT', 'AI_BALANCE')),
  checked_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists daily_checks_kind_idx on daily_checks (kind, checked_at desc);
