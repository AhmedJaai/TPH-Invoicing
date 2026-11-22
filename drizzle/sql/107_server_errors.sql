-- 107 — أعطابُ الخادم تبقى بعد ساعة (١٦ نوفمبر ٢٠٢٦، مراجعة المعمارية).
--
-- كان العطبُ يُكتب سطراً في سجلّ Vercel وحده، والسجلُّ يُحفظ ساعةً على خطّة Hobby: صفحةٌ تسقط
-- ليلاً لا أثرَ لها صباحاً، والمرجعُ الذي تعطيه الشاشةُ («اذكر المرجع ab12cd34») لا يُقرأ بعده.
-- فصار لكلّ عطبٍ صفٌّ بمفتاحٍ من مساره ونوعه ورسالته: يتكرّر فيزيد عدّه ويُحدَّث آخرُ ظهوره،
-- فلا يكبر الجدولُ بتكراره. والرسالةُ مقصوصةٌ بـ`describeError` (بلا قيم الإدخال ولا `params:`).
-- إضافةٌ خالصة.

create table if not exists server_errors (
  fingerprint  text primary key,
  -- REQUEST: ما التقطه `onRequestError` (صفحةٌ أو مسارٌ سقط) · ROUTE: ما ختمه `failWith` بـ500 ومرجع
  source       text not null check (source in ('REQUEST', 'ROUTE')),
  route        text,
  method       text,
  name         text,
  code         text,
  message      text not null,
  stack        text,
  last_ref     text,
  last_digest  text,
  occurrences  integer not null default 1 check (occurrences > 0),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);

create index if not exists server_errors_last_seen_idx on server_errors (last_seen desc);
