-- 046 — متى فُحص الدرايف آخرَ مرّة، وهل نجح الفحص.
--
-- المزامنةُ تجري وحدها كلَّ ثلاث ساعات، ولم يكن يُكتب أثرُها إلّا إن وجدت
-- جديداً (`DRIVE_SYNCED`). فإن مرّ أسبوعٌ بلا ملفٍّ جديد لم يُعرف: أتعمل
-- المزامنة ولا جديد، أم توقّفت منذ أسبوع؟ وسؤالُ «هل صارت تلقائية؟» بلا
-- جوابٍ من الشاشة.
--
-- فيُكتب لكلّ مستخدمٍ (التفويضُ تفويضُه): آخرُ فحصٍ نجح، وآخرُ فحصٍ تعثّر
-- وسببُه. وحالُ الدرايف: أحدثُ الاثنين. أعمدةٌ تقبل الفراغ بلا قيمة
-- افتراضيّة — إضافةٌ آمنةٌ للشيفرة القديمة، والفراغُ «لم يُفحص بعد».
alter table users add column if not exists drive_checked_at timestamptz;
alter table users add column if not exists drive_failed_at timestamptz;
alter table users add column if not exists drive_failed_reason text;
