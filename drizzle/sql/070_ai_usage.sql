-- 070 — سجلُّ إنفاق الذكاء: نداءٌ بنداء، برموزه وكلفته التقديريّة.
--
-- دفترُ نداءات الذكاء: صفٌّ لكلّ نداءٍ نجح — المهمّة والنموذج والرموز والكلفةُ التقديريّة
-- بالدولار (جزءٌ من مليون، عدداً صحيحاً). جدولٌ جديد خالص، لا يمسّ قائماً.
-- والشيفرةُ تحتمل غيابَه: الكتابةُ فيه تُلتقَط ولا تُسقط القراءة، والبطاقةُ تقول «غير معروف».

create table if not exists ai_usage (
  id              text primary key,
  at              timestamptz not null default now(),
  task            text not null,
  model           text not null,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cached_tokens   integer not null default 0,
  cost_micro_usd  bigint not null default 0
);

create index if not exists ai_usage_at_idx on ai_usage (at);
