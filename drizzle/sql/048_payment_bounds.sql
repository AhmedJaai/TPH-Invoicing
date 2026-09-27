-- 048 — حدودُ الدفعة والفاتورة من الجهتين، وقفلُ الشهر على الحذف، وفهارس.
--
-- ١. التخصيصُ لا يتجاوز «صافي» الدفعة (المبلغ − الرسم). كان 026 يقارن بالمبلغ
--    كلّه، والشيفرةُ (`derivePaymentStatus`) لا توزّع إلّا الصافي: دفعةٌ بـ٥٬٠٢٠
--    ورسمِ ٢٠ تقبل ٥٬٠٢٠ تخصيصاً، فتُغلق فواتير بالرسم نفسه.
-- ٢. والحدُّ يُسأل حين يتغيّر الأصلُ لا التخصيصُ وحده: تعديلُ مبلغ الدفعة أو
--    رسمها، أو إجماليّ الفاتورة، تحت ما خُصّص عليها — كان يمرّ.
-- ٣. حذفُ دفعةٍ في شهرٍ مقفل (028 كان للإدراج والتعديل وحدهما).
-- ٤. حركةُ بنكٍ واحدة لكلّ دفعة: فهرسٌ فريدٌ جزئيّ. قيس على الإنتاج قبل الكتابة:
--    لا تكرارَ قائم، ولا مسارَ يُلحق حركةً ثانية بدفعةٍ لها حركة — فهو يحرس السباق.
-- ٥. فهرسان لمسارين ساخنين بلا فهرس.
--
-- كلُّه إضافة: الشيفرةُ القديمة لا تكتب ما يرفضه، وقيس على الإنتاج: صفرُ مخالفات.

CREATE OR REPLACE FUNCTION assert_allocation_within_bounds()
RETURNS trigger AS $$
declare
  payment_net     integer;
  allocated_total bigint;
  invoice_total   integer;
  invoice_alloc   bigint;
begin
  perform 1 from payments  where id = new.payment_id for update;
  perform 1 from invoices  where id = new.invoice_id for update;

  select amount_minor - fee_minor into payment_net from payments where id = new.payment_id;
  select coalesce(sum(amount_minor), 0) into allocated_total
    from payment_allocations where payment_id = new.payment_id;

  if payment_net is not null and allocated_total > payment_net then
    raise exception
      'تخصيص أكبر من صافي الدفعة: خُصّص % والدفعة بعد الرسم %',
      allocated_total, payment_net
      using errcode = 'check_violation';
  end if;

  select total_minor into invoice_total from invoices where id = new.invoice_id;
  select coalesce(sum(amount_minor), 0) into invoice_alloc
    from payment_allocations where invoice_id = new.invoice_id;

  if invoice_total is not null and invoice_alloc > invoice_total then
    raise exception
      'سداد أكبر من قيمة الفاتورة: سُدّد % والفاتورة %',
      invoice_alloc, invoice_total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$ language plpgsql;

CREATE OR REPLACE FUNCTION assert_payment_covers_allocations() RETURNS trigger AS $$
declare allocated bigint;
begin
  select coalesce(sum(amount_minor), 0) into allocated from payment_allocations where payment_id = new.id;
  if allocated > new.amount_minor - new.fee_minor then
    raise exception 'صافي الدفعة (%) أقلّ ممّا خُصّص منها (%) — فُكّ التخصيص أوّلاً',
      new.amount_minor - new.fee_minor, allocated using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

DROP TRIGGER IF EXISTS payments_cover_allocations ON payments;
CREATE TRIGGER payments_cover_allocations
  BEFORE UPDATE OF amount_minor, fee_minor ON payments
  FOR EACH ROW EXECUTE FUNCTION assert_payment_covers_allocations();

CREATE OR REPLACE FUNCTION assert_invoice_covers_allocations() RETURNS trigger AS $$
declare allocated bigint;
begin
  select coalesce(sum(amount_minor), 0) into allocated from payment_allocations where invoice_id = new.id;
  if new.total_minor is not null and allocated > new.total_minor then
    raise exception 'إجماليّ الفاتورة (%) أقلّ ممّا سُدّد منها (%) — فُكّ السداد أوّلاً',
      new.total_minor, allocated using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

DROP TRIGGER IF EXISTS invoices_cover_allocations ON invoices;
CREATE TRIGGER invoices_cover_allocations
  BEFORE UPDATE OF total_minor ON invoices
  FOR EACH ROW EXECUTE FUNCTION assert_invoice_covers_allocations();

CREATE OR REPLACE FUNCTION reject_closed_month_payment_delete() RETURNS trigger AS $$
BEGIN
  IF month_is_closed(payment_month(OLD.applies_to_month, OLD.paid_at)) THEN
    RAISE EXCEPTION 'الشهر % مقفل — أعِد فتحه قبل حذف دفعته',
      payment_month(OLD.applies_to_month, OLD.paid_at) USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_month_lock_delete ON payments;
CREATE TRIGGER payments_month_lock_delete
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION reject_closed_month_payment_delete();

CREATE UNIQUE INDEX IF NOT EXISTS bank_tx_matched_payment_uniq
  ON bank_transactions (matched_payment_id) WHERE matched_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sale_lines_pos_product_idx ON sale_lines (pos_product_id);
CREATE INDEX IF NOT EXISTS statement_lines_matched_invoice_idx ON statement_lines (matched_invoice_id);
