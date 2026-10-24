-- 088 — الشهرُ المقفل يحمي ما كان يفوته: خصمُ الفاتورة ورسومُها وحالُها الضريبيّ، والمصروف، ومالُ حركة البنك؛ و`payment_month` بتوقيت الرياض.
-- الشهر المقفل يغطّي ما كان يفلت منه — وشهرُ الدفعة بتوقيت الرياض
--
-- مؤثِّرات ٠٢٨ تحرس مبالغ الفاتورة الثلاثة وشهرَها ومورّدَها، والدفعة،
-- والتخصيص. وبقي خارجها ما يغيّر أرقام الشهر المقفل وإقرارَه:
--
--   ١. الفاتورة: الخصمُ بعد الضريبة (054) والرسوم (055) يغيّران المستحقّ،
--      وحالُ الضريبة وخصمُ المدخلات والأصلُ الثابت يغيّرون الإقرار.
--      والخدماتُ تحرسها (`correctInvoice` · `reread` · `createInvoice`)،
--      والقاعدةُ كانت تقبلها من أيّ بابٍ آخر.
--   ٢. المصروف: لا مؤثِّرَ عليه أصلاً — قيدٌ يدويٌّ في يوليو المقفل يمرّ.
--   ٣. حركة البنك: الاستيرادُ لا يُدرج في شهرٍ مقفل (`bank-import`)، والقاعدة
--      كانت تقبل الإدراجَ والحذفَ وتغييرَ المبلغ والاتّجاه والتاريخ.
--
-- وما لا يغيّر المال يبقى مفتوحاً عمداً، لأنّ له مساراً مشروعاً اليوم:
--   · الفاتورة: `document_id` (ربطُ ملفٍّ بفاتورةٍ قُيّدت من الكشف وشهرُها
--     مقفل — `attachFileToStatementInvoice`)، والقيدُ المحاسبيّ، و`received_on`.
--   · المصروف: الاسمُ، وروابطُه (`bank_transaction_id` يُفرَّغ حين تُحذف
--     حركتُه — ON DELETE SET NULL — أو يُكتب حين يُتبنّى قيدٌ يدويّ).
--   · حركة البنك: التصنيفُ، والمرجعُ والحسابُ (إعادةُ استيراد كشفٍ يغطّي
--     شهراً مقفلاً تُثري المعروف ولا تُضيف)، و`matched_payment_id`: حوالةُ
--     أغسطس المقفل تُطابَق بفاتورة سبتمبر المتأخّرة، ودفعتُها تُنسب إلى
--     سبتمبر (`applies_to_month`) فيحرسها مؤثِّرُ الدفعة لا الحركة.
--   · التخصيص: يُحرَس بشهر الفاتورة وحده كما في ٠٢٨ — دفعةُ شهرٍ مقفل
--     يُخصَّص باقيها لفاتورةٍ متأخّرة في شهرٍ مفتوح (الأقدم أوّلاً)، ورصيدُ
--     المورّد لا يتغيّر بذلك.
--
-- وإعادةُ الفتح تُعيد الكتابة ممكنة، كما في ٠٢٨.
--
-- ── شهرُ الدفعة بتوقيت الرياض لا بتوقيت الجلسة ──
--
-- `payment_month` كانت `to_char(paid_at, 'YYYY-MM')` — بتوقيت الجلسة (GMT في
-- Neon)، والخدمةُ تحسبه بتوقيت الرياض (`currentMonthRiyadh` في
-- `createPayment`). فحوالةٌ في ٢١:٣٠Z آخرَ أغسطس شهرُها عند الخدمة سبتمبر
-- وعند القاعدة أغسطس: يفحصان قفلَ شهرين مختلفين. والمنطقةُ الآن صريحة،
-- فلا يتغيّر الناتج بتغيّر الجلسة. وقِيس على الإنتاج (١١ أكتوبر): لا دفعة
-- يختلف شهرُها بين التوقيتين، فلا يتغيّر رقمٌ قائم.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION payment_month(applies text, paid timestamptz) RETURNS text AS $$
  SELECT coalesce(applies, to_char(paid AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM'));
$$ LANGUAGE sql STABLE;

/* ── ١) الفاتورة: ما يغيّر المستحقّ أو الإقرار ── */
CREATE OR REPLACE FUNCTION reject_closed_month_invoice() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF month_is_closed(NEW.period_month) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل إضافة فاتورة إليه', NEW.period_month
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF month_is_closed(OLD.period_month) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل حذف فاتورة منه', OLD.period_month
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF (NEW.total_minor IS DISTINCT FROM OLD.total_minor
      OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
      OR NEW.vat_minor IS DISTINCT FROM OLD.vat_minor
      OR NEW.period_month IS DISTINCT FROM OLD.period_month
      OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id)
     AND (month_is_closed(OLD.period_month) OR month_is_closed(NEW.period_month)) THEN
    RAISE EXCEPTION 'الشهر مقفل — أعِد فتحه قبل تعديل مبلغ فاتورته أو شهرها'
      USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.discount_minor IS DISTINCT FROM OLD.discount_minor
      OR NEW.charges_minor IS DISTINCT FROM OLD.charges_minor
      OR NEW.tax_status IS DISTINCT FROM OLD.tax_status
      OR NEW.input_vat_status IS DISTINCT FROM OLD.input_vat_status
      OR NEW.is_fixed_asset IS DISTINCT FROM OLD.is_fixed_asset)
     AND month_is_closed(OLD.period_month) THEN
    RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل تعديل خصم فاتورته أو رسومها أو حالها الضريبيّ', OLD.period_month
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

/* ── ٢) المصروف ── */
CREATE OR REPLACE FUNCTION reject_closed_month_expense() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF month_is_closed(NEW.period_month) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل إضافة مصروفٍ إليه', NEW.period_month
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF month_is_closed(OLD.period_month) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل حذف مصروفٍ منه', OLD.period_month
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.period_month IS DISTINCT FROM OLD.period_month
      OR NEW.occurred_on IS DISTINCT FROM OLD.occurred_on)
     AND (month_is_closed(OLD.period_month) OR month_is_closed(NEW.period_month)) THEN
    RAISE EXCEPTION 'الشهر مقفل — أعِد فتحه قبل تعديل مبلغ مصروفه أو بابه أو تاريخه'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS expenses_month_lock ON expenses;
