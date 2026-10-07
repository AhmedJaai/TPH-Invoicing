-- 063 — ما يكتبه صاحبُ المقهى للإقرار ولا يراه البنك: مبيعاتُ النقد التي لم تُودَع.
--
-- المخرجاتُ من وارد البنك، والنقدُ الذي لم يُودَع لا يظهر في كشف — فكان الرقمُ الكبير «تسدّده
-- للهيئة» ناقصاً بعلم. يُكتب هنا شهراً شهراً شاملَ الضريبة، ويدخل المعادلةَ بسطرٍ مسمّى.
-- وغيابُ الصفّ «لم يُكتب» لا «صفر».
--
-- جدولٌ جديد: إضافةٌ آمنة على الكود القديم.
create table if not exists vat_period_inputs (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  cash_sales_gross_minor integer not null check (cash_sales_gross_minor >= 0),
  updated_by_id text references users(id),
  updated_at timestamptz not null default now()
);
