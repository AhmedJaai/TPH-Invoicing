-- 064 — الهدرُ المسجَّل يُبطَل ولا يُمحى، وضغطتان لا تكتبان سطرين.
--
-- من كتب «٥٠٠» بدل «٥٠» لم يكن يملك إلّا تسويةً معاكسة تشوّش السجلّ. فصار
-- السطرُ يُبطَل بسببه ومن أبطله ويبقى (كالاستلام اليدويّ في 041)، والمُبطَلُ
-- يخرج من الحساب. ومؤثِّرُ 050 قائمٌ على التحديث، فالإبطالُ في أسبوعٍ جردُه
-- مقفَل يُرفَض كما يُرفَض التسجيل.
--
-- ومفتاحُ الطلب يولّده المتصفّح مرّةً لكلّ نموذج: شبكةٌ بطيئة في المخزن وضغطةٌ
-- ثانية كانتا تضاعفان الهدر فيصغر «الفرقُ غير المفسَّر» زوراً.
--
-- إضافةٌ آمنة: أعمدةٌ فارغة، وفهرسُ فرادةٍ جزئيّ على عمودٍ كلُّه NULL اليوم.
alter table waste_records add column if not exists voided_at timestamptz;
alter table waste_records add column if not exists voided_by_id text references users(id);
alter table waste_records add column if not exists void_reason text;
alter table waste_records add column if not exists client_request_id text;

create unique index if not exists waste_records_client_request_uq
  on waste_records (client_request_id)
  where client_request_id is not null;
