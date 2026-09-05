-- الفروع والحسابات وفترات التسوية.
--
-- ثلاثة مفاهيم غائبة، وغيابها ليس نقصاً في الميزات بل افتراضاً مدفوناً
-- في المخطّط: أنّ المنشأة فرعٌ واحد وحسابٌ واحد، وأنّ «استوردتُ الملفّ»
-- يساوي «انتهيت».
--
-- ولا يُبنى تعدّد المستأجرين هنا: منظّمةٌ واحدة، وفروعٌ تحتها. والفرق
-- أنّ الأولى تحتاج عزلاً كاملاً وهذه تحتاج عموداً.

create table if not exists branches (
  id           text primary key,
  name_ar      text not null,
  name_en      text,
  /** رمزٌ قصير يظهر في الأسماء والتقارير */
  code         text not null unique,
  city         text,
  /** الفرع الأوّل — يُنسَب إليه كل ما سبق إنشاء الفروع */
  is_default   boolean not null default false,
  is_active    boolean not null default true,
  opened_on    text,
  created_at   timestamptz not null default now()
);

/*
 * فرعٌ افتراضيّ واحد لا أكثر.
 *
 * وبدونه لا يُعرف إلى أين تُنسَب البيانات القديمة، ولو صار اثنان
 * لانقسمت الحقيقة.
 */
create unique index if not exists branches_single_default
  on branches (is_default) where is_default;

-- فرعٌ للبيانات القائمة، كي لا يبقى شيء بلا نسبة
insert into branches (id, name_ar, code, is_default)
select 'branch-main', 'الفرع الرئيسي', 'MAIN', true
where not exists (select 1 from branches where is_default);

create table if not exists bank_accounts (
  id                text primary key,
  branch_id         text references branches(id) on delete set null,
  bank_name         text not null,
  /** الاسم كما يسمّيه صاحب العمل */
  label             text not null,
  account_number    text not null,
  iban              text,
  currency          text not null default 'SAR',
  opening_balance_minor integer,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),

  constraint bank_accounts_currency check (char_length(currency) = 3)
);

create unique index if not exists bank_accounts_number_uniq
  on bank_accounts (account_number);

/*
 * فترة التسوية.
 *
 * «استوردتُ الملفّ» ليست «طابقتُ الشهر». والفترة تقول: ما رصيد الافتتاح،
 * وما رصيد الإقفال، وكم استُورد، وكم طُوبق، وما الفرق — ومن راجعه ومتى.
 *
 * وبدونها لا يُعرف هل غُطّي أغسطس كلّه أم نصفه، ولا هل تداخل ملفّان.
 */
do $$ begin
  create type reconciliation_status as enum ('OPEN', 'IN_PROGRESS', 'RECONCILED', 'DISCREPANCY');
exception when duplicate_object then null; end $$;

create table if not exists reconciliation_periods (
  id                    text primary key,
  bank_account_id       text not null references bank_accounts(id) on delete cascade,
  period_start          text not null,
  period_end            text not null,
  opening_balance_minor integer,
  closing_balance_minor integer,
  /** ما استُورد فعلاً في هذه الفترة */
  imported_count        integer not null default 0,
  matched_count         integer not null default 0,
  /** الفرق بين ما يقوله البنك وما نحسبه */
  difference_minor      integer,
  status                reconciliation_status not null default 'OPEN',
  reviewed_by_id        text references users(id),
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),

  constraint reconciliation_period_order check (period_start <= period_end)
);

create unique index if not exists reconciliation_period_uniq
  on reconciliation_periods (bank_account_id, period_start, period_end);

-- ربط ما هو قائم بالفرع والحساب
alter table bank_imports
  add column if not exists bank_account_id text references bank_accounts(id) on delete set null,
  add column if not exists period_start text,
  add column if not exists period_end   text;

alter table bank_transactions
  add column if not exists bank_account_id text references bank_accounts(id) on delete set null;

alter table sales
  add column if not exists branch_id text references branches(id) on delete set null;

alter table pos_products
  add column if not exists branch_id text references branches(id) on delete set null;

alter table expenses
  add column if not exists branch_id text references branches(id) on delete set null;

alter table invoices
  add column if not exists branch_id text references branches(id) on delete set null;

create index if not exists sales_branch_idx     on sales (branch_id);
create index if not exists expenses_branch_idx  on expenses (branch_id);
create index if not exists invoices_branch_idx  on invoices (branch_id);
create index if not exists bank_tx_account_idx  on bank_transactions (bank_account_id);
