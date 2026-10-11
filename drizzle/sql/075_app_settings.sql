-- 075 — إعداداتٌ يكتبها صاحبُ المقهى: أوّلُها أرضيّةُ النقد.
--
-- ما يضبطه صاحبُ المقهى مرّةً ويقرؤه الحساب: أوّلُه «حدُّ الرصيد الأدنى» الذي يُنبَّه
-- حين ينزل «النقد القادم» تحته (`cash_floor_minor`). مفتاحٌ وقيمةٌ نصّيّة يفحصها
-- الخادمُ عند القراءة والكتابة؛ وغيابُ الصفّ «لم يُضبط» — لا حدَّ مفترَضاً ولا صفر.
--
-- جدولٌ جديد: إضافةٌ خالصة، والشيفرةُ القديمة لا تعرفه.

create table if not exists app_settings (
  key           text primary key,
  value         text not null,
  updated_by_id text references users(id),
  updated_at    timestamptz not null default now()
);
