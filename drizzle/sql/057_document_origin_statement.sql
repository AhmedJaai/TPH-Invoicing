-- 057 — فاتورةٌ يذكرها كشفُ المورّد ولا ملفَّ لها عندنا.
--
-- غاناش: كشوفُ مايو–أغسطس تذكر ٣٨ فاتورة (نحو ٢٣ ألفاً) لا ملفَّ لها في الأرشيف، فكانت
-- خارج المستحقّ والمشتريات، وبدت حوالاتُها الشهريّة (مجموعُ كلّ كشف) سداداً زائداً بعشرين
-- ألفاً. فتُقيَّد من سطر الكشف بإقرار إنسان: مستندٌ بلا ملفّ، أصلُه الكشف — ولا تُخصم
-- ضريبتُها حتى يصل ملفُّها؛ فإن وصل تبنّاه القيدُ نفسُه (`createInvoice`) ولا يُكرَّر.
--
-- عمودان جديدان يقبلان الفراغ: إضافةٌ آمنة.
alter table documents add column if not exists origin text;
alter table documents add column if not exists origin_statement_id text references statements(id) on delete set null;
alter table documents drop constraint if exists documents_origin_known;
alter table documents add constraint documents_origin_known
  check (origin is null or (origin = 'STATEMENT_LINE' and drive_file_id is null));
