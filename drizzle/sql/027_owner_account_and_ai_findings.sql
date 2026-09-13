-- ═══════════════════════════════════════════════════════════════
-- ٠٢٧ · السدادُ من حساب المالك، واقتراحاتُ تحليل الذكاء
--
-- ── لماذا طريقةُ سدادٍ جديدة ──
--
-- كان النظام يقول إنّ على المقهى ١٨ ألفاً للمورّدين، وصاحبُه يقول «أقلّ
-- بكثير». وأكبرُ الفرق مصنعُ الكوب الذهبي: فاتورةُ مايو سُدّدت من حساب
-- المالك الشخصيّ — لا أثر لها في كشف المقهى — فلم يجد النظام لها حوالة،
-- ووزّع حوالاتِ يوليو «بالأقدم أوّلاً» على مايو، فبقيت يوليو مفتوحةً
-- كاملةً وقد سُدّدت.
--
-- و`BANK_TRANSFER` كذبٌ لسدادٍ لم يمرّ بحساب المقهى، و`CASH` كذبٌ آخر.
-- فالطريقة تُسمّى باسمها: `OWNER_ACCOUNT` — مالٌ خرج من حساب المالك
-- لصالح المقهى، ولن يظهر في كشف بنكه أبداً فلا يُنتظَر له توأم.
--
-- ── لماذا جدولٌ للاقتراحات لا عمودٌ على الفاتورة ──
--
-- حكمُ النموذج **اقتراحٌ لا مطابقة** (قرارٌ قائم). فلا يُكتب في المال
-- شيءٌ حتى يُقرّه إنسان، ويبقى الاقتراحُ وقرارُ الإنسان فيه أثراً: ما
-- رفضه أحمد يُقرأ في التحليل القادم فلا يُقترَح ثانيةً بلا دليلٍ جديد.
-- وهذا ما يجعل التحليل يتحسّن بالاستعمال.
-- ═══════════════════════════════════════════════════════════════

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'OWNER_ACCOUNT';

CREATE TABLE IF NOT EXISTS ai_findings (
  id               text PRIMARY KEY,
  supplier_id      text NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  run_id           text NOT NULL,
  kind             text NOT NULL CHECK (kind IN (
                     'PAID_OUTSIDE_BANK', 'APPLY_CREDIT', 'MISSING_INVOICES',
                     'DUPLICATE_PAYMENT', 'STATEMENT_GAP', 'UNLINKED_TRANSFER', 'NOTE')),
  severity         text NOT NULL CHECK (severity IN ('HIGH', 'MEDIUM', 'LOW')),
  title            text NOT NULL,
  explanation      text NOT NULL,
  -- يحسبه الخادم من الوقائع، لا يُؤخذ من النموذج. و`NULL` = لا مبلغ للبند.
  amount_minor     integer,
  -- الفعلُ الذي يُنفَّذ عند الإقرار. و`NULL` = بندُ معلومةٍ بلا فعلٍ ماليّ.
  action           jsonb,
  refs             jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           text NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN', 'ACCEPTED', 'DISMISSED', 'SUPERSEDED')),
  model            text NOT NULL,
  prompt_version   text NOT NULL,
  model_confidence numeric(4, 3),
  cost_micro_usd   integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by_id    text REFERENCES users(id),
  decision_note    text,
  -- قرارٌ بلا صاحبٍ ولا وقت ليس قراراً
  CONSTRAINT ai_findings_decision_marks CHECK (
    (status IN ('OPEN', 'SUPERSEDED')) OR (decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ai_findings_supplier_status_idx ON ai_findings (supplier_id, status);
CREATE INDEX IF NOT EXISTS ai_findings_status_created_idx ON ai_findings (status, created_at);
