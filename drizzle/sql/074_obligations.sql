-- 074 — الوثائقُ والتراخيص: ما ينتهي ومتى، ومن جدّده.
--
-- متتبّعُ انتهاء الوثائق: السجلّ التجاريّ ورخصة البلديّة والدفاع المدنيّ والشهادات
-- الصحّيّة والإقامات وعقد الإيجار والتأمين. لم يكن في النظام تاريخُ انتهاءٍ واحد،
-- وغرامةُ رخصةٍ منتهية أغلى من أيّ خطأ فاتورة.
--
-- صفٌّ لكلّ وثيقةٍ يكتبه صاحبُ المقهى بيده: تاريخُ انتهائها (شرطٌ — لا وثيقةَ بلا
-- تاريخ) ومهلةُ التذكير قبله. و`closed_at` أرشفةٌ لا حذف (جُدِّدت بوثيقةٍ أخرى أو لم
-- تعد لازمة). لا مالَ فيه.
--
-- جدولٌ جديد: إضافةٌ خالصة، والشيفرةُ القديمة لا تعرفه.

create table if not exists obligations (
  id            text primary key,
  kind          text not null,
  title         text not null,
  issuer        text,
  reference     text,
  holder        text,
  expires_on    text not null,
  remind_days   integer not null default 30,
  note          text,
  closed_at     timestamptz,
  closed_by_id  text references users(id),
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists obligations_open_expiry_idx on obligations (expires_on) where closed_at is null;
