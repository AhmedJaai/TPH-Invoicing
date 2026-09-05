-- ذاكرة المستفيدين.
--
-- كان التعلّم قواعدَ نصّية يكتبها المستخدم: «احفظ هذا النمط». وهذا
-- ليس تعلّماً بل قاعدةً محفوظة — تُطابِق نصّاً ولا تعرف جهةً.
--
-- والمطلوب هويّةٌ للجهة نفسها، تجمع أدلّتها على اختلافها: اسمها كما
-- يكتبه البنك، وحسابها، وآيبانها، ورقم هويّتها، ورقم تاجرها لدى
-- الشبكة. فمن أكّد مرّةً أنّ صاحب الهوية ٢١٤٩٨٣٠١١٥ هو نفسه، صُنّفت
-- تحويلاته كلّها بعدها بلا سؤال — وهي في كشفه أكثر من ثلاثين حركة.

create table if not exists counterparties (
  id             text primary key,
  /** الاسم الذي يُعرَض — يختاره الإنسان لا الآلة */
  display_name   text not null,
  /** الباب الذي تُصنَّف فيه حركاته */
  kind           tx_category not null default 'UNKNOWN',
  /** المورّد المرتبط، إن كان مورّداً */
  supplier_id    text references suppliers(id) on delete set null,
  note           text,
  is_active      boolean not null default true,
  created_by_id  text references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$ begin
  create type counterparty_evidence_kind as enum (
    'NAME', 'ACCOUNT', 'IBAN', 'NATIONAL_ID', 'MERCHANT_ID', 'REFERENCE'
  );
exception when duplicate_object then null; end $$;

-- الأدلّة: كل ما عُرف أنّه يدلّ على هذه الجهة
create table if not exists counterparty_evidence (
  id               text primary key,
  counterparty_id  text not null references counterparties(id) on delete cascade,
  kind             counterparty_evidence_kind not null,
  /** القيمة كما وردت */
  value            text not null,
  /** القيمة موحَّدةً للمطابقة */
  normalized       text not null,
  /** كم مرّة أكّدها إنسان — الدليل المتكرّر أوثق */
  confirmations    integer not null default 1,
  confirmed_by_id  text references users(id),
  created_at       timestamptz not null default now(),

  constraint counterparty_evidence_positive check (confirmations > 0)
);

/*
 * الدليل الواحد لا يدلّ على جهتين.
 *
 * رقم حسابٍ واحد لجهتين تناقض، لا اجتهاد. والفهرس يمنعه في القاعدة
 * لا في الشيفرة — فالكتابة من مسارين لا تعرف أحدهما الآخر.
 */
create unique index if not exists counterparty_evidence_uniq
  on counterparty_evidence (kind, normalized);

create index if not exists counterparty_evidence_party_idx
  on counterparty_evidence (counterparty_id);

create index if not exists counterparties_supplier_idx
  on counterparties (supplier_id) where supplier_id is not null;

-- ربط الحركة بالجهة التي عُرفت
alter table bank_transactions
  add column if not exists counterparty_id text references counterparties(id) on delete set null;

create index if not exists bank_tx_counterparty_idx
  on bank_transactions (counterparty_id) where counterparty_id is not null;
