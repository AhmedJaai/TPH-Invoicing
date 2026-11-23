-- 112 — جهاتٌ بقيت «جهة بلا اسم» واسمُها مكتوبٌ في حركاتها.
-- الاسمُ كان يُكتب مرّةً عند الإنشاء من أوّل حركة، ولا يُرقّى حين يُقرأ في حركةٍ لاحقة (صار يُرقّى في
-- `counterparty.service.ts`). هنا يُرقّى القائم: الاسمُ المؤقّت وحده، ومن حركاتٍ تحمل اسماً **واحداً** لا غير —
-- جهةٌ تحمل حركاتُها اسمين تبقى للإنسان. لا يمسّ مالاً ولا تصنيفاً، ويُعطي النتيجةَ نفسها إن شُغِّل مرّتين.
update counterparties cp
set display_name = n.name, updated_at = now()
from (
  select bt.counterparty_id, min(btrim(regexp_replace(bt.beneficiary_raw, '\s+', ' ', 'g'))) as name
  from bank_transactions bt
  where bt.counterparty_id is not null and nullif(btrim(bt.beneficiary_raw), '') is not null
  group by bt.counterparty_id
  having count(distinct btrim(regexp_replace(bt.beneficiary_raw, '\s+', ' ', 'g'))) = 1
) n
where cp.id = n.counterparty_id and cp.display_name = 'جهة بلا اسم';
