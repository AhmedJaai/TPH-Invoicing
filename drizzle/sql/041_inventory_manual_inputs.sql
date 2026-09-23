-- ═══════════════════════════════════════════════════════════════
--  ما يُدخله الإنسان حين لا تعرفه الوثائق — ونطاقُ الجرد حالاً محفوظة
--
--  التصميم: docs/review/INVENTORY-RECONCILIATION-DESIGN.md §١٣
--
--  أربعةُ أشياء، وكلُّها إضافة (الهجرةُ تسبق الكودَ بنشرة):
--
--    ١. `inventory_counts.scope_source` — نطاقُ الجرد موروثٌ أم صريح.
--    ٢. `inventory_count_openings` — الرصيدُ الافتتاحيّ اليدويّ بتاريخه.
--    ٣. `inventory_receipts` — الكمّيّةُ المستلَمة يدوياً، وعلاقتُها
--       ببند الفاتورة.
--    ٤. أعمدةُ مصدرٍ على سطر الجرد — كي يقول التقريرُ من أين جاء الرقم.
-- ═══════════════════════════════════════════════════════════════

-- ═════════════ ١ · النطاقُ: موروثٌ أم صريح ═════════════
--
--  كان يُستنتَج من وجود صفٍّ مستبعَد، فمن اختار الأصنافَ كلَّها لم يبقَ
--  له أثر — فيُورَّث ثانيةً ويضيع اختيارُه بتحديث الصفحة.
--  و`INHERITED` افتراضيّ: الجرداتُ القائمة لم يختر لها أحدٌ صراحةً.

do $$ begin
  create type inventory_scope_source as enum ('INHERITED', 'EXPLICIT');
exception when duplicate_object then null; end $$;

alter table inventory_counts
  add column if not exists scope_source inventory_scope_source not null default 'INHERITED';

comment on column inventory_counts.scope_source is
  'INHERITED: النطاقُ يتبع الجردَ السابق في الفرع ما دام لم يُحفَظ هنا. EXPLICIT: حفظه إنسان — ولا يمسّه التوريثُ بعدها، واختيارُ الكلّ صريحٌ كاختيار البعض.';

-- ═════════════ ٢ · الرصيدُ الافتتاحيّ اليدويّ ═════════════
--
--  ما كان على الرفّ أوّلَ الأسبوع، لصنفٍ في جردٍ بعينه. والتعديلُ يُغلق
--  السابقَ ولا يمحوه، والإفراغُ يُغلقه بلا بديل فيعود «غير معروف».

create table if not exists inventory_count_openings (
  id                 text primary key,
  count_id           text not null references inventory_counts(id) on delete cascade,
  product_id         text not null references products(id),
  -- كما أدخله الإنسان: «5.2» كجم — بالمِلّي من وحدته
  entered_milli      bigint not null,
  entered_unit       base_unit not null,
  -- وبالمعياريّ: مِلّي أصغر وحدةٍ في العائلة — كما يقرؤه المحرّك
  canonical_milli    bigint not null,
  note               text,
  created_by_id      text references users(id),
  created_at         timestamptz not null default now(),
  superseded_at      timestamptz,
  superseded_by_id   text references users(id),

  constraint inventory_count_openings_nonneg check (entered_milli >= 0 and canonical_milli >= 0)
);

-- صفٌّ ساري واحد لكلّ (جرد، صنف) — والتاريخُ كلُّه باقٍ خلفه
create unique index if not exists inventory_count_openings_active_uniq
  on inventory_count_openings (count_id, product_id) where superseded_at is null;
create index if not exists inventory_count_openings_count_idx on inventory_count_openings (count_id);

comment on table inventory_count_openings is
  'الرصيدُ الافتتاحيّ اليدويّ لجردٍ بعينه — يغلب الجردَ السابق صراحةً. والتعديلُ إغلاقٌ وإضافة لا كتابةٌ فوق.';

-- والمقفَلُ لا يُكتَب في افتتاحيّه — كأسطره
create or replace function inventory_count_openings_locked() returns trigger
language plpgsql as $$
declare s inventory_count_status;
begin
  select c.status into s from inventory_counts c
   where c.id = coalesce(new.count_id, old.count_id);
  if s = 'FINALISED' then
    raise exception 'هذا الجرد مقفَل — أعِد فتحَه أوّلاً إن أردت تعديل رصيده الافتتاحيّ'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists inventory_count_openings_locked_trg on inventory_count_openings;
create trigger inventory_count_openings_locked_trg
  before insert or update or delete on inventory_count_openings
  for each row execute function inventory_count_openings_locked();

-- ═════════════ ٣ · الكمّيّةُ المستلَمة ═════════════
--
--  «دخلت الرفَّ بضاعة» — لا فاتورة ولا دين. والكمّيّةُ هي الواقعة،
--  والكلفةُ معلومةٌ اختياريّة لا تُشتقّ منها كمّيّة.

