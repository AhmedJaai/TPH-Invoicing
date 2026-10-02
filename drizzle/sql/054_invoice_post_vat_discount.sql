-- 054 — الخصمُ على الفاتورة بعد الضريبة.
--
-- الخصمُ قبل الضريبة يُنقص الوعاء فيُطبع الصافي بعده، و«الصافي + الضريبة =
-- الإجماليّ» يستقيم. أمّا بعد الضريبة (نقديٌّ أو تقريبيّ) فيُنقص المستحقَّ وحده:
-- «الصافي + الضريبة − الخصم = المستحقّ». وكان القيدُ (007) يعرف الأوّل وحده،
-- ففاتورةُ الثاني تُردّ أو تُقيَّد بغير مستحقّها.
--
-- `discount_minor` الخصمُ بعد الضريبة وحده — يحكم به الخادمُ (`checkInvoiceTotals`)
-- لا قراءةُ النموذج؛ والفراغُ «لا خصمَ بعد الضريبة». والقيدُ نفسُه بالحساب نفسه
-- وتسامحِ الريال نفسه. ولكلّ فاتورةٍ قائمة الفراغُ، فالقيدُ عليها هو هو.
alter table invoices add column if not exists discount_minor integer;
alter table invoices drop constraint if exists invoices_discount_nonnegative;
alter table invoices add constraint invoices_discount_nonnegative
  check (discount_minor is null or discount_minor > 0);

alter table invoices drop constraint if exists invoices_parts_sum_to_total;
alter table invoices add constraint invoices_parts_sum_to_total
  check (
    subtotal_minor is null
    or vat_minor is null
    or abs(subtotal_minor + vat_minor - coalesce(discount_minor, 0) - total_minor) <= 100
  );
