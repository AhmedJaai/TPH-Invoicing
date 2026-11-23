-- 111 — ميزانيةُ الشهر (٢٣ نوفمبر ٢٠٢٦).
--
-- لا يُعرف «هل صرفتُ أكثر ممّا ينبغي؟» إلّا بحدٍّ مكتوب. فلكلّ باب (تكلفةُ المبيعات `COGS`، أو بابُ
-- مصروف) مبلغٌ شهريّ يسري من شهرٍ بعينه. **والتعديلُ صفٌّ جديد لا تحديث**: يبقى ما كان مكتوباً
-- قبله وتاريخُه ومن كتبه (سجلُّ القرار)، والساري للشهر آخرُ صفٍّ يسري قبله. و`amount_minor` الفارغُ
-- «لا ميزانية لهذا الباب من هذا الشهر». مالٌ بالهللات، ولا يمسّ دفتراً — قراءةٌ فوق الربح.

create table if not exists budget_lines (
  id text primary key,
  line text not null check (line ~ '^[A-Z_]{2,32}$'),
  amount_minor integer check (amount_minor is null or amount_minor > 0),
  effective_from text not null check (effective_from ~ '^\d{4}-\d{2}$'),
  note text,
  created_by_id text references users(id),
  created_at timestamptz not null default now()
);
create index if not exists budget_lines_line_idx on budget_lines (line, effective_from);
