-- ═══════════════════════════════════════════════════════════════
-- ما قرأه النموذج يحفظه الخادم — لا يأتي من المتصفّح
--
-- الأرشفة كانت تبني أسطر الكشف ورصيده و«ما عُدِّل يدوياً» من
-- `rawExtraction` الذي يرسله المتصفّح. والآن يُحفظ مخرَج القراءة في
-- `/api/analyze` ببصمة الملفّ، ويُقرأ عند الأرشفة ببصمة ما رُفع فعلاً.
-- جدولٌ جديد فارغ — لا يمسّ بياناً قائماً.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS extraction_cache (
  sha256     text PRIMARY KEY,
  extraction jsonb NOT NULL,
  model      text,
  user_id    text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
