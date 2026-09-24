-- ═══════════════════════════════════════════════════════════════
-- ما أقرّه إنسانٌ مصدرُه «إنسان» — لا «مجهول»
--
-- كان هذا في 042 نفسها، أُضيف إليها بعد أن طُبّقت على قاعدة المعاينة. والمشغّلُ
-- يرفض هجرةً مطبَّقة تغيّر ملفّها (وهذا صوابُه) — فسقط كلُّ نشرٍ بعدها عند
-- `migrate` قبل البناء. فعادت 042 كما طُبّقت حرفاً بحرف، وصار ما أُضيف هنا.
-- **الهجرةُ المطبَّقة لا تُعدَّل؛ الإضافةُ هجرةٌ جديدة.**
-- ═══════════════════════════════════════════════════════════════
-- ── ومصدرُ ما أقرّه إنسان ──
--
-- مساراتُ التأكيد اليدويّ (`match-confirm` و`match-confirm-bulk`) كانت تكتب
-- `category = 'SUPPLIER'` وتترك `classification_source` كما كان — `UNKNOWN`
-- في الغالب. فيقول العمود «لم يُصنِّفها أحد» عن حركةٍ صنّفها صاحبُ المقهى
-- بضغطته، ويُحسَب في المقاييس خطأً. والدليلُ على الإنسان في سجلّ القرار نفسه.
UPDATE bank_transactions bt
   SET classification_source = 'HUMAN'
 WHERE bt.category = 'SUPPLIER'
   AND bt.matched_payment_id IS NOT NULL
   AND coalesce(bt.classification_source::text, 'UNKNOWN') = 'UNKNOWN'
   AND EXISTS (
     SELECT 1 FROM decision_history d
      WHERE d.bank_transaction_id = bt.id
        AND d.event = 'MATCH_CONFIRMED'
        AND d.actor = 'HUMAN'
   );
