-- لماذا طُوبقت هذه الحركة؟
--
-- كانت المطابقة تُحفَظ بلا سببها: حالةٌ ورقمُ ثقةٍ ثابت (٠٫٩٨ للفاتورة
-- بعينها) لا يقول شيئاً. فمن يراجع بعد شهر لا يعرف لِمَ نُسبت الحركة
-- إلى هذا المورّد ولا إلى تلك الفاتورة.
--
-- والمال يُراجَع. فتُحفَظ الأدلّة نفسها بنصّها، والدرجة، وقرارُ
-- المحرّك — تلقائيّ أم اقتراح أم مراجعة — كي يُعرَض «لماذا؟» ويُتراجَع.

do $$ begin
  create type match_disposition as enum ('AUTO', 'SUGGEST', 'REVIEW');
exception when duplicate_object then null; end $$;

alter table bank_transactions
  add column if not exists match_disposition match_disposition,
  add column if not exists match_score       integer,
  add column if not exists match_outcome     text,
  add column if not exists match_evidence    jsonb,
  add column if not exists supplier_id       text references suppliers(id);

-- الدرجة تُحفَظ من مئة لا كسراً عشرياً: المال لا يُخزَّن بعدد عشري،
-- ودرجةُ ترجيحه كذلك أولى بألّا تتقلّب بخطأ تمثيل.
alter table bank_transactions drop constraint if exists bank_tx_match_score_range;
alter table bank_transactions add constraint bank_tx_match_score_range
  check (match_score is null or (match_score >= 0 and match_score <= 100));

create index if not exists bank_tx_disposition_idx
  on bank_transactions (match_disposition) where match_disposition is not null;

create index if not exists bank_tx_supplier_idx
  on bank_transactions (supplier_id) where supplier_id is not null;
