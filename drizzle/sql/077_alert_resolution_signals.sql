-- 077 — قرارُ «أسكِتها» و«ذكّرني بعد…» يُحفَظ فعلاً.
--
-- القيدُ (034، ثمّ 052) يحصر القرارَ في خمس قيم: قراراتُ الازدواج والارتداد. ومسارُ
-- الملاحظات المحسوبة (`/api/signal`: تسويةٌ لم تصل، رسمٌ ارتفع، متكرّرٌ غاب، وثيقةٌ تنتهي،
-- فروقُ فودكس) يكتب `DISMISSED` و`SNOOZED:YYYY-MM-DD` في الجدول نفسه — **فكان كلُّ ضغطٍ
-- على «أسكِتها» يُردّ بـ٥٠٠** منذ نُشرت تلك الأزرار، ولم يكشفه اختبار: لا اختبارَ قاعدةٍ
-- يمرّ بالمسار. يُوسَّع القيدُ بالصيغتين بعينهما، وما سواهما مرفوضٌ كما كان.
--
-- توسيعُ قيدٍ إضافةٌ آمنة: كلُّ صفٍّ قائمٍ يوافقه، والشيفرةُ القديمة لا تكتب الجديد.
ALTER TABLE alert_resolutions DROP CONSTRAINT IF EXISTS alert_resolutions_decision_chk;
ALTER TABLE alert_resolutions ADD CONSTRAINT alert_resolutions_decision_chk
  CHECK (
    decision IN ('CLAIMED', 'RECOVERED', 'NOT_DUPLICATE', 'BOUNCED', 'NOT_BOUNCE', 'DISMISSED')
    OR decision ~ '^SNOOZED:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  );
