-- ═══════════════════════════════════════════════════════════════
--  كتالوج فودكس: الأصناف والعبوات والكلفة المعياريّة
--
--  ثلاثةُ ملفّات فُحصت كلُّها قبل هذه الهجرة: ٦٠ صنفَ مخزون، و٥٨
--  صنفاً يُباع، و١٤٢ سطرَ وصفة. وما تفرضه هنا إضافاتٌ كلُّها — لا
--  حذفَ ولا إعادةَ تسمية، فتُطبَّق مع نشرةٍ واحدة بلا نافذةٍ يعمل
--  فيها الكودُ القديم على مخطّطٍ ناقص.
-- ═══════════════════════════════════════════════════════════════

-- ═════════ ١ · نطاقا الرمز لا يُخلَطان ═════════
--
--  `sk-0002` في ملفّ المنتجات «Espresso»، وفي ملفّ المخزون
--  «Colombia margo». و**٣٩ رمزاً من ٦٠ تتصادم هكذا**: `sk-0007`
--  لاتيه ومصّاصات، و`sk-0018` حليبُ شوفان وكاساتُ ١٢ أونصة،
--  و`sk-0057` خبزُ موزٍ وبنُّ أوغندا.
--
--  فعمودٌ واحد لـ«رمز فودكس» يجعل البنَّ هو الإسبريسو: صنفٌ واحد
--  بوصفةٍ تستهلك نفسَها، وكلفةُ بنٍّ تُنسَب إلى المشروب مرّتين.
--  ولا يظهر ذلك في خطأ — يظهر في رقمٍ خاطئ يبدو سليماً.
--
--  فعمودان، ولكلٍّ فرادتُه. والفرادةُ جزئيّة (`where … is not null`)
--  لأنّ أكثر الأصناف لا رمزَ فودكس لها: بُنيت من بنود الفواتير.

alter table products add column if not exists foodics_item_sku text;
alter table products add column if not exists foodics_product_sku text;

comment on column products.foodics_item_sku is
  'رمزُ الصنف في كتالوج **مخزون** فودكس. نطاقٌ مستقلّ عن رمز المنتج — ٣٩ رمزاً من ٦٠ تحمل معنيين.';
comment on column products.foodics_product_sku is
  'رمزُ الصنف في كتالوج **المنتجات المباعة**. وهو الرمز نفسُه الذي يحمله تصديرُ المبيعات.';

create unique index if not exists products_foodics_item_sku_uniq
  on products (foodics_item_sku) where foodics_item_sku is not null;
create unique index if not exists products_foodics_product_sku_uniq
  on products (foodics_product_sku) where foodics_product_sku is not null;

-- ═════════ ٢ · العبوةُ المعياريّة وكلفتُها ═════════
--
--  فودكس يعرّف الصنف بثلاثة: وحدةِ تخزينٍ («كرتون»)، ووحدةِ صرفٍ
--  («حبة»)، ومعامِلٍ بينهما (٥٠٠). والكلفةُ **لوحدة التخزين**.
--
--  وتُحفَظ الثلاثةُ كما هي ولا يُحفَظ خارجُ قسمتها: كرتونُ المصّاصات
--  ‏٨٥ ريالاً لأربعة آلاف = **٢٫١٢٥ هللة للمصّاصة**. فمن حفظ هللتين
--  أسقط ٦٪ من كلفتها، ومن حفظ ثلاثاً زادها ٤١٪. والقسمةُ تقع عند
--  الاستعمال وتُقرَّب مرّةً واحدة.

alter table products add column if not exists catalog_pack_unit text;
alter table products add column if not exists catalog_pack_milli bigint;
alter table products add column if not exists catalog_pack_cost_minor integer;
alter table products add column if not exists catalog_declared_cost_minor integer;
alter table products add column if not exists catalog_synced_at timestamptz;

comment on column products.catalog_pack_unit is
  'وحدةُ التخزين كما كتبها المصدر («كرتون»، «قالب») — تُعرَض ولا تُترجَم.';
comment on column products.catalog_pack_milli is
  'كم وحدةَ صرفٍ في وحدة التخزين، بالمِلّي: كرتونٌ فيه ٥٠٠ كاس = ٥٠٠٬٠٠٠.';
comment on column products.catalog_pack_cost_minor is
  'كلفةُ وحدة التخزين بالهللات. والقسمةُ على المعامِل تقع عند الاستعمال، بمِلّي‑الهللة.';
comment on column products.catalog_declared_cost_minor is
  'كلفةُ الصنف المباع كما يعلنها المصدر — **خبرٌ يُقارَن بمجموع الوصفة، لا كلفةٌ تُحسَب بها**.';

