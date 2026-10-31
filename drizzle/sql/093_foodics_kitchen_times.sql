-- 093 — أوقاتُ شاشة التحضير، وجوابُ الكاشير عن مكوّنات المرتجَع، في مرآة فودكس.
--
-- كلُّ طلبٍ يحمل في `meta.foodics` متى وصل شاشةَ التحضير ومتى أُنهي — ٩٩٪ من طلبات
-- أسبوع ٢٠–٢٦ أكتوبر ٢٠٢٦ (٧٧٨ من ٧٨٦): الوسيطُ سبعُ دقائق، والعُشرُ الأبطأ فوق ١٤.
-- وكلُّ سطرِ مرتجَعٍ يحمل `is_ingredients_wasted`: جوابُ الكاشير «أهُدرت المكوّنات؟»
-- (٣ من ١٠ في الأسبوع نفسه) — شاهدٌ على «مرتجع بعد التحضير» الذي نحسبه بالوصفة.
--
-- مرآةٌ لا دفتر: لا مالَ يُكتب منها. وإضافةٌ خالصة: أعمدةٌ تقبل الفراغ، والشيفرةُ
-- القديمة لا تقرؤها. والفارغُ «لم يُقرأ بعد» لا «صفر».

alter table foodics_orders add column if not exists kitchen_received_at timestamptz;
alter table foodics_orders add column if not exists kitchen_done_at timestamptz;
-- عددُ أسطر الطلب التي قال الكاشير إنّ مكوّناتها هُدرت — `null` قبل أن يُقرأ
alter table foodics_orders add column if not exists wasted_lines integer check (wasted_lines is null or wasted_lines >= 0);

create index if not exists foodics_orders_kitchen_idx on foodics_orders (business_date) where kitchen_done_at is not null;
