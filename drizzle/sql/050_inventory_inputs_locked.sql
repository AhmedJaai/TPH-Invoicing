-- 050 — الهدرُ والحركاتُ لا تُكتب في أسبوعٍ جردُه مقفَل.
--
-- الاستلامُ اليدويّ محروسٌ بذلك منذ 041، والهدرُ والتحويلاتُ والتسويات لم تكن:
-- هدرٌ يُسجَّل في أسبوعٍ أُقفل يغيّر ما كان يجب أن يكون، والتقريرُ المقفَل
-- يبقى على أرقامه صامتاً. فيُرفَض كما يُرفَض الاستلام — أعِد فتح الجرد أوّلاً.
--
-- إضافةٌ آمنة: لا شيفرةَ تعدّل الهدرَ أو الحركاتِ بعد كتابتها، وقيس على الإنتاج:
-- لا هدرَ ولا حركةَ في أسبوعٍ مقفَل.
create or replace function inventory_inputs_locked() returns trigger
language plpgsql as $$
declare hit text;
begin
  select c.id into hit
    from inventory_counts c
   where c.status = 'FINALISED'
     and (
       (tg_op <> 'DELETE' and new.occurred_on between c.period_start and c.period_end
         and coalesce(c.branch_id, '~') = coalesce(new.branch_id, coalesce(c.branch_id, '~')))
       or
       (tg_op <> 'INSERT' and old.occurred_on between c.period_start and c.period_end
         and coalesce(c.branch_id, '~') = coalesce(old.branch_id, coalesce(c.branch_id, '~')))
     )
   limit 1;
  if hit is not null then
    raise exception 'هذا يقع في أسبوعٍ جردُه مقفَل — أعِد فتحَ الجرد أوّلاً'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists waste_records_locked_trg on waste_records;
create trigger waste_records_locked_trg
  before insert or update or delete on waste_records
  for each row execute function inventory_inputs_locked();

drop trigger if exists inventory_movements_locked_trg on inventory_movements;
create trigger inventory_movements_locked_trg
  before insert or update or delete on inventory_movements
  for each row execute function inventory_inputs_locked();
