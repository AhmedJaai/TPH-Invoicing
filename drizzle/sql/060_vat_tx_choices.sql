-- 060 — اختيارُ صاحب المقهى: أيُّ حركات البنك تُعدّ في إقرار الضريبة.
--
-- الأصلُ مشتقٌّ من التصنيف (تسويةُ الشبكة مبيعات، وضريبةُ الرسوم مدخلات)، وما خالف الأصلَ
-- يُحفَظ هنا: «ضُمّ إيجار أغسطس» أو «أخرِج هذه التسوية». الحركةُ تقع في فترةٍ واحدة بتاريخها،
-- فالمفتاحُ الحركةُ وحدها. والصفُّ اختيارٌ لا مال: لا يغيّر حركةً ولا فاتورة.
--
-- جدولٌ جديد: إضافةٌ آمنة على الكود القديم.
create table if not exists vat_tx_choices (
  bank_transaction_id text primary key references bank_transactions(id) on delete cascade,
  included boolean not null,
  decided_by_id text references users(id),
  decided_at timestamptz not null default now()
);
