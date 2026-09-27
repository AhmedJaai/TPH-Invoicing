-- 051 — صفوفُ الكشف الملتبسة والمتضاربة تُحفظ ولا تُسقَط.
--
-- المزامنةُ تقول لكلّ صفّ: معروف، أو جديد، أو ملتبس (بلا مرجعٍ ويشبه حركةً لها
-- مرجع — أهي هي؟)، أو متضارب (المرجعُ نفسُه بمبلغٍ آخر). وكان الأخيران يُعدّان
-- في نتيجة الاستيراد ثمّ يختفيان: لا صفَّ ولا قرار — وحوالةٌ حقيقيّةٌ ثانية
-- تضيع ولا يشكو أحد، إلّا فرقاً في معادلة البنك لا يُعرف مصدره.
--
-- فتُحفظ هنا بوقائعها وبالحركة التي تشبهها، حتّى يقرّر إنسان: «هي نفسها»
-- (يُغلق)، أو «حركةٌ أخرى» (تُضاف حركةً فتدخل الطابور). والفرادةُ على الوقائع
-- والحركة المقابِلة: إعادةُ استيراد الملفّ لا تُكرّرها، والقرارُ يُذكر.
--
-- جدولٌ جديد: إضافةٌ آمنة لا تمسّ الشيفرة القديمة.
create table if not exists bank_held_rows (
  id                      text primary key,
  kind                    text not null check (kind in ('AMBIGUOUS', 'CONFLICT')),
  bank_import_id          text references bank_imports(id) on delete set null,
  bank_account_id         text references bank_accounts(id) on delete set null,
  against_transaction_id  text references bank_transactions(id) on delete set null,
  reason                  text not null,
  value_date              timestamptz not null,
  description             text,
  beneficiary_raw         text,
  transaction_type        text,
  amount_minor            integer not null check (amount_minor >= 0),
  direction               tx_direction not null,
  operation_ref           text,
  fact_key                text not null,
  resolution              text check (resolution in ('SAME', 'ADDED', 'CHECKED')),
  resolved_transaction_id text references bank_transactions(id) on delete set null,
  resolved_by_id          text references users(id),
  resolved_at             timestamptz,
  created_at              timestamptz not null default now()
);

create unique index if not exists bank_held_rows_uniq
  on bank_held_rows (kind, coalesce(against_transaction_id, '~'), fact_key);
create index if not exists bank_held_rows_open_idx on bank_held_rows (resolved_at) where resolved_at is null;
