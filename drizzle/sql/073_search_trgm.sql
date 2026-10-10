-- 073 — فهارسُ ثلاثيّات الحروف (pg_trgm) لبحثٍ بـ«يحتوي» لا يمسح الجدول.
--
-- البحثُ الشامل (`search.service.ts`) يسأل `… ilike '%كلمة%'` في خمسة جداول مع
-- كلّ توقّفٍ عن الكتابة، ولا فهرسَ يخدم `%…%` — فيُمسَح كلُّ جدولٍ كاملاً. فهارسُ
-- GIN بثلاثيّات الحروف (`pg_trgm`) تخدم `LIKE/ILIKE '%…%'` لما طولُه ثلاثةُ أحرفٍ
-- فأكثر. إضافةٌ خالصة: لا تمسّ صفّاً ولا قيداً، والاستعلامُ لا يتغيّر.
--
-- التعبيرُ في الفهرس هو تعبيرُ `likeNormalized` حرفاً بحرف
-- (`translate(col, 'إأآٱىة', 'اااايه')`) — إن تغيّر أحدُهما لم يُستعمَل الفهرس
-- (ولا ينكسر شيء: يعود المسحُ الكامل).
--
-- قبل التطبيق (قراءةٌ فقط) — الامتدادُ متاحٌ ودورُ الهجرة يملك إنشاءه؟
--   select name, default_version, installed_version from pg_available_extensions where name = 'pg_trgm';
--   select current_user, pg_has_role(current_user, 'neon_superuser', 'member') as can_create_extension;
-- (002 أنشأت `pgcrypto` بالدور نفسه، و`pg_trgm` من الحزمة نفسها في Neon.)
--
-- الجداول صغيرة، فالإنشاءُ العاديّ (غير المتزامن) يكفي ويجري داخل معاملة الهجرة.

create extension if not exists pg_trgm;

create index if not exists bank_tx_description_trgm_idx
  on bank_transactions using gin (translate(description, 'إأآٱىة', 'اااايه') gin_trgm_ops);

create index if not exists bank_tx_beneficiary_trgm_idx
  on bank_transactions using gin (translate(beneficiary_raw, 'إأآٱىة', 'اااايه') gin_trgm_ops);

create index if not exists bank_tx_ref_trgm_idx
  on bank_transactions using gin (ref gin_trgm_ops);

create index if not exists documents_file_name_trgm_idx
  on documents using gin (file_name gin_trgm_ops);

create index if not exists invoices_number_trgm_idx
  on invoices using gin (invoice_number gin_trgm_ops);

create index if not exists supplier_products_display_trgm_idx
  on supplier_products using gin (translate(display_name, 'إأآٱىة', 'اااايه') gin_trgm_ops);

create index if not exists supplier_products_normalized_trgm_idx
  on supplier_products using gin (translate(normalized_description, 'إأآٱىة', 'اااايه') gin_trgm_ops);
