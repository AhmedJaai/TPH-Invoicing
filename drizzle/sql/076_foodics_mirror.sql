-- 076 — مرآةُ فودكس: ما يقوله نظامُ نقاط البيع، محفوظاً كما قاله، ليُقارَن به.
--
-- فودكس **شاهدٌ لا دفتر**: لا جدولَ هنا يدخل حساباً ماليّاً ولا مستحقّاً ولا إقراراً.
-- تُقرأ منه المقارنات — مبيعاتُ الشبكة أمام تسويات البنك، ومشترياتُه أمام فواتيرنا،
-- وصندوقُه أمام ما أُودع — ويُعرَض الفرقُ ولا يُكتب فوق شيء.
--
-- والمفتاحُ الأساسيّ معرّفُ فودكس نفسُه: المزامنةُ مرّتين تُحدِّث ولا تضاعف.
-- واسمُ العميل ورقمُه وعنوانُه لا تُخزَّن — تُسقَط عند القراءة.
--
-- جداولُ جديدة كلُّها: إضافةٌ خالصة، والشيفرةُ القديمة لا تعرفها.

create table if not exists foodics_orders (
  id                 text primary key,
  reference          integer not null,
  business_date      text not null,
  status             integer not null,
  type               integer not null,
  source             integer not null,
  total_minor        integer not null,
  discount_minor     integer not null default 0,
  vat_minor          integer not null default 0,
  original_reference integer,
  opened_at          timestamptz,
  closed_at          timestamptz,
  source_updated_at  timestamptz not null,
  synced_at          timestamptz not null default now()
);
create index if not exists foodics_orders_date_idx on foodics_orders (business_date);
create index if not exists foodics_orders_reference_idx on foodics_orders (reference);
create index if not exists foodics_orders_updated_idx on foodics_orders (source_updated_at);

create table if not exists foodics_order_payments (
  id            text primary key,
  order_id      text not null references foodics_orders(id) on delete cascade,
  -- ١ نقد · ٢ بطاقة · ٥ حسابٌ آجل — النوعُ هويّة، والاسمُ يكتبه صاحبُ الحساب
  method_type   integer not null,
  method_name   text not null,
  -- سالبٌ في طلب المرتجَع: ما رُدّ للعميل
  amount_minor  integer not null,
  tips_minor    integer not null default 0,
  business_date text not null,
  added_at      timestamptz
);
create index if not exists foodics_order_payments_order_idx on foodics_order_payments (order_id);
create index if not exists foodics_order_payments_date_idx on foodics_order_payments (business_date, method_type);

create table if not exists foodics_suppliers (
  id           text primary key,
  name         text not null,
  -- الربطُ بمورّدنا قرارُ إنسان: الاسمُ ليس هويّة، و«مورد حبوب قهوة» عند فودكس خمسةُ مورّدين عندنا
  supplier_id  text references suppliers(id) on delete set null,
  linked_by_id text references users(id),
  linked_at    timestamptz,
  deleted_at   timestamptz,
  synced_at    timestamptz not null default now()
);
create index if not exists foodics_suppliers_supplier_idx on foodics_suppliers (supplier_id);

create table if not exists foodics_purchases (
  id                    text primary key,
  reference             text not null,
  -- ١ شراء · ٤ مرتجَعٌ إلى المورّد
  type                  integer not null,
  status                integer not null,
  business_date         text not null,
  foodics_supplier_id   text references foodics_suppliers(id) on delete set null,
  invoice_number        text,
  invoice_date          text,
  subtotal_minor        integer not null,
  paid_tax_minor        integer not null default 0,
  additional_cost_minor integer not null default 0,
  total_minor           integer not null,
  notes                 text,
  posted_at             timestamptz,
  source_updated_at     timestamptz not null,
  synced_at             timestamptz not null default now()
);
create index if not exists foodics_purchases_date_idx on foodics_purchases (business_date);
create index if not exists foodics_purchases_supplier_idx on foodics_purchases (foodics_supplier_id);

create table if not exists foodics_purchase_items (
  purchase_id    text not null references foodics_purchases(id) on delete cascade,
  position       integer not null,
  item_id        text not null,
  sku            text,
  name           text not null,
  storage_unit   text,
  quantity_milli bigint not null,
  -- كلفةُ السطر كلِّه قبل الضريبة — لا سعرُ الوحدة
  cost_minor     integer not null,
  primary key (purchase_id, position)
);
create index if not exists foodics_purchase_items_sku_idx on foodics_purchase_items (sku);

create table if not exists foodics_tills (
  id                   text primary key,
  business_date        text not null,
  opening_minor        integer,
  closing_minor        integer,
  estimated_cash_minor integer,
  variance_minor       integer,
  opened_at            timestamptz,
  closed_at            timestamptz,
  synced_at            timestamptz not null default now()
);
create index if not exists foodics_tills_date_idx on foodics_tills (business_date);

create table if not exists foodics_sync_runs (
  id            text primary key,
  scope         text not null,
  status        text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  counts        jsonb,
  error         text,
  started_by_id text references users(id)
);
create index if not exists foodics_sync_runs_started_idx on foodics_sync_runs (started_at desc);
