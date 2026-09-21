-- ══════════════════════════════════════════════════════════════════
--  دلالاتُ تصدير فودكس الحقيقيّ — وما لزم منها
-- ══════════════════════════════════════════════════════════════════
--
--  فُحص تصديرٌ حقيقيّ (٢٬٠٨١ صفّاً · ١٬٠٩٠ طلباً · ١٣–١٩ سبتمبر ٢٠٢٦)
--  فناقض ثلاثةَ افتراضاتٍ بُني عليها `036`:
--
--   ١ · **المرتجَع ليس كمّيّةً سالبة.** لا سالبَ في الملفّ إطلاقاً؛
--       الحالُ في عمود `status`: `Done` · `Returned` · `Void`. وقارئٌ
--       ينتظر السالب يقرأ المرتجَعَ بيعاً — فيزيد الاستهلاكَ حيث يجب
--       أن ينقص، ويُخفي الفرقَ مرّتين.
--
--   ٢ · **حالُ البند تغلب حالَ الطلب.** طلبٌ واحد في الملفّ (`18748`)
--       فيه أربعةُ بنودٍ ملغاة وبندٌ تامّ. فمن قرأ حالَ الطلب وحده
--       أسقط ما صُنع أو أدخل ما لم يُصنَع.
--
--   ٣ · **المُعدِّل صفٌّ مستقلّ** مرتبطٌ بأصله بـ`parent_item_sku`،
--       وكمّيّتُه = كمّيّةُ أصله دائماً (٣٦٤ من ٣٦٤)، وسعرُ الأصل
--       **يشمله**. فلو عُدّ بنداً مستقلّاً لتضاعف الإيرادُ وانتفخت
--       الوحدات المباعة.
--
--  وكلُّ ما هنا إضافة: أعمدةٌ بقيمٍ افتراضيّة، وقيمةُ تعدادٍ جديدة،
--  ومؤثِّر. فالنافذةُ بين الهجرة والكود آمنة.

-- ═════════ ١ · حالُ بند البيع كما يقولها المصدر ═════════
--
--  ولا يُكتفى بـ`is_refund`/`is_void` المشتقَّين: الحالُ الخام يُحفَظ
--  كما ورد كي يُقرأ بعد سنةٍ «بم حُكم على هذا السطر» — ولأنّ مصدراً
--  آخر قد يحمل حالاتٍ لا تنحصر في اثنتين.

alter table sale_lines add column if not exists source_status text;

comment on column sale_lines.source_status is
  'حالُ البند كما قالها المصدر (Done · Returned · Void عند فودكس) — خاماً، ومنه تُشتقّ الأعلام.';

-- ── المُعدِّل: صفٌّ مرتبطٌ بأصله، لا بندٌ يُستهلَك ──
alter table sale_lines add column if not exists is_modifier boolean not null default false;
alter table sale_lines add column if not exists parent_external_id text;

comment on column sale_lines.is_modifier is
  'خيارُ إضافةٍ لا منتج: كمّيّتُه كمّيّةُ أصله وسعرُه مشمولٌ فيه — فلا يُستهلَك وحده ولا يُجمَع إيرادُه.';
comment on column sale_lines.parent_external_id is
  'رمزُ الصنف الأصل (parent_item_sku) — وبه يُربَط المُعدِّل بما يصفه.';

-- ── بصمةُ محتوى السطر: بها يُفرَّق المُراجَع من المكرَّر ──
--
--  التصديرُ لا يحمل رقمَ نسخةٍ ولا طابعَ إنشاء، فلا سبيل إلى معرفة
--  «أهذا تصديرٌ أحدث؟» إلّا بمقارنة ما يقوله عن السطر نفسِه.
alter table sale_lines add column if not exists content_hash text;

comment on column sale_lines.content_hash is
  'بصمةُ الحقول المؤثِّرة (كمّيّة · حال · سعر · يوم عمل). المفتاحُ يقول «هو هو»، وهذه تقول «تغيّر».';

