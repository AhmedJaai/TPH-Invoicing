-- ═══════════════════════════════════════════════════════════════
-- حارسُ التخصيص كان يُخدَع بالتزاحم
--
-- المؤثِّر `payment_allocations_bounds` يجمع التخصيصات بعد كلّ إدراج
-- ويقارنها بقيمة الفاتورة والدفعة. وهو صحيحٌ حين تكتب يدٌ واحدة.
--
-- لكنّ العزل الافتراضيّ `READ COMMITTED` يجعل المعاملة **لا ترى صفوف
-- معاملةٍ أخرى قبل إيداعها**. فإن ضغط اثنان «أكّد» على فاتورةٍ واحدة
-- في اللحظة نفسها:
--
--     أ: تُدرج 3,000 · تجمع فترى 3,000 ≤ 3,000 ✓
--     ب: تُدرج 3,000 · تجمع فترى 3,000 ≤ 3,000 ✓   (لا ترى صفّ «أ»)
--     الاثنتان تُودعان ← 6,000 على فاتورةٍ بـ3,000
--
-- وهذا ليس فرضاً: شهادةُ الدورة (السيناريو الثامن) تُنتجه في كلّ
-- تشغيل، باتّصالين حقيقيّين.
--
-- والعلاج قفلُ الصفّ المرجعيّ قبل الجمع. فتنتظر «ب» إيداعَ «أ»، ثمّ
-- تجمع فترى 6,000 > 3,000 فترفض. والقفل على الفاتورة والدفعة معاً
-- لأنّ الحدّين كليهما يُجمعان.
--
-- ولا يُبطئ ذلك العملَ العاديّ: القفل على صفٍّ واحد ولا يُنتظَر إلّا
-- عند التزاحم على الفاتورة نفسها — وهو ما نريد منعه أصلاً.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION assert_allocation_within_bounds()
RETURNS trigger AS $$
declare
  payment_total   integer;
  allocated_total bigint;
  invoice_total   integer;
  invoice_alloc   bigint;
begin
  /*
    القفل أوّلاً — قبل أيّ جمع.

    `for update` يحجز الصفّ حتى نهاية المعاملة، فتصطفّ المعاملات
    المتزاحمة على الفاتورة الواحدة بدل أن تقرأ كلٌّ منها حالاً قديماً.
    و`perform` لأنّ المطلوب القفل لا القيمة.
  */
  perform 1 from payments  where id = new.payment_id for update;
  perform 1 from invoices  where id = new.invoice_id for update;

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
