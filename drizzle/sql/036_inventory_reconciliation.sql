-- ══════════════════════════════════════════════════════════════════
--  الجرد الأسبوعيّ — تسويةُ المخزون
-- ══════════════════════════════════════════════════════════════════
--
--  السؤال: «أين ذهب ما اشتريتُه؟»
--
--  يُحسَب استقلالاً ما كان ينبغي أن يُستهلَك — من المبيعات الفعليّة
--  ووصفاتها — ثمّ يُقابَل بما وُجد على الرفّ. والفرقُ يُعرَض **باسمه**:
--  «فرق الجرد». لا «هدر» ولا «فاقد» — فلكلٍّ منهما دليلٌ لا نملكه:
--  قد يكون وصفةً خاطئة، أو جرعةً زائدة، أو عدّاً مغلوطاً، أو شراءً لم
--  يُقيَّد، أو تحويلاً لم يُسجَّل.
--
--  ── الكمّيّة عددٌ صحيح ──
--
--  المالُ بالهللات، **والكمّيّة بالمِلّي**: مِلّي‑جرام للوزن،
--  ومِلّي‑مليلتر للحجم، ومِلّي‑حبّة للعدّ. فـ١٨ جراماً = ‏١٨٬٠٠٠،
--  و٢٠ كيلو = ‏٢٠٬٠٠٠٬٠٠٠. فلا يُنتج ١٠٠ × ٢٠ جراماً «1.9999 كجم».
--  والأعمدةُ تحمل اللاحقة `_milli` في اسمها كي لا تُقرأ وحداتِ أساس.
--
--  ── ولا شيءَ يُحذَف هنا ولا يُعاد تسميتُه ──
--
--  كلُّ ما في هذه الهجرة إضافة: جداولُ جديدة وأعمدةٌ بقيمٍ افتراضيّة.
--  فالنافذةُ بين الهجرة والكود آمنةٌ — الكودُ القديم لا يرى شيئاً منها.

-- ═════════════════ ١ · الصنف: أيُعَدّ؟ أيُباع؟ ═════════════════
--
--  صنفُ القائمة («سبانيش لاتيه») وصنفُ المخزون («بنّ») كلاهما صفٌّ في
--  `products` — لا جدولَ ثانٍ. وذلك لأنّ `pos_products.product_id` كان
--  يشير إلى `products` أصلاً منذ `005`، ولأنّ صنفاً واحداً قد يكون
--  الاثنين معاً: قارورةُ ماءٍ تُشترى وتُعَدّ وتُباع كما هي.
--
--  والافتراضُ يحفظ ما مضى: كلُّ ما في الجدول اليوم مبنيٌّ من بنود
--  الفواتير، فهو صنفُ مخزونٍ لا صنفُ قائمة.

alter table products add column if not exists is_stock_item boolean not null default true;
alter table products add column if not exists is_menu_item  boolean not null default false;

comment on column products.is_stock_item is 'يُعَدّ في الجرد ويُشترى — الافتراض، فكلّ ما بُني من الفواتير كذلك.';
comment on column products.is_menu_item  is 'يُباع في نقاط البيع وله وصفة — يُوسَم صراحةً عند ربط صنف فودكس.';

create index if not exists products_menu_idx  on products (is_menu_item)  where is_menu_item;
create index if not exists products_stock_idx on products (is_stock_item) where is_stock_item;

-- ═════════════════ ٢ · الوصفة ونسخُها ═════════════════

do $$ begin
  create type recipe_status as enum ('DRAFT', 'ACTIVE', 'ARCHIVED');
exception when duplicate_object then null; end $$;