create index if not exists sale_lines_modifier_idx on sale_lines (parent_external_id) where is_modifier;

-- ═════════ ٢ · صنفُ نقاط البيع: منتجٌ أم خيار؟ ═════════
--
--  في الملفّ ٤٤ صنفاً و١١ مُعدِّلاً، فضاءا رموزٍ لا يتقاطعان. ولو دخل
--  المُعدِّلُ طابورَ «منتجات تحتاج ربطاً» لطُلب من صاحب المقهى أن يربط
--  «Double shots» بصنفٍ يُباع — وهو ليس صنفاً يُباع.

do $$ begin
  create type pos_product_kind as enum ('PRODUCT', 'MODIFIER');
exception when duplicate_object then null; end $$;

alter table pos_products add column if not exists kind pos_product_kind not null default 'PRODUCT';
alter table pos_products add column if not exists parent_external_id text;

comment on column pos_products.kind is
  'خيارُ الإضافة ليس صنفاً يُباع — فلا يدخل طابور الربط ولا يُطلَب له وصفة.';

create index if not exists pos_products_kind_idx on pos_products (kind);

-- ═════════ ٣ · حالُ الصفّ الخام: المُراجَع ═════════
--
--  «مُراجَع» ليست «مكرَّراً»: طلبٌ أُلغي بعد تصدير الأمس يصل اليوم
--  بحال `Void`. فردُّ الملفّ «مكرَّراً» يُبقي في قيدنا مبيعاً لم يقع.

alter type sales_import_row_status add value if not exists 'REVISED';

alter table sales_imports add column if not exists revised_rows integer not null default 0;

comment on column sales_imports.revised_rows is
  'أسطرٌ كانت مقيَّدةً فتغيّر ما يقوله المصدر عنها — حُدّثت ولم تُردّ.';

-- ═════════ ٤ · نسبةُ الفرق إلى الاستهلاك ═════════
--
--  ── ولماذا المقام هو الاستهلاك لا المخزون الختاميّ ──
--
--  السؤال التشغيليّ «كم ضاع ممّا كان ينبغي أن يُصرَف؟». ومقامُ المخزون
--  الختاميّ يتضخّم كلّما قلّ ما بقي على الرفّ: كيلوٌ واحد من ١٠ باقيةً
--  يُقرأ «١٠٪‑» وهو ٣٫٣٪ من ثلاثين صُرفت. فيُنذر أشدَّ ما يكون آخرَ
--  الأسبوع حين يكون الرفّ فارغاً بحقّ.
--
--  والنسبتان تُحفظان: الأساسيّةُ إلى الاستهلاك، والثانيةُ إلى الختاميّ.

alter table inventory_count_lines
  add column if not exists variance_consumption_bp integer;

comment on column inventory_count_lines.variance_consumption_bp is
  'الفرق ÷ الاستهلاك المتوقَّع، بنقاط الأساس — **النسبة الأساسيّة**. و`null` حين يكون الاستهلاك صفراً أو مجهولاً.';
comment on column inventory_count_lines.variance_bp is
  'الفرق ÷ المخزون الختاميّ المتوقَّع — نسبةٌ ثانويّة تُعرَض بجانبها.';

-- ── أساسُ التقييم يُحفَظ مع الرقم لا يُذكَر في تعليق ──
do $$ begin
  create type valuation_basis as enum ('PERIOD_WEIGHTED_AVERAGE', 'LATEST_KNOWN', 'UNKNOWN');
exception when duplicate_object then null; end $$;

alter table inventory_count_lines
  add column if not exists valuation_basis valuation_basis not null default 'UNKNOWN';

comment on column inventory_count_lines.valuation_basis is
  'بم قُوِّم الفرق. والمنهجُ الذي يتغيّر بين تقريرين بلا إعلانٍ يُفسد المقارنة.';

