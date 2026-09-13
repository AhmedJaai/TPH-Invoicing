-- ═══════════════════════════════════════════════════════════════
-- الشهر المقفل لا يُكتب فيه — من أيّ باب
--
-- كان `assertMonthOpen` في مسار الأرشفة وحده. فمن أقفل أغسطس ثمّ قيّد
-- حوالةً من الكشف، أو سجّل سداد فاتورة، أو زامن الدرايف، كتب في
-- الشهر المقفل بلا اعتراض — والإقفال شهادة.
--
-- والحارس الآن في طبقة الخدمات (`month-guard.ts`) وهنا معاً: الثوابت
-- المالية تُفرَض في القاعدة لا في الشيفرة وحدها. وإعادة الفتح تُعيد
-- الكتابة ممكنة — فالتعديل يمرّ بها، ويُسجَّل.
--
-- ويُقيَّد بما يغيّر المال: تحديثُ حال الدفعة أو وسمُ الفاتورة مقيَّدةً
-- محاسبياً لا يمسّ أرقام الشهر.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION month_is_closed(m text) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM month_closes WHERE month = m AND status = 'CLOSED');
$$ LANGUAGE sql STABLE;

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
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_month_lock ON invoices;
CREATE TRIGGER invoices_month_lock
  BEFORE INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION reject_closed_month_invoice();

CREATE OR REPLACE FUNCTION payment_month(applies text, paid timestamptz) RETURNS text AS $$
  SELECT coalesce(applies, to_char(paid, 'YYYY-MM'));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION reject_closed_month_payment() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF month_is_closed(payment_month(NEW.applies_to_month, NEW.paid_at)) THEN
      RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل قيد دفعةٍ فيه',
        payment_month(NEW.applies_to_month, NEW.paid_at) USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.fee_minor IS DISTINCT FROM OLD.fee_minor
      OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
      OR NEW.applies_to_month IS DISTINCT FROM OLD.applies_to_month
      OR NEW.paid_at IS DISTINCT FROM OLD.paid_at)
     AND (month_is_closed(payment_month(OLD.applies_to_month, OLD.paid_at))
          OR month_is_closed(payment_month(NEW.applies_to_month, NEW.paid_at))) THEN
    RAISE EXCEPTION 'الشهر مقفل — أعِد فتحه قبل تعديل دفعته' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_month_lock ON payments;
CREATE TRIGGER payments_month_lock
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION reject_closed_month_payment();

CREATE OR REPLACE FUNCTION reject_closed_month_allocation() RETURNS trigger AS $$
DECLARE m text;
BEGIN
  SELECT period_month INTO m FROM invoices
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF month_is_closed(m) THEN
    RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل تغيير ما سُدّد من فواتيره', m
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_allocations_month_lock ON payment_allocations;
CREATE TRIGGER payment_allocations_month_lock
  BEFORE INSERT OR UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION reject_closed_month_allocation();
