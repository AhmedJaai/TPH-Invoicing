-- 055 — الرسومُ على الفاتورة بعد الضريبة (توصيل · شحن · خدمة).
--
-- «الصافي + الضريبة − الخصم + الرسوم = المستحقّ». وُجدت في الإنتاج فاتورةُ رونة
-- ٩٢٥ + ١٣٨٫٧٥ ضريبة + ٢٥ توصيل = ١٬٠٨٨٫٧٥، والقيدُ (054) لا يعرف الرسوم، فقُيّدت
-- بلا صافٍ ولا ضريبة («مجهولة») وضاعت ضريبتُها من الخصم.
--
-- `charges_minor` يحكم به الخادمُ (`checkInvoiceTotals`) لا قراءةُ النموذج؛ والفراغُ
-- «لا رسوم بعد الضريبة». ولكلّ فاتورةٍ قائمة الفراغُ، فالقيدُ عليها هو هو.
alter table invoices add column if not exists charges_minor integer;
alter table invoices drop constraint if exists invoices_charges_positive;
alter table invoices add constraint invoices_charges_positive
  check (charges_minor is null or charges_minor > 0);

alter table invoices drop constraint if exists invoices_parts_sum_to_total;
alter table invoices add constraint invoices_parts_sum_to_total
  check (
    subtotal_minor is null
    or vat_minor is null
    or abs(subtotal_minor + vat_minor - coalesce(discount_minor, 0) + coalesce(charges_minor, 0) - total_minor) <= 100
  );
