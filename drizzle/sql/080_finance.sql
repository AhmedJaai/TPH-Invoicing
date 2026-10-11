-- 080 — المساحةُ الماليّة: ما يقوله صاحبُ المقهى عمّا لا يراه الكشف، وتقريرُ الشهر المجمَّد،
-- وقراءةُ النموذج المحفوظة.
--
-- لا جدولَ هنا دفتر: لا يُنشأ منها مصروفٌ ولا دفعةٌ ولا يُعاد نسبُ مال. هي طبقةُ قراءةٍ
-- فوق الدفاتر القائمة:
--
--   finance_declarations — إقرارُ المالك: إيجارٌ دُفع مرّةً ويغطّي أشهراً (`SPREAD`)، أو
--     مصروفٌ خارج الكشف يتكرّر كلَّ شهر (`OFF_BOOK`: راتبٌ نقداً، إيجارٌ من حسابٍ شخصيّ)،
--     أو «لا يوجد» (`NONE`). يدخل قائمةَ الدخل باسمه «بإقرار المالك» ويُسحَب ولا يُحذَف.
--   finance_snapshots — قائمةُ دخل الشهر المقفل كما جُمِّدت: التقريرُ يُقرأ ولا يُعاد حسابُه.
--   finance_readings — ما كتبه النموذج عن الأرقام المحسوبة، مع مدخلاته وبصمتها؛ لا يُعاد
--     توليدُه عند كلّ فتح.
--
-- إضافةٌ خالصة.

create table if not exists finance_declarations (
  id                  text primary key,
  kind                text not null check (kind in ('SPREAD', 'OFF_BOOK', 'NONE')),
  category            text not null,
  label               text not null,
  -- SPREAD: المبلغُ كلُّه يُوزَّع على الأشهر · OFF_BOOK: مبلغُ الشهر الواحد · NONE: صفر
  amount_minor        integer not null check (amount_minor >= 0),
  from_month          text not null check (from_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  to_month            text not null check (to_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  bank_transaction_id text references bank_transactions(id) on delete set null,
  note                text,
  created_by_id       text references users(id),
  created_at          timestamptz not null default now(),
  voided_at           timestamptz,
  voided_by_id        text references users(id),
  check (from_month <= to_month),
  check (kind <> 'NONE' or amount_minor = 0),
  check (kind = 'NONE' or amount_minor > 0),
  check (kind <> 'SPREAD' or bank_transaction_id is not null)
);
create index if not exists finance_declarations_months_idx on finance_declarations (from_month, to_month) where voided_at is null;
-- حركةُ البنك تُوزَّع مرّةً واحدة
create unique index if not exists finance_declarations_spread_tx_idx on finance_declarations (bank_transaction_id) where voided_at is null and kind = 'SPREAD';

create table if not exists finance_snapshots (
  month        text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  payload      jsonb not null,
  frozen_at    timestamptz not null default now(),
  frozen_by_id text references users(id)
);

create table if not exists finance_readings (
  id          text primary key,
  scope       text not null,
  month       text not null,
  -- بصمةُ الأرقام التي أُعطيها النموذج: إن تغيّرت الأرقامُ قيل إنّ القراءةَ قديمة
  facts_hash  text not null,
  facts       jsonb not null,
  reading     jsonb not null,
  model       text not null,
  created_at  timestamptz not null default now(),
  created_by_id text references users(id)
);
create index if not exists finance_readings_scope_idx on finance_readings (scope, month, created_at desc);
