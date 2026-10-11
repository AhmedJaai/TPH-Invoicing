-- 078 — مفتاحُ الملاحظة المحسوبة يُقبَل: 077 وسّعت القرارَ وبقي قيدُ المفتاح يردّه.
--
-- قيدُ المفتاح (034) كُتب لقرارات الازدواج: `بادئة:جزء:جزء` — بادئةٌ من حروفٍ وحدها
-- وجزءان على الأقلّ. ومفاتيحُ `/api/signal` غيرُ ذلك: `pos-missing:2026-10-01`
-- (شرطةٌ في البادئة، وجزءٌ واحد) و`foodics-purchase:inv-…`. فبقي «أسكِتها» يُردّ بـ٥٠٠
-- بعد 077 — أُصلح قيدٌ ولم يُجرَّب الإدخالُ نفسُه. يُوسَّع بصيغة المسار بعينها
-- (`KEY_RE` في `lib/signal-decisions.ts`)، والصيغةُ القديمة باقيةٌ كما هي.
--
-- توسيعُ قيدٍ إضافةٌ آمنة: كلُّ صفٍّ قائمٍ يوافقه.
ALTER TABLE alert_resolutions DROP CONSTRAINT IF EXISTS alert_resolutions_key_chk;
ALTER TABLE alert_resolutions ADD CONSTRAINT alert_resolutions_key_chk
  CHECK (
    key ~ '^[a-z]+:[A-Za-z0-9_-]+(:[A-Za-z0-9_-]+)+$'
    OR key ~ '^[a-z-]{3,24}:[^[:space:]]{1,160}$'
  );
