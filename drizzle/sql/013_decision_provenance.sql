-- سببُ القرار يُحفَظ، لا يُحسَب ثمّ يُرمى.
--
-- كان النظام يعرف داخلياً أنّ الحركة صُنّفت بقاعدةٍ بعينها، ثمّ يكتب
-- `rule_id = null` صراحةً. فيضيع: من صنّفها، ولماذا، وأيّ قاعدة —
-- ولا يُقاس بعدها أيّ القواعد أدقّ، ولا يُصحَّح ما أخطأ.
--
-- وكذلك حكم الحَكَم: كان يُحسَب كاملاً — مزوّداً ونموذجاً ونسخةَ موجِّه
-- وثقةً وأدلّةً — ثمّ لا يُحفَظ منه إلّا درجة. وبعد ستّة أشهر لا يكفي
-- أن يُقال «اقترحه الذكاء»؛ يجب أن يُعرَف: أيّ نموذج، وأيّ نسخة، وما
-- الذي ادّعاه، وما الذي صحّ منه.

do $$ begin
  create type classification_source as enum (
    'STRUCTURE',  -- بنية الوصف نفسها
    'MEMORY',     -- جهة أكّدها إنسان
    'RULE',       -- قاعدة محفوظة
    'KEYWORD',    -- كلمة دالّة
    'AI',         -- حَكَم
    'HUMAN',      -- تصنيفٌ صريح من المستخدم
    'UNKNOWN'
  );
exception when duplicate_object then null; end $$;

alter table bank_transactions
  add column if not exists classification_source  classification_source,
  add column if not exists classification_reason  text,
  add column if not exists classification_version text;

-- والقاعدة التي صنّفت، إن وُجدت: العمود كان يُملأ بـnull عمداً
create index if not exists bank_tx_classification_source_idx
  on bank_transactions (classification_source) where classification_source is not null;

/*
 * أثرُ التحكيم — سجلٌّ مستقلّ لا عمودٌ في الحركة.
 *
 * لأنّ الحركة الواحدة قد تُحكَّم أكثر من مرّة: مرّةً عند الاستيراد،
 * ومرّةً بعد أن تتعلّم الذاكرة شيئاً جديداً. وحفظُ الأخير وحده يمحو
 * تاريخ القرار، وهو ما يُراد بالضبط أن يُقرأ.
 */
create table if not exists adjudications (
  id                  text primary key,
  bank_transaction_id text not null references bank_transactions(id) on delete cascade,
  kind                text not null,
  provider            text not null,
  model               text not null,
  prompt_version      text not null,
  schema_version      text not null,
  duration_ms         integer not null default 0,
  /** ما قاله النموذج عن نفسه — إشارةٌ لا حُكم */
  model_confidence    numeric(4, 3),
  model_reason        text,
  /** الرموز: ما ادّعاه، وما صحّ، وما رُدّ */
  claimed_codes       text[] not null default '{}',
  upheld_codes        text[] not null default '{}',
  refuted_codes       text[] not null default '{}',
  /** ما اختاره، وما قرّره النظام بعد الوزن */
  chosen_invoice_ids  text[] not null default '{}',
  chosen_counterparty text,
  disposition         match_disposition not null,
  signals             jsonb,
  refused             text,
  created_at          timestamptz not null default now(),

  constraint adjudications_confidence_range
    check (model_confidence is null or (model_confidence >= 0 and model_confidence <= 1))
);

create index if not exists adjudications_tx_idx  on adjudications (bank_transaction_id);
create index if not exists adjudications_at_idx  on adjudications (created_at desc);

/*
 * تاريخ القرار — كل ما جرى لهذه الحركة بترتيبه.
 *
 * «اقترح الذكاء الفاتورة ١٨٢ · رفضها أحمد · طابق ١٨٩ · تعلّم النظام
 * هويّة الحساب». وسجلّ التدقيق يقول من فعل ماذا، وهذا يقول **كيف
 * تطوّر القرار** — وهما سؤالان مختلفان.
 */
do $$ begin
  create type decision_event as enum (
    'CLASSIFIED', 'MATCH_SUGGESTED', 'MATCH_CONFIRMED',
    'MATCH_REJECTED', 'MATCH_REVERSED', 'ENTITY_LEARNED', 'POSTED'
  );
exception when duplicate_object then null; end $$;

create table if not exists decision_history (
  id                  text primary key,
  bank_transaction_id text references bank_transactions(id) on delete cascade,
  event               decision_event not null,
  /** من: نظام أم إنسان أم نموذج */
  actor               text not null,
  actor_id            text references users(id),
  detail              text,
  payload             jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists decision_history_tx_idx on decision_history (bank_transaction_id, created_at);
