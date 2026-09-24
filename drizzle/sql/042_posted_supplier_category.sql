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
