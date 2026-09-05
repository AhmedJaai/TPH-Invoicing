-- ═══════════════════════════════════════════════════════════════
-- طبقاتُ الحركة، وحدثُ المصروف
--
-- ١. للحركة عمودان يصفانها من جهتين لا تُقرآن معاً: `match_status`
--    و`match_disposition`. فحركةٌ حالتها `UNMATCHED` وقرارُها `AUTO`
--    تعني «قُرّر حسمُها ولم تُكتَب» — وهي صحيحة قبل الموافقة، ومرضٌ
--    بعدها، ولا شيء في العمودين يفرّق. والصواب طبقاتٌ متراكمة.
--
-- ٢. الحدث الواقعيّ الواحد — دفعُ فاتورة كهرباء بألفٍ ومئتين في الخامس
--    من أغسطس — يصل من مصدرين لا يعرف أحدهما الآخر: من كشف البنك، ومن
--    مستندٍ رُفع. فيُقيَّد مصروفان. والقيود القائمة لا تمنعه: هي تمنع
--    تكرار السجلّ عن **نفس** الحركة أو **نفس** الفاتورة، وهذان سجلّان
--    عن مصدرين مختلفين فيمرّان — ويصير مصروف الشهر أعلى ممّا صُرف.
-- ═══════════════════════════════════════════════════════════════

-- ── ١. طبقة الحركة ──
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tx_lifecycle') then
    create type tx_lifecycle as enum ('RAW', 'INFERRED', 'SUGGESTED', 'CONFIRMED', 'POSTED');
  end if;
end $$;

alter table bank_transactions
  add column if not exists lifecycle tx_lifecycle not null default 'RAW';

create index if not exists bank_tx_lifecycle_idx on bank_transactions (lifecycle);

-- القديم يُنسَب إلى طبقته من حقائقه — لا يُترك الكلّ `RAW`،
-- فذلك يقول إنّ النظام لا يعرف شيئاً عن حركاته كلّها.
update bank_transactions set lifecycle =
  case
    when matched_payment_id is not null                      then 'POSTED'
    when match_status = 'IGNORED'                            then 'CONFIRMED'
    when match_disposition = 'AUTO'                          then 'CONFIRMED'
    when match_disposition in ('SUGGEST', 'REVIEW')          then 'SUGGESTED'
    when category <> 'UNKNOWN'                               then 'INFERRED'
    else 'RAW'
  end::tx_lifecycle;

-- ── ٢. بصمة حدث المصروف ──
alter table expenses
  add column if not exists event_key text;

-- البصمة تصف ما وقع: بابُه ويومُه ومبلغُه ووصفُه. ولا يدخلها المصدر —
-- وإلّا عادت تفرّق بين ما تريد جمعه.
update expenses set event_key =
  category || '|' || occurred_on || '|' || amount_minor::text || '|' ||
  upper(substring(btrim(regexp_replace(label, '[^[:alnum:]؀-ۿ]+', ' ', 'g')) from 1 for 60));

create index if not exists expenses_event_idx on expenses (event_key);

-- ── حذف المشتقّ المكرّر قبل القيد ──
--
-- ويُحذَف المشتقّ وحده — `BANK` و`INVOICE` — ويُبقى الأقدم. أمّا
-- `MANUAL` فقيدُ إنسانٍ متعمَّد: قد يكون تكرارُه صحيحاً، فلا يُمَسّ.
delete from expenses e
using expenses keep
where e.source <> 'MANUAL'
  and keep.source <> 'MANUAL'
  and e.event_key = keep.event_key
  and e.event_key is not null
  and (keep.created_at, keep.id) < (e.created_at, e.id);

-- القيد على المشتقّ وحده، للسبب نفسه: ما اشتقّه النظام مرّتين عن حدثٍ
-- واحد خطأٌ يقيناً، وما كتبه الإنسان مرّتين قد يكون قصداً — ويُعرَض له
-- تنبيهٌ لا قيد.
create unique index if not exists expenses_event_uniq
  on expenses (event_key)
  where source <> 'MANUAL' and event_key is not null;
