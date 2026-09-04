-- ثوابت مالية تُفرَض في القاعدة لا في الكود وحده.
--
-- كان كل ما يمنع تخصيص دفعة أكبر من قيمتها سطراً في `planAllocations`.
-- وقد وقع خلافه فعلاً: دفعة ١٬٥٠٠٫٠٠ خُصّص منها ١٬٥٠٠٫٠١. أُصلح في
-- الكود، والقاعدة بقيت تقبله — وأيّ مسار جديد أو تصحيح يدويّ يمرّ منه.
--
-- ما يُفحَص داخل صفٍّ واحد يُفرَض بـCHECK، وما يعبر صفوفاً يحتاج مؤثِّراً.

/* ── ١) تخصيص السداد ── */

-- تخصيص بصفر أو سالب يقلب رصيد الفاتورة
alter table payment_allocations drop constraint if exists payment_allocations_positive;
alter table payment_allocations add constraint payment_allocations_positive
  check (amount_minor > 0);

/*
 * مجموع تخصيصات الدفعة لا يتجاوز قيمتها، ومجموع تخصيصات الفاتورة لا
 * يتجاوز إجماليها.
 *
 * `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY IMMEDIATE` كي يُفحَص بعد
 * كل عبارة، ويمكن تأجيله داخل معاملة تعيد بناء التخصيصات كلّها.
 */
create or replace function assert_allocation_within_bounds() returns trigger as $$
declare
  payment_total   integer;
  allocated_total bigint;
  invoice_total   integer;
  invoice_alloc   bigint;
begin
  select amount_minor into payment_total from payments where id = new.payment_id;
  select coalesce(sum(amount_minor), 0) into allocated_total
    from payment_allocations where payment_id = new.payment_id;

  if payment_total is not null and allocated_total > payment_total then
    raise exception
      'تخصيص أكبر من قيمة الدفعة: خُصّص % والدفعة %',
      allocated_total, payment_total
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

drop trigger if exists payment_allocations_bounds on payment_allocations;
create constraint trigger payment_allocations_bounds
  after insert or update on payment_allocations
  deferrable initially immediate
  for each row execute function assert_allocation_within_bounds();

/* ── ٢) الفاتورة ── */

-- فاتورة بصفر أو سالب ليست فاتورة
alter table invoices drop constraint if exists invoices_total_positive;
alter table invoices add constraint invoices_total_positive
  check (total_minor > 0);

/*
 * المجهول يبقى مجهولاً؛ والمعلوم يجب أن يتّسق — مع تسامحٍ بريالٍ واحد.
 *
 * فُرض القيد أوّلاً بلا تسامح فرفضته فاتورتان حقيقيتان: «ملتقى الأواني»
 * ٥٢٥٫٠٠ + ٧٨٫٧٥ = ٦٠٣٫٧٥ والمطبوع ٦٠٣٫٠٠، و«مختبرات القهوة» ٥٧٤٫٠٠ +
 * ٨٦٫١٠ = ٦٦٠٫١٠ والمطبوع ٦٦٠٫٠٠. المورّد يُسقط كسور الريال، والمطبوع
 * هو الملزِم — فالقيد كان أشدّ من الواقع، لا البيانات خاطئة.
 *
 * والريال أقصى ما يُنتجه التقريب إلى الريال؛ ما جاوزه خطأ قراءة.
 * القيمة نفسها في `TOTAL_ROUNDING_TOLERANCE_MINOR` بـ`src/lib/money.ts`.
 */
alter table invoices drop constraint if exists invoices_parts_sum_to_total;
alter table invoices add constraint invoices_parts_sum_to_total
  check (
    subtotal_minor is null
    or vat_minor is null
    or abs(subtotal_minor + vat_minor - total_minor) <= 100
  );

alter table invoices drop constraint if exists invoices_parts_non_negative;
alter table invoices add constraint invoices_parts_non_negative
  check (
    (subtotal_minor is null or subtotal_minor >= 0)
    and (vat_minor is null or vat_minor >= 0)
  );

/* ── ٣) المصروف ── */

-- الشهر المحاسبي يُشتقّ من تاريخ الحدث، فلا يُكتب شهرٌ يخالفه
alter table expenses drop constraint if exists expenses_period_matches_date;
alter table expenses add constraint expenses_period_matches_date
  check (period_month = substring(occurred_on from 1 for 7));

/* ── ٤) حركة البنك ── */

alter table bank_transactions drop constraint if exists bank_tx_amount_non_negative;
alter table bank_transactions add constraint bank_tx_amount_non_negative
  check (amount_minor >= 0);