create table if not exists inventory_receipts (
  id                  text primary key,
  product_id          text not null references products(id),
  branch_id           text references branches(id) on delete set null,
  -- تاريخُ الاستلام الفعليّ — وبه يُنسَب إلى أسبوعه، لا بتاريخ فاتورة
  received_on         text not null,
  entered_milli       bigint not null,
  entered_unit        base_unit not null,
  canonical_milli     bigint not null,
  -- اختياريّة كلُّها — ولا يُشترَط شيءٌ منها لقيد الاستلام
  supplier_id         text references suppliers(id) on delete set null,
  document_ref        text,
  cost_minor          bigint,
  note                text,
  -- الاستلامُ هو الوجهُ الفعليّ لهذا البند — فيخرج البندُ من الحساب
  invoice_line_id     text references invoice_lines(id) on delete set null,
  -- قال صاحبُه إنّها شحنةٌ غيرُ أيّ فاتورة — فيُحسَب الاثنان
  confirmed_separate  boolean not null default false,
  created_by_id       text references users(id),
  created_at          timestamptz not null default now(),
  updated_by_id       text references users(id),
  updated_at          timestamptz,
  voided_at           timestamptz,
  voided_by_id        text references users(id),
  void_reason         text,

  constraint inventory_receipts_qty_positive check (entered_milli > 0 and canonical_milli > 0),
  constraint inventory_receipts_date_shape check (received_on ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint inventory_receipts_cost_nonneg check (cost_minor is null or cost_minor >= 0),
  -- مرتبطٌ ومنفصلٌ معاً تناقض
  constraint inventory_receipts_link_or_separate check (not (invoice_line_id is not null and confirmed_separate)),
  -- الإلغاءُ له سببٌ ومن ألغاه
  constraint inventory_receipts_void_stamped check (voided_at is null or (void_reason is not null and voided_by_id is not null))
);

create index if not exists inventory_receipts_product_idx on inventory_receipts (product_id, received_on);
-- بندُ فاتورةٍ واحد لا يرتبط باستلامين ساريين — وإلّا حُسبت شحنتُه مرّتين
create unique index if not exists inventory_receipts_invoice_line_uniq
  on inventory_receipts (invoice_line_id) where invoice_line_id is not null and voided_at is null;

comment on table inventory_receipts is
  'كمّيّةٌ دخلت الرفّ بإدخال إنسان — ليست فاتورةً ولا ديناً. وتدخل المحرّكَ في مسار أسطر الشراء نفسِه. ولا تُحذَف: تُلغى بسببها.';

-- ولا يُكتَب في استلامٍ يقع في جردٍ مقفَل للفرع — قديمُه أو جديدُه
create or replace function inventory_receipts_locked() returns trigger
language plpgsql as $$
declare hit text;
begin
  select c.id into hit
    from inventory_counts c
   where c.status = 'FINALISED'
     and (
       (tg_op <> 'DELETE' and new.received_on between c.period_start and c.period_end
         and coalesce(c.branch_id, '~') = coalesce(new.branch_id, coalesce(c.branch_id, '~')))
       or
       (tg_op <> 'INSERT' and old.received_on between c.period_start and c.period_end
         and coalesce(c.branch_id, '~') = coalesce(old.branch_id, coalesce(c.branch_id, '~')))
     )
   limit 1;
  if hit is not null then
    raise exception 'هذا الاستلام يقع في أسبوعٍ جردُه مقفَل — أعِد فتحَ الجرد أوّلاً'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists inventory_receipts_locked_trg on inventory_receipts;
create trigger inventory_receipts_locked_trg
  before insert or update or delete on inventory_receipts
  for each row execute function inventory_receipts_locked();

-- ═════════════ ٤ · من أين جاء الرقم ═════════════

alter table inventory_count_lines
  add column if not exists opening_source text not null default 'UNKNOWN',
  add column if not exists opening_ref text,
  add column if not exists manual_receipts_milli bigint not null default 0;

do $$ begin
  alter table inventory_count_lines add constraint inventory_count_lines_opening_source_ok
    check (opening_source in ('MANUAL', 'PREVIOUS_COUNT', 'MOVEMENT', 'UNKNOWN'));
exception when duplicate_object then null; end $$;

comment on column inventory_count_lines.opening_source is
  'مصدرُ الافتتاحيّ بترتيبٍ ثابت: MANUAL ثمّ PREVIOUS_COUNT ثمّ MOVEMENT ثمّ UNKNOWN (فيبقى NULL).';
comment on column inventory_count_lines.manual_receipts_milli is
  'ما دخل من المشتريات بإدخالٍ يدويّ — والباقي من الفواتير. يُعرَض مصدرُ الكمّيّة لا الكمّيّةُ وحدها.';
