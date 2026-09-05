-- ═══════════════════════════════════════════════════════════════
-- دورةُ حياةٍ للدفعة، ورسمٌ لا يُخترَع منه فائض
--
-- كان للدفعة حالٌ واحد ضمنيّ: «موجودة». وثلاثة آثار:
--
-- ١. من دفع لمورّدٍ قبل وصول فاتورته لا يجد لدفعته موضعاً — تبقى
--    «غير مطابَقة» إلى الأبد وكأنّها خطأ. وهي ليست خطأً: هي دفعة
--    مقدّمة، وهذا أمرٌ يوميّ.
--
-- ٢. لا فرق بين دفعةٍ لم تُخصَّص بعد ودفعةٍ رُدَّ مالُها. تُحسبان معاً
--    في «المدفوع»، فيظهر المقهى وقد دفع ما لم يدفع.
--
-- ٣. رسمُ التحويل يبقى داخل المبلغ، فتُقرأ دفعةٌ بخمسة آلاف وعشرين على
--    فاتورة بخمسة آلاف «فائضةً بعشرين ريالاً» — ويُفتَح للمورّد رصيدٌ
--    لا وجود له، بينما العشرون ذهبت إلى البنك لا إليه.
-- ═══════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum (
      'UNAPPLIED', 'PARTIALLY_APPLIED', 'APPLIED',
      'OVERPAYMENT', 'ADVANCE', 'REVERSED', 'VOID'
    );
  end if;
end $$;

alter table payments
  add column if not exists status          payment_status not null default 'UNAPPLIED',
  add column if not exists fee_minor       integer not null default 0,
  add column if not exists is_advance      boolean not null default false,
  add column if not exists reversed_at     timestamptz,
  add column if not exists reversed_by_id  text references users(id),
  add column if not exists reversal_reason text,
  add column if not exists voided_at       timestamptz;

create index if not exists payments_status_idx on payments (status);

-- الرسم جزءٌ من الدفعة لا يزيد عليها، ولا يكون سالباً.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_fee_within_amount') then
    alter table payments add constraint payments_fee_within_amount
      check (fee_minor >= 0 and fee_minor <= amount_minor);
  end if;
end $$;

-- المردودة تحمل سببها. ردٌّ بلا سبب لا يُراجَع بعد شهر.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_reversal_has_reason') then
    alter table payments add constraint payments_reversal_has_reason
      check (reversed_at is null or coalesce(btrim(reversal_reason), '') <> '');
  end if;
end $$;

-- الحال يوافق الأثر: لا `REVERSED` بلا تاريخ ردّ، ولا `VOID` بلا تاريخ إلغاء،
-- ولا تاريخَ ردٍّ على دفعةٍ حالُها غير ذلك. وإلّا صار العمود زينةً تكذب.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_status_matches_marks') then
    alter table payments add constraint payments_status_matches_marks
      check (
        (status = 'REVERSED') = (reversed_at is not null and voided_at is null)
        and (status = 'VOID') = (voided_at is not null)
      );
  end if;
end $$;

-- الحال المعلَن مقدّمةً يوافق علامته.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_advance_is_declared') then
    alter table payments add constraint payments_advance_is_declared
      check (status <> 'ADVANCE' or is_advance);
  end if;
end $$;

-- ── القديم يُصنَّف بما تقوله تخصيصاته ──
-- لا يُترك الكلّ `UNAPPLIED`: ذلك يقول إنّ كل دفعةٍ سابقة معلّقة.
update payments p set status = sub.derived
from (
  select p2.id,
    case
      when coalesce(a.total, 0) = 0 then 'UNAPPLIED'
      when p2.amount_minor - p2.fee_minor - a.total >  1 then 'PARTIALLY_APPLIED'
      when p2.amount_minor - p2.fee_minor - a.total < -1 then 'OVERPAYMENT'
      else 'APPLIED'
    end::payment_status as derived
  from payments p2
  left join (
    select payment_id, sum(amount_minor)::int as total
    from payment_allocations group by payment_id
  ) a on a.payment_id = p2.id
) sub
where p.id = sub.id and p.status <> sub.derived
  and p.reversed_at is null and p.voided_at is null;