CREATE TRIGGER expenses_month_lock
  BEFORE INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION reject_closed_month_expense();

/* ── ٣) حركة البنك: ما يغيّر المال وحده — شهرُها بتوقيت الرياض كما في ٠٨٤ ── */
CREATE OR REPLACE FUNCTION reject_closed_month_bank_tx() RETURNS trigger AS $$
DECLARE m_old text; m_new text;
BEGIN
  IF TG_OP <> 'INSERT' THEN m_old := to_char(OLD.value_date AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM'); END IF;
  IF TG_OP <> 'DELETE' THEN m_new := to_char(NEW.value_date AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM'); END IF;

  IF TG_OP = 'INSERT' THEN
    IF month_is_closed(m_new) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل إضافة حركة بنكٍ إليه', m_new
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF month_is_closed(m_old) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل حذف حركة بنكٍ منه', m_old
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.direction IS DISTINCT FROM OLD.direction
      OR NEW.value_date IS DISTINCT FROM OLD.value_date)
     AND (month_is_closed(m_old) OR month_is_closed(m_new)) THEN
    RAISE EXCEPTION 'الشهر مقفل — أعِد فتحه قبل تعديل مبلغ حركته البنكيّة أو اتّجاهها أو تاريخها'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bank_transactions_month_lock ON bank_transactions;
CREATE TRIGGER bank_transactions_month_lock
  BEFORE INSERT OR UPDATE OR DELETE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_closed_month_bank_tx();
