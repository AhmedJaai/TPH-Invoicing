-- المصروف الفعلي، مقابل المصروف المتوقَّع.
--
-- كان `recurring_expenses` يقول «كم يُتوقَّع»، والفعليّ يُشتقّ من كشف
-- البنك عند العرض. وذلك يترك ثلاث فجوات: مصروفٌ دُفع نقداً لا يظهر،
-- ومصروفٌ تصله فاتورة لا يُحسب مصروفاً، ولا يُعرف هل دُفع إيجار هذا
-- الشهر أصلاً.
--
-- فهذا الجدول يوحّد المصروف الفعلي من مصادره الثلاثة، ويربطه بما كان
-- متوقَّعاً منه.

do $$ begin
  create type expense_source as enum ('BANK', 'INVOICE', 'MANUAL');
exception when duplicate_object then null; end $$;

create table if not exists expenses (
  id                    text primary key,
  period_month          text not null,
  occurred_on           text not null,
  category              tx_category not null,
  label                 text not null,
  -- يُخزَّن موجباً دائماً: الاتجاه معروف من كونه مصروفاً
  amount_minor          integer not null,
  source                expense_source not null,
  bank_transaction_id   text references bank_transactions(id) on delete set null,
  invoice_id            text references invoices(id) on delete set null,
  recurring_expense_id  text references recurring_expenses(id) on delete set null,
  note                  text,
  created_by_id         text references users(id),
  created_at            timestamptz not null default now(),

  constraint expenses_amount_positive check (amount_minor > 0),

  -- المصدر يلزمه مرجعه: «من البنك» بلا حركة بنكية ادّعاء لا مصدر
  constraint expenses_source_has_reference check (
    (source = 'BANK'    and bank_transaction_id is not null) or
    (source = 'INVOICE' and invoice_id is not null) or
    (source = 'MANUAL')
  )
);

-- حركة بنكية واحدة لا تُقيَّد مصروفاً مرّتين، ولا فاتورة واحدة
create unique index if not exists expenses_bank_tx_uniq
  on expenses (bank_transaction_id) where bank_transaction_id is not null;

create unique index if not exists expenses_invoice_uniq
  on expenses (invoice_id) where invoice_id is not null;

create index if not exists expenses_period_idx on expenses (period_month);
create index if not exists expenses_category_idx on expenses (category);
create index if not exists expenses_recurring_idx on expenses (recurring_expense_id);