--  والثلاثةُ تُكتب معاً أو تُترَك معاً: معامِلٌ بلا كلفةٍ لا يُقوِّم،
--  وكلفةٌ بلا معامِلٍ لا يُعرَف لأيّ كمّيّةٍ هي. وهو القيدُ نفسه الذي
--  يربط `content_unit` بـ`content_quantity` في ٠١٧.
alter table products drop constraint if exists products_catalog_pack_shape;
alter table products add constraint products_catalog_pack_shape check (
  (catalog_pack_unit is null and catalog_pack_milli is null and catalog_pack_cost_minor is null)
  or (catalog_pack_unit is not null and catalog_pack_milli is not null and catalog_pack_cost_minor is not null)
);

alter table products drop constraint if exists products_catalog_pack_positive;
alter table products add constraint products_catalog_pack_positive check (
  (catalog_pack_milli is null or catalog_pack_milli > 0)
  and (catalog_pack_cost_minor is null or catalog_pack_cost_minor >= 0)
);

-- ═════════ ٣ · تقييمٌ بالكلفة المعياريّة ═════════
--
--  ترتيبُ التقييم: متوسّطُ شراء الفترة، ثمّ آخرُ كلفةٍ معروفة من
--  الفواتير، ثمّ **كلفةُ الكتالوج** — وهي معياريّةٌ يكتبها المقهى في
--  فودكس، لا ثمنٌ دُفع فعلاً.
--
--  وتأتي أخيراً عمداً: الفاتورةُ واقعةٌ والكتالوجُ تقدير. ولكنّها
--  خيرٌ من «لا كلفة»: صنفٌ لم تصل فاتورتُه هذا الشهر يُقوَّم فرقُه
--  بتقديرٍ **مُعلَن أنّه تقدير**، لا يُترَك بلا رقم.

alter type valuation_basis add value if not exists 'CATALOG';

-- ═════════ ٤ · وصفةٌ مستورَدة تُعرَف من مصدرها ═════════
--
--  كي يُفرَّق ما كتبه إنسانٌ عمّا جاء من الكتالوج: الأوّل لا يُكتَب
--  فوقه استيرادٌ لاحق، والثاني يُحدَّث بلا سؤال.

alter table recipe_versions add column if not exists source text;

comment on column recipe_versions.source is
  'من أين جاءت هذه النسخة: NULL أو HUMAN لمن كتبها بيده، FOODICS_CATALOG لما استُورد. وما كتبه إنسانٌ لا يُكتَب فوقه.';

-- ═════════ ٥ · والاسمُ نطاقان كما أنّ الرمزَ نطاقان ═════════
--
--  كان `products_name_uniq` على الاسم وحده لكلّ صنفٍ فعّال. وهو
--  صحيحٌ في أصل وضعه: الجدولُ مبنيٌّ من بنود الفواتير، وصنفان
--  بالاسم نفسه تكرارٌ يُفسد المقارنة.
--
--  لكنّ الكتالوج أظهر حالةً صحيحة يمنعها القيد: **«Karkade» مشروبٌ
--  يُباع و«Karkade» زهرُ كركديهٍ يُخزَّن** — وكذلك «Kombucha» علبةً
--  تُشترى ومشروباً يُباع. وهما شيئان لا شيءٌ واحد: أحدُهما يُعَدّ على
--  الرفّ والآخر يُصنَع من الأوّل.
--
--  فالفرادةُ تُقيَّد بالدور لا تُلغى: اسمٌ واحد بين ما يُخزَّن، واسمٌ
--  واحد بين ما يُباع. وصنفٌ هو الاثنان معاً (قارورةُ ماءٍ تُشترى
--  وتُباع كما هي) يدخل الفهرسين، فيبقى فريداً فيهما.
--
--  ولا يضعُف الحرسُ بهذا: كلُّ ما في الجدول اليوم `is_stock_item`،
--  فنطاقُه هو النطاقُ القديم بعينه.

drop index if exists products_name_uniq;

create unique index if not exists products_stock_name_uniq
  on products (name_ar) where is_active and is_stock_item;

create unique index if not exists products_menu_name_uniq
  on products (name_ar) where is_active and is_menu_item;

-- ═════════ ٦ · ومعدَّلُ الكلفة يُحفَظ بدقّته ═════════
--
--  `unit_cost_minor` هللاتٌ صحيحة لوحدة الأساس. وذلك يكفي للكيلو
--  (‏٩٦٫٢٥ ريالاً = ‏٩٦٢٥ هللة بالضبط) ويكذب في الجرام: بنُّ إثيوبيا
--  ‏٨٨ ريالاً للكيلو = **٨٫٨ هللة للجرام**، فيُعرَض «٩» — زيادةُ
--  ‏٢٫٣٪ في عمودٍ اسمُه الكلفة.
--
--  فيُحفَظ المعدَّلُ بمِلّي‑الهللة، ويبقى `unit_cost_minor` للعرض
--  السريع وللتوافق مع ما كُتب قبله.

alter table inventory_count_lines
  add column if not exists unit_cost_milli_minor bigint;

comment on column inventory_count_lines.unit_cost_milli_minor is
  'معدَّلُ كلفة وحدة الأساس بمِلّي‑الهللة — ٨٫٨ هللة للجرام تُحفَظ ٨٨٠٠. وعليه تُحسَب كلفةُ الفرق.';