-- الوصفةُ هويّةٌ ثابتة تعلو نسخَها: صنفٌ واحد ← وصفةٌ واحدة، ولها تاريخ.
create table if not exists recipes (
  id            text primary key,
  product_id    text not null unique references products(id) on delete cascade,
  note          text,
  is_active     boolean not null default true,
  created_by_id text references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table recipes is 'وصفةُ صنفٍ يُباع. النسخُ تحتها، والحسابُ يأخذ النسخةَ السارية في تاريخ البيعة.';

-- النسخةُ بفترة سريانها. وبلا هذا يُعاد حسابُ سبتمبر بوصفة أكتوبر —
-- وهو بالضبط ما يجعل تقريراً مقفَلاً يتغيّر بعد إقفاله.
create table if not exists recipe_versions (
  id              text primary key,
  recipe_id       text not null references recipes(id) on delete cascade,
  version         integer not null,
  status          recipe_status not null default 'DRAFT',
  -- YYYY-MM-DD · يوم بدء السريان (شاملاً)
  effective_from  text not null,
  -- فارغٌ يعني «سارية إلى الآن» (شاملاً حين يُكتب)
  effective_to    text,
  -- ناتجُ الوصفة: ٢ لتر تُقسَّم على أكوابٍ — اختياريّ، و`null` لا يُقرأ واحداً
  yield_quantity_milli bigint,
  yield_unit      base_unit,
  note            text,
  created_by_id   text references users(id),
  activated_by_id text references users(id),
  activated_at    timestamptz,
  created_at      timestamptz not null default now(),

  constraint recipe_versions_period_ok
    check (effective_to is null or effective_to >= effective_from),
  constraint recipe_versions_from_shape check (effective_from ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint recipe_versions_to_shape   check (effective_to is null or effective_to ~ '^\d{4}-\d{2}-\d{2}$'),
  -- الناتجُ يُذكَر كاملاً أو يُترَك كاملاً — كمّيّةٌ بلا وحدةٍ لا تعني شيئاً
  constraint recipe_versions_yield_paired
    check ((yield_quantity_milli is null) = (yield_unit is null)),
  constraint recipe_versions_yield_positive
    check (yield_quantity_milli is null or yield_quantity_milli > 0)
);

create unique index if not exists recipe_versions_number_uniq on recipe_versions (recipe_id, version);
create index if not exists recipe_versions_effective_idx on recipe_versions (recipe_id, effective_from);
create index if not exists recipe_versions_active_idx on recipe_versions (status) where status = 'ACTIVE';

-- ── لا تتداخل نسختان ساريتان لوصفةٍ واحدة ──
--
--  ولا يُترَك هذا للشيفرة: الكتابةُ تأتي من مسارين لا يعرف أحدهما
--  الآخر (الواجهة، ونصُّ تهيئة). ولو تداخلتا لكان لبيعةٍ واحدة
--  وصفتان — ولا يُعرَف أيُّهما حَكَم.
--
--  ولم يُستعمَل `EXCLUDE` لأنّه يطلب امتداد `btree_gist`، وامتدادٌ
--  ناقصٌ في بيئةٍ يوقف النشر كلَّه.

create or replace function recipe_versions_no_overlap() returns trigger
language plpgsql as $$
declare clash text;
begin
  if new.status <> 'ACTIVE' then return new; end if;

  select v.id into clash
    from recipe_versions v
   where v.recipe_id = new.recipe_id
     and v.id <> new.id
     and v.status = 'ACTIVE'
     and v.effective_from <= coalesce(new.effective_to, '9999-12-31')
     and coalesce(v.effective_to, '9999-12-31') >= new.effective_from
   limit 1;

  if clash is not null then
    raise exception 'تتداخل فترةُ هذه النسخة مع نسخةٍ ساريةٍ أخرى للوصفة نفسها — أغلِق السابقة أوّلاً'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists recipe_versions_no_overlap_trg on recipe_versions;
create trigger recipe_versions_no_overlap_trg
  before insert or update on recipe_versions
  for each row execute function recipe_versions_no_overlap();

-- المكوّن: صنفُ مخزونٍ وكمّيّةٌ ووحدة.
create table if not exists recipe_ingredients (
  id                 text primary key,
  recipe_version_id  text not null references recipe_versions(id) on delete cascade,
  product_id         text not null references products(id),
  -- بالمِلّي من `unit` المذكورة: ١٨ جراماً ← unit=G · 18000
  quantity_milli     bigint not null,
  unit               base_unit not null,
  -- فاقدُ التجهيز بنقاط الأساس (١٠٠ = ١٪) — يرفع الاستهلاك، و`null` لا يُقرأ صفراً مؤكَّداً
  prep_loss_bp       integer,
  note               text,

  constraint recipe_ingredients_qty_positive check (quantity_milli > 0),
  -- الفاقدُ التامّ يعني قسمةً على صفر — ولا معنى له
  constraint recipe_ingredients_loss_bounds check (prep_loss_bp is null or (prep_loss_bp >= 0 and prep_loss_bp < 10000))
);

create unique index if not exists recipe_ingredients_uniq on recipe_ingredients (recipe_version_id, product_id);
create index if not exists recipe_ingredients_product_idx on recipe_ingredients (product_id);

comment on column recipe_ingredients.quantity_milli is 'بالمِلّي من الوحدة المذكورة — عددٌ صحيح، فلا كسرَ عائم في حسابٍ يتكرّر ألفَ مرّة.';

-- ═════════════════ ٣ · استيرادُ المبيعات ═════════════════

do $$ begin
  create type sales_import_status as enum ('PENDING', 'IMPORTED', 'PARTIAL', 'FAILED', 'DUPLICATE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sales_import_row_status as enum ('PARSED', 'SKIPPED', 'ERROR', 'DUPLICATE');
exception when duplicate_object then null; end $$;

-- هويّةُ الملفّ المرفوع. وبصمتُه فريدة: الملفّ عينُه مرّتين يُردّ
-- بإعلانٍ لا بصمت — الدرسُ نفسه الذي كلّف كشفاً بنكياً ثلاثَ مرّات.
create table if not exists sales_imports (
  id              text primary key,
  source_id       text not null references sales_sources(id) on delete cascade,
  branch_id       text references branches(id) on delete set null,
  file_name       text not null,
  file_sha256     text not null,
  byte_size       integer,
  -- أيُّ محوِّلٍ قرأه، وأيُّ شكلٍ كان: FOODICS_ORDERS · FOODICS_PRODUCT_MIX
  adapter         text not null,
  shape           text,
  period_start    text,
  period_end      text,
  status          sales_import_status not null default 'PENDING',
  total_rows      integer not null default 0,
  imported_rows   integer not null default 0,
  skipped_rows    integer not null default 0,
  error_rows      integer not null default 0,
  duplicate_rows  integer not null default 0,
  -- ما لم يُقرأ ولماذا — يُعرَض للمستخدم لا يُدفَن في سجلّ
  messages        jsonb,
  imported_by_id  text references users(id),
  created_at      timestamptz not null default now()
);

create unique index if not exists sales_imports_sha_uniq on sales_imports (file_sha256);
create index if not exists sales_imports_period_idx on sales_imports (period_start, period_end);

-- الصفُّ الخام كما ورد، قبل أيّ تحويل. **ولا صفَّ يُرمى صامتاً.**
create table if not exists sales_import_rows (
  id          text primary key,
  import_id   text not null references sales_imports(id) on delete cascade,
  row_number  integer not null,
  raw         jsonb not null,
  status      sales_import_row_status not null,
  reason      text,
  sale_id     text references sales(id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists sales_import_rows_uniq on sales_import_rows (import_id, row_number);
create index if not exists sales_import_rows_status_idx on sales_import_rows (import_id, status);

-- ── أعمدةٌ على مجال المبيعات القائم ──
--
--  المرتجَع والملغى والمجانيّ ليست تفاصيلَ عرض: المرتجَع يُنقص
--  الاستهلاك، والملغى يُستبعَد كلُّه (لم يُصنَع أصلاً)، والمجانيّ
--  يُستهلَك فعلاً ويُعرَض على حدة. ومن جمعها في رقمٍ واحد أخطأ في
--  ثلاثة.

alter table sales add column if not exists import_id text references sales_imports(id) on delete set null;
alter table sales add column if not exists is_void boolean not null default false;

alter table sale_lines add column if not exists is_refund boolean not null default false;
alter table sale_lines add column if not exists is_void boolean not null default false;
alter table sale_lines add column if not exists is_complimentary boolean not null default false;
alter table sale_lines add column if not exists modifiers jsonb;

create index if not exists sales_import_idx on sales (import_id);

comment on column sale_lines.is_void is 'ملغاة — تُستبعَد من الاستهلاك كلّها: لم تُصنَع.';
comment on column sale_lines.is_complimentary is 'مجانيّة — صُنعت فعلاً فتُستهلَك، وتُعرَض على حدة.';

-- ═════════════════ ٤ · جلسةُ الجرد ═════════════════

do $$ begin
  create type inventory_count_status as enum ('DRAFT', 'FINALISED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type inventory_readiness as enum ('READY', 'PARTIAL', 'BLOCKED');
exception when duplicate_object then null; end $$;

create table if not exists inventory_counts (
  id             text primary key,
  branch_id      text references branches(id) on delete set null,
  period_start   text not null,
  period_end     text not null,
  status         inventory_count_status not null default 'DRAFT',
  readiness      inventory_readiness,
  -- جدولُ التغطية كما حُسب: مبيعاتٌ · ربطٌ · وصفاتٌ · مشتريات
  coverage       jsonb,
  note           text,
  started_by_id  text references users(id),
  started_at     timestamptz not null default now(),
  finalised_by_id text references users(id),
  finalised_at   timestamptz,
  reopened_by_id text references users(id),
  reopened_at    timestamptz,
  reopen_reason  text,
  reopen_count   integer not null default 0,

  constraint inventory_counts_period_ok check (period_end >= period_start),
  constraint inventory_counts_from_shape check (period_start ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint inventory_counts_to_shape   check (period_end ~ '^\d{4}-\d{2}-\d{2}$'),
  -- المقفَل له مُقفِلُه ووقتُه — وإلّا كان «مقفَلاً» بلا من أقفله
  constraint inventory_counts_finalised_stamped
    check (status <> 'FINALISED' or finalised_at is not null)
);

-- جردٌ واحد للفترة الواحدة في الفرع الواحد. و`coalesce` مقصودة:
-- ‏`NULL <> NULL` يفتح باب التكرار بدل أن يسدّه — الدرسُ من `014`.
create unique index if not exists inventory_counts_period_uniq
  on inventory_counts (coalesce(branch_id, '~'), period_start, period_end);
create index if not exists inventory_counts_status_idx on inventory_counts (status, period_end desc);

-- سطرُ الصنف: كلُّ حدٍّ في المعادلة عمودٌ يقبل `NULL`.
-- و`NULL` هنا تعني «غير معروف» لا «صفر» — القيدُ الرابع في المشروع.
create table if not exists inventory_count_lines (
  id                text primary key,
  count_id          text not null references inventory_counts(id) on delete cascade,
  product_id        text not null references products(id),
  -- وحدةُ الأساس مجمَّدةٌ هنا: لو غُيّرت وحدةُ الصنف لاحقاً بقي التقرير مقروءاً
  base_unit         base_unit not null,

  opening_milli               bigint,
  purchases_milli             bigint,
  adjustments_in_milli        bigint not null default 0,
  adjustments_out_milli       bigint not null default 0,
  theoretical_consumption_milli bigint,
  recorded_waste_milli        bigint not null default 0,
  theoretical_closing_milli   bigint,
  actual_milli                bigint,
  variance_milli              bigint,
  -- بنقاط الأساس (١٠٠ = ١٪) — عددٌ صحيح، ولا يُحسَب حين يكون المتوقَّع صفراً أو مجهولاً
  variance_bp                 integer,
  unit_cost_minor             integer,
  variance_cost_minor         integer,
  -- لماذا جُهل ما جُهل: قائمةُ أسبابٍ تُعرَض للقارئ
  flags             jsonb,
  note              text,
  counted_by_id     text references users(id),
  counted_at        timestamptz,
  created_at        timestamptz not null default now(),

  constraint inventory_count_lines_adjust_nonneg
    check (adjustments_in_milli >= 0 and adjustments_out_milli >= 0 and recorded_waste_milli >= 0)
);

create unique index if not exists inventory_count_lines_uniq on inventory_count_lines (count_id, product_id);
create index if not exists inventory_count_lines_product_idx on inventory_count_lines (product_id);

-- ── المقفَل لا يُكتَب فيه ──
--
--  كما يمنع `028` الكتابةَ في شهرٍ مقفَل. والحارسُ في القاعدة لا في
--  الخدمة: التقريرُ التاريخيّ الذي يتغيّر بعد إقفاله ليس تقريراً.
--  **وإعادةُ الفتح تُحوّل الحال أوّلاً**، ثمّ يُكتَب.

create or replace function inventory_count_lines_locked() returns trigger
language plpgsql as $$
declare s inventory_count_status;
begin
  select c.status into s from inventory_counts c
   where c.id = coalesce(new.count_id, old.count_id);

  if s = 'FINALISED' then
    raise exception 'هذا الجرد مقفَل — أعِد فتحَه أوّلاً إن أردت تعديله'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists inventory_count_lines_locked_trg on inventory_count_lines;
create trigger inventory_count_lines_locked_trg
  before insert or update or delete on inventory_count_lines
  for each row execute function inventory_count_lines_locked();

-- ── اللقطة: أصولُ كلّ رقم ──
--
--  الأرقامُ مجمَّدةٌ في الأسطر، وهذه تحفظ **بم حُسبت**: نسخُ الوصفات،
--  ومعرّفاتُ الاستيرادات، ونطاقُ أسطر الشراء، ونسخةُ المحرّك. فيُعاد
--  إنتاجُ التقرير عند الحاجة إلى إثبات، لا يُصدَّق وحده.
create table if not exists inventory_count_snapshots (
  count_id        text primary key references inventory_counts(id) on delete cascade,
  engine_version  text not null,
  payload         jsonb not null,
  provenance      jsonb not null,
  checksum        text not null,
  computed_at     timestamptz not null default now()
);

-- واللقطةُ لا تُعدَّل ولا تُحذَف ما دام جردُها مقفَلاً — كسجلّ التدقيق.
create or replace function inventory_snapshot_immutable() returns trigger
language plpgsql as $$
declare s inventory_count_status;
begin
  select c.status into s from inventory_counts c where c.id = old.count_id;
  if s = 'FINALISED' then
    raise exception 'لقطةُ جردٍ مقفَل لا تُعدَّل ولا تُحذَف — أعِد فتحَ الجرد إن أردت إعادةَ حسابه'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists inventory_snapshot_immutable_trg on inventory_count_snapshots;
create trigger inventory_snapshot_immutable_trg
  before update or delete on inventory_count_snapshots
  for each row execute function inventory_snapshot_immutable();

-- ═════════════════ ٥ · الحركاتُ اليدويّة ═════════════════

do $$ begin
  create type inventory_movement_kind as enum
    ('OPENING', 'ADJUST_IN', 'ADJUST_OUT', 'TRANSFER_IN', 'TRANSFER_OUT');
exception when duplicate_object then null; end $$;

-- الرصيدُ الافتتاحيّ الصريح، والتسوية، والنقل بين الفروع.
-- وهي المدخلاتُ التي لا يعرفها لا الشراءُ ولا البيع.
create table if not exists inventory_movements (
  id             text primary key,
  product_id     text not null references products(id),
  branch_id      text references branches(id) on delete set null,
  kind           inventory_movement_kind not null,
  quantity_milli bigint not null,
  unit           base_unit not null,
  occurred_on    text not null,
  note           text,
  count_id       text references inventory_counts(id) on delete set null,
  created_by_id  text references users(id),
  created_at     timestamptz not null default now(),

  constraint inventory_movements_qty_positive check (quantity_milli > 0),
  constraint inventory_movements_date_shape check (occurred_on ~ '^\d{4}-\d{2}-\d{2}$')
);

create index if not exists inventory_movements_product_idx on inventory_movements (product_id, occurred_on);
create index if not exists inventory_movements_count_idx on inventory_movements (count_id);

-- ═════════════════ ٦ · سجلُّ الهدر ═════════════════
--
--  يُبنى الآن ويُملأ متى شاء صاحبه. ومتى امتلأ انفصل ما يُعرَض اليوم
--  «فرقاً غير مفسَّر» إلى قسمين: **هدرٌ مسجَّل** و**فرقٌ باقٍ**.
--  ولا يُبنى منتجُ إدارةِ هدرٍ الآن — يُبنى الجدولُ نظيفاً فحسب.

do $$ begin
  create type waste_reason as enum
    ('EXPIRED', 'SPILLED', 'FAILED_PREP', 'CALIBRATION', 'STAFF_DRINK', 'DAMAGED', 'OTHER');
exception when duplicate_object then null; end $$;

create table if not exists waste_records (
  id             text primary key,
  product_id     text not null references products(id),
  branch_id      text references branches(id) on delete set null,
  quantity_milli bigint not null,
  unit           base_unit not null,
  occurred_on    text not null,
  reason         waste_reason not null,
  note           text,
  evidence_url   text,
  count_id       text references inventory_counts(id) on delete set null,
  created_by_id  text references users(id),
  created_at     timestamptz not null default now(),

  constraint waste_records_qty_positive check (quantity_milli > 0),
  constraint waste_records_date_shape check (occurred_on ~ '^\d{4}-\d{2}-\d{2}$')
);

create index if not exists waste_records_product_idx on waste_records (product_id, occurred_on);
create index if not exists waste_records_count_idx on waste_records (count_id);

comment on table waste_records is
  'الهدرُ المسجَّل — ومتى امتلأ انفصل عنه «الفرق غير المفسَّر». ولا يُسمّى الفرقُ هدراً قبل أن يُسجَّل هنا.';
