-- 052 — قرارا «ارتدّت» و«ليست ردّاً» في `alert_resolutions`.
--
-- القيدُ (034) يحصر القرارَ في قرارات الازدواج الثلاثة؛ وقرارُ الحوالة المرتدّة
-- (`bank-bounce.service.ts`، مفتاح `bounce:`) يُحفظ في الجدول نفسه — فيُوسَّع
-- ولا يُرخى: قيمتان مسمّاتان تُضافان، وما سواهما مرفوضٌ كما كان.
--
-- توسيعُ قيدٍ إضافةٌ آمنة: كلُّ صفٍّ قائمٍ يوافقه، والشيفرةُ القديمة لا تكتب الجديد.
ALTER TABLE alert_resolutions DROP CONSTRAINT IF EXISTS alert_resolutions_decision_chk;
ALTER TABLE alert_resolutions ADD CONSTRAINT alert_resolutions_decision_chk
  CHECK (decision IN ('CLAIMED', 'RECOVERED', 'NOT_DUPLICATE', 'BOUNCED', 'NOT_BOUNCE'));