-- ═════════ ٥ · مكوّنٌ يتبع مُعدِّلاً — بنيةً لا استعمالاً ═════════
--
--  «دبل شوت» في هذا المقهى **خيارٌ داخل الوصفة لا إضافةُ بنّ** — قالها
--  صاحبُه نصّاً، ويؤيّدها الملفّ: سعرُه صفر في ١٥٨ مرّة. فلا يُفترَض أنّ
--  المُعدِّل يزيد مكوّناً.
--
--  ويبقى العمود فارغاً حتّى يقول إنسانٌ «هذا المُعدِّل يزيد كذا»:
--  مكوّنٌ بلا `modifier_external_id` يخصّ الوصفة كلَّها، ومكوّنٌ به لا
--  يُحسَب إلّا حين يحمل البندُ ذلك المُعدِّل.

alter table recipe_ingredients
  add column if not exists modifier_external_id text;

comment on column recipe_ingredients.modifier_external_id is
  'مكوّنٌ لا يُحسَب إلّا مع هذا الخيار. فارغٌ = يخصّ الوصفة كلَّها. ولا يُملأ إلّا بقرار إنسان.';

drop index if exists recipe_ingredients_uniq;
create unique index if not exists recipe_ingredients_uniq
  on recipe_ingredients (recipe_version_id, product_id, coalesce(modifier_external_id, '~'));

-- ═════════ ٦ · لا فترتا جردٍ تتداخلان ═════════
--
--  كان القيدُ على تطابق الفترة حرفاً بحرف، وهو يسمح بجردٍ ١–٧ وآخر
--  ٥–١١ في الفرع نفسه: يُحسَب استهلاكُ يومين مرّتين، ويصير افتتاحيُّ
--  الثاني فعليَّ الأوّل وقد مضى عليه يومان.
--
--  ولم يُستعمَل `EXCLUDE` لأنّه يطلب امتداد `btree_gist`، وامتدادٌ
--  ناقصٌ في بيئةٍ يوقف النشر كلَّه.

create or replace function inventory_counts_no_overlap() returns trigger
language plpgsql as $$
declare clash record;
begin
  select c.id, c.period_start, c.period_end into clash
    from inventory_counts c
   where c.id <> new.id
     and coalesce(c.branch_id, '~') = coalesce(new.branch_id, '~')
     and c.period_start <= new.period_end
     and c.period_end   >= new.period_start
   limit 1;

  if found then
    raise exception 'تتداخل فترةُ هذا الجرد مع جردٍ آخر في الفرع نفسه (% → %)',
      clash.period_start, clash.period_end
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists inventory_counts_no_overlap_trg on inventory_counts;
create trigger inventory_counts_no_overlap_trg
  before insert or update of period_start, period_end, branch_id on inventory_counts
  for each row execute function inventory_counts_no_overlap();

-- ═════════ ٧ · التباسُ توقيت الاستلام ═════════
--
--  لا عمودَ استلامٍ في `invoices` — فُحص. وتاريخُ الفاتورة يُستعمَل
--  نائباً **ويُعلَن أنّه نائب**، وما وقع في نافذة الالتباس يُعرَض
--  بنداً في التغطية ولا يُضمّ ولا يُسقَط.
--
--  والعمودُ يُضاف الآن فارغاً: متى وُجد تاريخُ استلامٍ حقيقيّ قُدّم على
--  النائب بلا إعادة كتابةِ استعلام.

alter table invoices add column if not exists received_on text;

comment on column invoices.received_on is
  'تاريخُ دخول البضاعة فعلاً (YYYY-MM-DD). فارغٌ = غير معروف، ويُستعمَل تاريخُ الفاتورة نائباً مُعلَناً.';

alter table invoices drop constraint if exists invoices_received_on_shape;
alter table invoices add constraint invoices_received_on_shape
  check (received_on is null or received_on ~ '^\d{4}-\d{2}-\d{2}$');
