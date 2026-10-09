-- 068 — أدلّة القراءة: ما يُقابَل به اقتراحُ النموذج، ومتى قُرئ وبأيّ موجِّه.
--
-- كان `extraction_json` يُحفظ وحده: لا يُعرف أيّ حقلٍ قرأه النموذج وأيّها سُدّ من اسم
-- الملفّ أو حُسب، ولا بأيّ نسخة موجِّهٍ قُرئ، والتعارضُ الباقي بعد إعادة السؤال يُرمى.
-- و`extraction_evidence` (JSON) يحمل: رمز الفاتورة الضريبيّ (QR) كما فُكّ، ومصدرَ كلّ
-- حقلٍ لم يقرأه النموذج، وما اتّفق وما اختلف مع الرمز، وما بقي متعارضاً، وكم صفحةً
-- قُرئت. شكلُه في `src/lib/extraction/evidence.ts` ويُتحقَّق منه عند القراءة.
--
-- أعمدةٌ جديدة تقبل الفراغ: إضافةٌ آمنةٌ للشيفرة القديمة، وما سبقها يبقى `NULL`
-- («لا دليل محفوظ» — لا «لا رمز»).
alter table documents add column if not exists extraction_evidence jsonb;
alter table documents add column if not exists extraction_prompt_version text;

alter table extraction_cache add column if not exists evidence jsonb;
alter table extraction_cache add column if not exists prompt_version text;
alter table extraction_cache add column if not exists schema_version text;
alter table extraction_cache add column if not exists provider text;
