-- إكمال مجال المبيعات قبل نقاط البيع.
--
-- الجداول القائمة تحفظ «كم بيع»، ولا تحفظ **كيف دُفع** ولا **ما رُدّ**.
-- وبدونهما لا يُسأل السؤال الذي يُنتظَر من الربط:
--
--   بعتُ تسعة آلاف، ووصلني ثمانية آلاف وسبعمئة وستّون — أين الفرق؟
--
-- ولا يُملأ شيء من هذه بيانات وهمية: تُنشأ فارغةً وتنتظر موصلاً.

/*
 * اسمٌ مستقلّ عمداً: `payment_method` موجودٌ لدفعات المورّدين بقيمٍ أخرى.
 * وطرق دفع البيعة شيءٌ آخر — ودمجهما يخلط مفهومين لتشابه اسميهما.
 */
do $$ begin
  create type sale_payment_method as enum (
    'CASH', 'MADA', 'VISA', 'MASTERCARD', 'AMEX', 'APPLE_PAY', 'STC_PAY', 'TRANSFER', 'OTHER'
  );
exception when duplicate_object then null; end $$;

/*
 * تفصيل دفع البيعة.
 *
 * البيعة الواحدة قد تُدفع بطريقتين — نصفها نقداً ونصفها بطاقة — فهي
 * أسطر لا عمود.
 */
create table if not exists sale_payments (
  id           text primary key,
  sale_id      text not null references sales(id) on delete cascade,
  method       sale_payment_method not null,
  amount_minor integer not null,
  /** معرّف العملية لدى الشبكة، إن وُجد — أساس مطابقة التسوية */
  external_id  text,
  created_at   timestamptz not null default now(),

  constraint sale_payments_positive check (amount_minor > 0)
);

create index if not exists sale_payments_sale_idx   on sale_payments (sale_id);
create index if not exists sale_payments_method_idx on sale_payments (method);

/*
 * المرتجع سجلٌّ لا رقم.
 *
 * كان `sales.refund_minor` رقماً بلا سبب ولا صنف ولا تاريخ. فإذا سُئل
 * «لماذا انخفضت المبيعات؟» لم يُعرف: كم مرتجعاً، وأيّ صنف، وأيّ يوم.
 */
create table if not exists refunds (
  id             text primary key,
  sale_id        text references sales(id) on delete set null,
  source_id      text not null references sales_sources(id) on delete cascade,
  external_id    text not null,
  branch_id      text references branches(id) on delete set null,
  refunded_at    timestamptz not null,
  business_date  text not null,
  amount_minor   integer not null,
  reason         text,
  created_at     timestamptz not null default now(),

  constraint refunds_positive check (amount_minor > 0)
);

create unique index if not exists refunds_external_uniq on refunds (source_id, external_id);
create index if not exists refunds_date_idx on refunds (business_date);

create table if not exists refund_lines (
  id             text primary key,
  refund_id      text not null references refunds(id) on delete cascade,
  pos_product_id text references pos_products(id) on delete set null,
  description    text not null,
  quantity       numeric(12, 3) not null default 1,
  amount_minor   integer not null,

  constraint refund_lines_positive check (amount_minor > 0)
);

create index if not exists refund_lines_refund_idx on refund_lines (refund_id);

/*
 * دفعة التسوية: ما تُودعه الشبكة في الحساب.
 *
 * وهي الجسر بين المبيعات والبنك. وبدونها لا يُقارَن ما بيع بما وصل،
 * ولا يُعرف أنّ الفرق رسمٌ أو ضريبةٌ أو تأخّرُ يوم.
 */
create table if not exists settlement_batches (
  id                text primary key,
  source_id         text references sales_sources(id) on delete set null,
  branch_id         text references branches(id) on delete set null,
  /** رقم التاجر لدى الشبكة */
  merchant_id       text,
  scheme            text,
  batch_date        text not null,
  external_id       text,
  gross_minor       integer not null default 0,
  fee_minor         integer not null default 0,
  vat_minor         integer not null default 0,
  net_minor         integer not null default 0,
  /** الحركة البنكية التي وصلت بها — إن طُوبقت */
  bank_transaction_id text references bank_transactions(id) on delete set null,
  created_at        timestamptz not null default now()
);

create unique index if not exists settlement_batch_uniq
  on settlement_batches (merchant_id, batch_date, scheme)
  where merchant_id is not null;

create index if not exists settlement_bank_idx
  on settlement_batches (bank_transaction_id) where bank_transaction_id is not null;
