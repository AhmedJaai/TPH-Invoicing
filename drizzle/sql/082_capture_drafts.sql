-- 082 — صورةُ الباريستا تُرفع مرّةً واحدة.
--
-- كان «افحص الوضوح» يرفع الصورة ثمّ «أرسل» يرفعها ثانيةً، والرفعُ من جوال المقهى
-- هو أكثرُ الإرسال (قيس في الإنتاج: ٢٫٧ ثانية لـ٣١١ ك.ب و٨٫٨ لـ٨٠٨ ك.ب). فالفحصُ
-- يحفظ الصورةَ مسودّةً (DRAFT)، والإرسالُ يقلبها «تنتظر» (PENDING) بمعرّفها.
--
-- المسودّةُ ليست شيئاً أُرسل: لا تظهر لصاحب العمل ولا تُعدّ في «ما أرسلته»، ولا تمنع
-- إرسالَ الصورة نفسها. وما لم يُرسَل منها بعد يومٍ يُمحى (صورةٌ تُركت، لا مستندٌ ولا مال).
--
-- إضافةٌ خالصة: حالٌ جديدة لا يكتبها إلّا الكودُ الجديد.

alter table captures drop constraint if exists captures_status_check;
alter table captures add constraint captures_status_check
  check (status in ('DRAFT', 'PENDING', 'ARCHIVED', 'REJECTED'));

-- المسودّةُ كالمنتظِرة: لها ملفّ، ولا قرارَ فيها بعد
alter table captures drop constraint if exists captures_check;
alter table captures add constraint captures_file_while_open_check
  check (status not in ('DRAFT', 'PENDING') or file_data is not null);

alter table captures drop constraint if exists captures_check2;
alter table captures add constraint captures_decided_check
  check (status in ('DRAFT', 'PENDING') or decided_at is not null);

-- محوُ ما تُرك من المسودّات يمرّ بهذا الفهرس، لا بالجدول كلّه
create index if not exists captures_drafts_idx on captures (created_at) where status = 'DRAFT';
