-- ═══════════════════════════════════════════════════════════════
-- هويّةٌ مقيَّدة بنطاقها، ودليلٌ فرادتُه بحسب نوعه
--
-- ثلاث علل، كلّها تفقد بيانات مالية صامتةً:
--
-- ١. بصمة الحركة فريدة في النظام كلّه، لا في حسابها. فحوالتان
--    متطابقتان في يومٍ واحد من حسابين مختلفين — وهذا يقع حين يُدفع
--    الإيجار نفسه من حسابين، أو تُسدَّد فاتورةٌ مرّتين خطأً — تُقبَل
--    أولاهما وتُرَدّ الأخرى بوصفها «مستوردة مسبقاً». مالٌ خرج فعلاً
--    ولا أثر له.
--
-- ٢. الكشف يُربَط بحسابه بنصٍّ لا بمفتاح. فيتفرّق كشفا حسابٍ واحد
--    لاختلاف صيغة الرقم، ولا يُقال «هذا الحساب مغطّى وذاك ناقص».
--
-- ٣. الدليل على الجهة فريدٌ في نوعه كلِّه — فامتنع أن يوجد في النظام
--    «مؤسسة الرياض للتجارة» مرّتين، لأنّ الاسم صار حكراً على أوّل من
--    سُجّل به. والاسم ليس هويّة.
-- ═══════════════════════════════════════════════════════════════

-- ── ١. الكشف يعرف حسابه ──
alter table bank_imports
  add column if not exists bank_account_id text
    references bank_accounts(id) on delete set null;

create index if not exists bank_imports_account_idx
  on bank_imports (bank_account_id);

-- الحركة تعرف حسابها كذلك (العمود موجود؛ نضيف مفتاحه وفهرسه)
create index if not exists bank_tx_account_idx
  on bank_transactions (bank_account_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bank_transactions_bank_account_id_fkey'
  ) then
    alter table bank_transactions
      add constraint bank_transactions_bank_account_id_fkey
      foreign key (bank_account_id) references bank_accounts(id) on delete set null;
  end if;
end $$;

-- ── ٢. الفرادة مقيَّدة بالحساب ──
--
-- `coalesce` مقصود: `NULL <> NULL` في بوستجرس، فلو تُرك العمود خاماً
-- في القيد لصار كل حساب مجهول نطاقاً منفصلاً عن نفسه — أي بلا منعِ
-- تكرارٍ أصلاً، وهو ضدّ الغرض. والحساب المجهول نطاقٌ واحد حتى يُعرَف.
drop index if exists bank_tx_external_uniq;

create unique index if not exists bank_tx_scoped_external_uniq
  on bank_transactions (coalesce(bank_account_id, '~'), external_id)
  where external_id is not null;

-- ── ٣. فرادة الدليل بحسب نوعه ──
--
-- القاطع: رقم حساب · آيبان · رقم هوية · رقم تاجر. أرقامٌ رسميّة لا
-- تدلّ على جهتين، فاشتراكها خطأُ بياناتٍ يجب أن يُعرَض.
-- الظنّي: الاسم والمرجع. يتكرّران بطبيعتهما، ومنعُ تكرارهما يمنع
-- الواقع لا الخطأ.
drop index if exists counterparty_evidence_uniq;

create unique index if not exists counterparty_evidence_party_uniq
  on counterparty_evidence (counterparty_id, kind, normalized);

create unique index if not exists counterparty_evidence_exclusive_uniq
  on counterparty_evidence (kind, normalized)
  where kind in ('ACCOUNT', 'IBAN', 'NATIONAL_ID', 'MERCHANT_ID');

create index if not exists counterparty_evidence_lookup_idx
  on counterparty_evidence (kind, normalized);
