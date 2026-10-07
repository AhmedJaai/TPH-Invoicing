-- 062 — لقطةُ «الإقرار المقدَّم»: الرقمُ الذي قُدِّم للهيئة يُحفَظ ولا يتغيّر.
--
-- الإقرارُ يُحسب حيّاً في كلّ فتح، فبعد التقديم تغيّره فاتورةٌ تُرفع متأخّرة أو نقرةُ «احسبها»
-- بلا أثر، ولا يُعرف بعد سنةٍ ما الذي قُدِّم — وكلُّ ربعٍ سابق يظهر «فات موعدُه» إلى الأبد.
-- فيُحفَظ هنا ما قُدِّم: الأرقامُ بالهللات، ولقطةُ الحساب كاملةً (`snapshot`) بمعرّفات ما حُسب،
-- ومرجعُ الهيئة، وما فُعل بالرصيد الدائن (ترحيلٌ أو استرداد).
--
-- واللقطةُ لا تُحذف: التراجعُ عنها `voided_at` بسببه، ولكلّ فترةٍ لقطةٌ قائمة واحدة.
--
-- جدولٌ جديد: إضافةٌ آمنة على الكود القديم.
create table if not exists vat_filings (
  id text primary key,
  period_key text not null,
  filed_on text not null check (filed_on ~ '^\d{4}-\d{2}-\d{2}$'),
  reference text,
  output_vat_minor integer not null,
  input_vat_minor integer not null,
  carried_in_minor integer not null default 0,
  net_minor integer not null,
  credit_disposition text check (credit_disposition in ('CARRY', 'REFUND')),
  snapshot jsonb not null,
  filed_by_id text references users(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by_id text references users(id),
  void_reason text
);

create unique index if not exists vat_filings_live_period_uniq on vat_filings (period_key) where voided_at is null;
