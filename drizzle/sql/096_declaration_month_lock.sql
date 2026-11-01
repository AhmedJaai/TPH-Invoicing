-- 096 — «ما لا يظهر في الكشف» لا يُكتب في شهرٍ مقفل.
--
-- الإضافةُ (نقدٌ خارج الكشف، توزيعُ دفعةٍ على أشهرها، «لا شيء») تغيّر قائمةَ دخل كلّ شهرٍ
-- تغطّيه، وكانت تمرّ على سبتمبر المقفل فيتغيّر ربحُه بعد ختمه. فالحارسُ في الخدمة
-- (`createDeclaration` · `voidDeclaration`) وهنا معاً، كما في ٠٢٨ للفاتورة والمصروف.
-- إضافةٌ خالصة: دالّةٌ ومؤثِّر، لا جدولَ ولا عمود.

create or replace function reject_closed_month_declaration() returns trigger as $$
declare
  d record;
  m date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    d := old;
  else
    d := new;
  end if;
  m := to_date(d.from_month || '-01', 'YYYY-MM-DD');
  while to_char(m, 'YYYY-MM') <= d.to_month loop
    if month_is_closed(to_char(m, 'YYYY-MM')) then
      raise exception 'الشهر % مقفل — أعِد فتحه قبل تغيير ما أضفته إليه', to_char(m, 'YYYY-MM') using errcode = 'P0001';
    end if;
    m := m + interval '1 month';
  end loop;
  if tg_op = 'UPDATE' and (new.from_month <> old.from_month or new.to_month <> old.to_month) then
    m := to_date(new.from_month || '-01', 'YYYY-MM-DD');
    while to_char(m, 'YYYY-MM') <= new.to_month loop
      if month_is_closed(to_char(m, 'YYYY-MM')) then
        raise exception 'الشهر % مقفل — أعِد فتحه قبل تغيير ما أضفته إليه', to_char(m, 'YYYY-MM') using errcode = 'P0001';
      end if;
      m := m + interval '1 month';
    end loop;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists finance_declarations_month_lock on finance_declarations;
create trigger finance_declarations_month_lock
  before insert or update or delete on finance_declarations
  for each row execute function reject_closed_month_declaration();
