-- 079 — شاهدُ المخزون من فودكس: ما عدّه إنسانٌ على الرفّ، وما صرفه فودكس لكلّ صنف.
--
-- في حساب المقهى ٣٧ جرداً أسبوعيّاً يكتبها من يعدّ الرفَّ ليلةَ السبت، و٢١ ألفَ حركةِ
-- صرفٍ (حركةٌ لكلّ طلب) لم نكن نقرأ منها شيئاً. الكمّيّةُ المعدودة **واقعةٌ كتبها إنسان**
-- فتُحفَظ كما كُتبت؛ و«الفرق» الذي يحسبه فودكس بجانبها حسابُه هو — يُحفَظ شاهداً ولا
-- يُبنى عليه (رصيدُه الدفتريّ سالبٌ لأصنافٍ لم تُدخَل مشترياتُها).
--
-- والصرفُ يُجمَع يوماً بصنفٍ بنوع: ٨ صرفُ طلب · ٩ ردُّ مرتجَع · ١٠ هدرُ طلب. ويومٌ قُرئ
-- كلُّه له صفٌّ في `foodics_move_days` — فيُفرَّق بين «لم يُصرَف شيء» و«لم نقرأ».
--
-- إضافةٌ خالصة: جداولُ جديدة وعمودان يقبلان الفراغ. لا يدخل منها مالٌ دفتراً.

create table if not exists foodics_stock_counts (
  id                text primary key,
  reference         text not null,
  business_date     text not null,
  -- آخرُ يومِ بيعٍ سبق العدّ: العدُّ يقع بعد الإقفال فجراً، فيومُه عند فودكس قد يكون
  -- السبتَ أو الأحد والرفُّ واحد. يُشتقّ من لحظة الإنشاء (ناقص ١٢ ساعة بتوقيت الرياض).
  stock_day         text not null,
  status            integer not null,
  creator_name      text,
  counted_at        timestamptz,
  source_updated_at timestamptz not null,
  synced_at         timestamptz not null default now()
);
create index if not exists foodics_stock_counts_day_idx on foodics_stock_counts (stock_day);

create table if not exists foodics_stock_count_items (
  count_id                text not null references foodics_stock_counts(id) on delete cascade,
  item_id                 text not null,
  sku                     text,
  name                    text not null,
  storage_unit            text,
  ingredient_unit         text,
  -- كم وحدةَ صرفٍ في وحدة التخزين، بالمِلّي — كما قالها فودكس يومَ القراءة
  factor_milli            bigint,
  -- المعدودُ بوحدة التخزين، بالمِلّي
  quantity_milli          bigint not null,
  -- حسابُ فودكس للفرق — شاهدٌ لا حكم
  variance_quantity_milli bigint,
  variance_cost_minor     integer,
  primary key (count_id, item_id)
);
create index if not exists foodics_stock_count_items_sku_idx on foodics_stock_count_items (sku);

create table if not exists foodics_item_moves (
  business_date    text not null,
  -- ٨ صرفُ طلب · ٩ ردُّ مرتجَع · ١٠ هدرُ طلب
  kind             integer not null,
  item_id          text not null,
  sku              text,
  name             text not null,
  storage_unit     text,
  ingredient_unit  text,
  -- بوحدة التخزين، جزءاً من مليون: مصّاصةٌ من كرتون أربعة آلاف = ‎250‎
  storage_micro    bigint not null,
  -- بوحدة الصرف بالمِلّي حيث عُرف المعامِل — `null` لم يُعرَف
  ingredient_milli bigint,
  -- كلفةُ فودكس، جزءاً من مئة ألفٍ من الريال — شاهدٌ لا كلفتُنا
  cost_micro       bigint not null,
  tx_count         integer not null,
  primary key (business_date, kind, item_id)
);
create index if not exists foodics_item_moves_sku_idx on foodics_item_moves (sku, business_date);

create table if not exists foodics_move_days (
  business_date text primary key,
  tx_count      integer not null,
  synced_at     timestamptz not null default now()
);

alter table foodics_tills add column if not exists user_name text;
alter table foodics_tills add column if not exists device_name text;
