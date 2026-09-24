-- ═══════════════════════════════════════════════════════════════
-- الحركةُ المقيَّدة لمورّدٍ بابُها «سداد مورّد» — لا «غير مصنّفة»
--
-- كان استيرادُ الكشف يقيّد الحوالة المطابَقة آلياً (دفعةٌ وتخصيصٌ وطبقةُ
-- `POSTED`) ويترك `category = 'UNKNOWN'`، بينما يكتب التأكيدُ اليدويّ
-- `SUPPLIER`. فتُعرَض «صادر · غير مصنّفة» بجانب «طُوبقت تلقائياً»، وتدخل
-- «أين ذهب المال» مالاً مجهولاً وهو محسوبٌ في المشتريات.
--
-- والإصلاحُ في `bank-import` لما يأتي، وهذه لما مضى. والشرطُ ضيّق:
--   · صادرٌ بابُه `UNKNOWN` — لا يُكتب فوق بابٍ عرفه مصنِّفٌ أو إنسان
--   · مربوطٌ بدفعةٍ لمورّدٍ بعينه لم تُردّ ولم تُلغَ
-- وتحديثُ بابٍ لا يحذف ولا يمسّ مالاً: الدفعةُ والتخصيصُ كما هما.
-- ═══════════════════════════════════════════════════════════════

UPDATE bank_transactions bt
   SET category              = 'SUPPLIER',
       supplier_id           = p.supplier_id,
       classification_source = 'STRUCTURE',
       classification_reason = coalesce(bt.classification_reason, 'قُيّدت دفعةً لمورّد — بابُها من القيد')
  FROM payments p
 WHERE bt.matched_payment_id = p.id
   AND bt.category = 'UNKNOWN'
   AND bt.direction = 'DEBIT'
   AND p.supplier_id IS NOT NULL
   AND p.status NOT IN ('REVERSED', 'VOID');

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
