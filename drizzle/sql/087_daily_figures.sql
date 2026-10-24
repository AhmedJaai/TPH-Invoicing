-- 087 — لقطةُ اليوم: أرقامُ الصباح تُحفظ مرّةً لكلّ يومٍ بتوقيت الرياض.
--
-- «منذ أمس» يحتاج ماضياً لا يُعاد حسابُه من دفاترٍ تغيّرت بعده. فيُحفَظ كلَّ صباح:
-- «عليك للمورّدين»، وعددُ بنود «يحتاج قرارك»، وآخرُ رصيدٍ ختاميٍّ معروف (NULL حين لا يُعرف — لا صفر).
-- والكتابةُ `on conflict (day) do nothing`: التشغيلُ مرّتين في اليوم لا يغيّر لقطته.
--
-- إضافةٌ خالصة: جدولٌ جديد لا تقرؤه شيفرةٌ قديمة.

create table if not exists daily_figures (
  day text primary key check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  owed_minor integer not null,
  attention_count integer not null check (attention_count >= 0),
  cash_minor integer,
  cash_as_of text,
  written_at timestamptz not null default now()
);
