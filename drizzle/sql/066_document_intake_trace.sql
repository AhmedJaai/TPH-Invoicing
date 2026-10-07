-- 066 — أثرُ دخول المستند: من أين جاء، ولماذا لم يُقرأ، ونسخةُ ماذا هو.
--
-- المزامنةُ كانت تنسى ثلاثة أشياء:
--   ١. سببَ فشل القراءة — يظهر مرّةً في ردّ المزامنة ثمّ يضيع، فيقول ملفُّ المستند
--      «لم يُقرأ» ولا يقول لماذا، ولا يُعرف كم مرّةً حُووِل.
--   ٢. النسخةَ المعروفة بالبصمة — لا صفَّ لها، فتُعدّ «ملفّاً جديداً» في كلّ مزامنة،
--      ونسخةُ ما رُفع من التطبيق تُقرأ بالذكاء وتُدفع كلَّ مرّة.
--   ٣. من وضع الملفّ ومتى — يُنسب إلى من فتح المتصفّح، و«وصل» وقتُ المزامنة.
-- والتسميةُ تكتب فوق `file_name` فيضيع الاسمُ الذي وصل به الملفّ.
--
-- أعمدةٌ جديدة تقبل الفراغ (وعدّادٌ افتراضيُّه صفر) وفهرس: إضافةٌ آمنةٌ للشيفرة القديمة.
alter table documents add column if not exists read_attempts integer not null default 0;
alter table documents add column if not exists last_read_error text;
alter table documents add column if not exists last_read_at timestamptz;

-- الاسمُ يوم وصل — يُملأ مرّةً ولا يُكتب فوقه.
alter table documents add column if not exists original_file_name text;

-- بابُ الدخول: UPLOAD (رفعٌ من التطبيق) · DRIVE_SYNC (وُجد في الدرايف). والفراغ: ما سبق العمود.
alter table documents add column if not exists source text;
alter table documents add column if not exists drive_created_at timestamptz;
alter table documents add column if not exists drive_modified_by text;

-- المرفوضُ بسببه: «نسخةٌ من …» أو «رُفع ولم يُقيَّد».
alter table documents add column if not exists status_note text;
alter table documents add column if not exists duplicate_of_id text references documents(id) on delete set null;

-- يُسأل `drive_md5 = ?` قبل كلّ رفع وفي كلّ مزامنة — وكان مسحاً للجدول كلّه.
create index if not exists documents_drive_md5_idx on documents (drive_md5) where drive_md5 is not null;
