-- ═══════════════════════════════════════════════════════════════════
--  المنتج المعياري ومجال المبيعات
-- ═══════════════════════════════════════════════════════════════════
--
--  المشكلة: `normalized_description` ليس مُعرِّف صنف.
--  «حليب كامل الدسم ٢ لتر» عند مورّد، و«Full Cream Milk 2L» عند آخر،
--  و«لاتيه» في نقطة البيع — ثلاثة أسماء لشيء واحد. وبلا صنف معياري يجمعها
--  لا سبيل إلى: مبيعات ← استهلاك ← تكلفة ← فرق.
--
--  ودرس «العنب» يحكم التصميم: «عنب» عند المحمصة كيلو بنّ، وعند لافا زجاجة
--  كمبوتشا. فالربط **لا يقع تلقائياً على تشابه الاسم**؛ يُقترح ويؤكّده إنسان.
--  ولذلك `supplier_products.confirmed_by_id`: ما لم يؤكّده أحد يبقى اقتراحاً.
--
--  ومجال المبيعات يُنشأ فارغاً: الجداول والواجهة جاهزة، ولا مصدر موصول.
--  البناء الآن يمنع أن يُبنى ما بعده فوق نموذج فواتير.

-- ── الصنف المعياري ──
DO $$ BEGIN
  CREATE TYPE product_category AS ENUM (
    'COFFEE', 'DAIRY', 'BAKERY', 'FOOD', 'BEVERAGE',
    'PACKAGING', 'CLEANING', 'EQUIPMENT', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE base_unit AS ENUM ('KG', 'G', 'L', 'ML', 'PIECE', 'PACK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS products (
  id          text PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text,
  category    product_category NOT NULL DEFAULT 'OTHER',
  -- الوحدة التي يُقاس بها الصنف مهما اختلفت عبوات مورّديه
  base_unit   base_unit NOT NULL DEFAULT 'PIECE',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_name_uniq ON products (name_ar) WHERE is_active;
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);

-- ── صنف المورّد ← الصنف المعياري ──
CREATE TABLE IF NOT EXISTS supplier_products (
  id                     text PRIMARY KEY,
  supplier_id            text NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  -- الوصف المطبَّع كما يكتبه هذا المورّد
  normalized_description text NOT NULL,
  display_name           text NOT NULL,
  product_id             text REFERENCES products(id) ON DELETE SET NULL,
  -- حجم العبوة بالوحدة الأساس: كرتون ١٢ × ١ لتر = 12
  pack_size              numeric(12,3),
  -- من أكّد الربط؛ الفراغ يعني «اقتراح لم يُؤكَّد بعد»
  confirmed_by_id        text REFERENCES users(id),
  confirmed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_uniq
  ON supplier_products (supplier_id, normalized_description);
CREATE INDEX IF NOT EXISTS supplier_products_product_idx ON supplier_products (product_id);

-- بند الفاتورة يشير إلى صنف المورّد، ومنه إلى المعياري
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS supplier_product_id text
  REFERENCES supplier_products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoice_lines_supplier_product_idx
  ON invoice_lines (supplier_product_id);

-- ── المصروفات ──
--  تصنيفات كشف البنك تقول «أين ذهب المال»، لكنّها لا تقول «كم يُتوقَّع».
--  المصروف المتكرّر يُسجَّل مرّة، فيعرف النظام المتوقَّع ويقابله بالفعلي.
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id             text PRIMARY KEY,
  label          text NOT NULL,
  category       tx_category NOT NULL,
  amount_minor   integer NOT NULL,
  -- MONTHLY | QUARTERLY | ANNUAL
  cadence        text NOT NULL DEFAULT 'MONTHLY',
  starts_on      date,
  ends_on        date,
  note           text,
  is_active      boolean NOT NULL DEFAULT true,
  created_by_id  text REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recurring_expenses_active_idx ON recurring_expenses (is_active);

-- ── مجال المبيعات — فارغ، وجاهز ──
--  لا واجهة برمجية لأي مزوّد هنا. الجداول محايدة، والموصل يُكتب لاحقاً
--  ويملؤها. ووجودها الآن يمنع أن تُبنى التقارير فوق نموذج فواتير ثمّ تُعاد.
CREATE TABLE IF NOT EXISTS sales_sources (
  id            text PRIMARY KEY,
  -- اسم المزوّد كما يعرفه المستخدم؛ محايد عن أي واجهة
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'POS',
  is_connected  boolean NOT NULL DEFAULT false,
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_products (
  id             text PRIMARY KEY,
  source_id      text NOT NULL REFERENCES sales_sources(id) ON DELETE CASCADE,
  -- معرّف الصنف عند المزوّد
  external_id    text NOT NULL,
  name           text NOT NULL,
  category       text,
  price_minor    integer,
  product_id     text REFERENCES products(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_products_uniq ON pos_products (source_id, external_id);

CREATE TABLE IF NOT EXISTS sales (
  id              text PRIMARY KEY,
  source_id       text NOT NULL REFERENCES sales_sources(id) ON DELETE CASCADE,
  external_id     text NOT NULL,
  sold_at         timestamptz NOT NULL,
  business_date   date NOT NULL,
  gross_minor     integer NOT NULL,
  discount_minor  integer NOT NULL DEFAULT 0,
  refund_minor    integer NOT NULL DEFAULT 0,
  vat_minor       integer NOT NULL DEFAULT 0,
  net_minor       integer NOT NULL,
  order_count     integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_uniq ON sales (source_id, external_id);
CREATE INDEX IF NOT EXISTS sales_date_idx ON sales (business_date);

CREATE TABLE IF NOT EXISTS sale_lines (
  id              text PRIMARY KEY,
  sale_id         text NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  pos_product_id  text REFERENCES pos_products(id) ON DELETE SET NULL,
  description     text NOT NULL,
  quantity        numeric(12,3) NOT NULL DEFAULT 1,
  unit_price_minor integer NOT NULL,
  line_total_minor integer NOT NULL
);

CREATE INDEX IF NOT EXISTS sale_lines_sale_idx ON sale_lines (sale_id);
