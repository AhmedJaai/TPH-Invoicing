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
--
-- البصمة تصف ما وقع: بابُه ويومُه ومبلغُه ووصفُه **كاملاً**. ولا يدخلها
-- المصدر — وإلّا عادت تفرّق بين ما تريد جمعه.
--
-- والوصف يُلبَّد ولا يُقتطَع. وهذا درسٌ من بيانات هذا المقهى نفسه:
-- التصميم الأوّل قصّ الوصف عند ستّين حرفاً، ففشل على ثلاث فواتير مرافق
-- في يومٍ واحد بمبالغ متطابقة، لا يفرّقها إلّا **مرجعُ السداد** الواقع
-- بعد الحرف الستّين في وصف الأهليّ. فبدت كلٌّ منها مكرَّرة، وكاد القيد
-- يحذف مالاً خرج فعلاً.
alter table expenses
  add column if not exists event_key text;

update expenses set event_key = encode(sha256(convert_to(
  category || '|' || occurred_on || '|' || amount_minor::text || '|' ||
  upper(btrim(regexp_replace(label, '[^[:alnum:]؀-ۿ]+', ' ', 'g'))),
  'UTF8')), 'hex');

create index if not exists expenses_event_idx on expenses (event_key);

-- ── ولا قيدَ فرادةٍ هنا، ولا حذف ──
--
-- وهذا قرارٌ مقصود، لا نقصٌ في التنفيذ.
--
-- كان القيد مكتوباً: فرادةُ `event_key` على المشتقّ، مسبوقةً بحذف
-- المكرّر. ثمّ فُحص أثره على بيانات الإنتاج قبل تشغيله، فتبيّن أنّه
-- سيحذف **ثلاثة مصروفات حقيقية** — فاتورتَي كهرباء وفاتورةَ اتصالات،
-- لكلٍّ حركتُها البنكية ببصمتها الخاصّة.
--
-- ولا يُقال إنّ البصمة أخطأت وحدها: الخطأ أعمق. حدثان لهما **أثران
-- مختلفان** — حركتان بنكيّتان مختلفتان — هما حدثان، مهما تطابق كلُّ ما
-- عداهما. والقيدُ الذي يجمعهما يمحو مالاً خرج فعلاً.
--
-- فالحذف الآليّ خرج، وبقيت البصمة **كشفاً يُعرَض** يقرّر فيه إنسان:
-- `findDuplicateExpenses` في `src/lib/expenses.ts` يستثني ما اختلف
-- أثرُه، ويعرض الباقي في «ما يحتاج انتباهك».
--
-- والقاعدة العامّة: قيدٌ يحذف بيانات مالية يُفحَص أثرُه على الإنتاج قبل
-- كتابته — لا بعد تشغيله. وما لم يُفحَص لا يُكتَب.
