-- ═══════════════════════════════════════════════════════════════
-- المبيعات: فرعٌ وهويّة، والصنف: وحدةُ محتواه
--
-- الجداول فارغة عمداً — ولذلك بالضبط يُصلَح المخطّط الآن. إصلاحُه بعد
-- ملء الجدول يعني نسبةَ كل ما مضى إلى فرعٍ واحد بالحدس، وحذفَ مكرّرٍ
-- لا يُعرف أصلُه.
--
-- ثلاث عللٍ في الأساس:
--
-- ١. المرتجعات والتسويات تحمل فرعها، والبيعةُ لا. فلا يُقارَن مبيع فرعٍ
--    بمرتجعه، ولا يُعرَف أيّ فرعٍ أودع هذه التسوية.
--
-- ٢. لا قيدَ فرادةٍ على سطر البيعة ولا على دفعتها ولا على دفعة التسوية.
--    فمزامنةٌ ثانية لليوم نفسه تُضاعفها — ويصير المقبوض ضعفَ المبيع،
--    ثمّ لا تُطابق التسوية شيئاً. وهذا هو الدرس نفسه الذي كلّف كشفاً
--    بنكياً استُورد ثلاث مرّات: منعُ التكرار يُبنى **قبل** أن تدخل
--    البيانات لا بعد أن تتضاعف.
--
-- ٣. `supplier_products.pack_size` يقول «كم عبوة» ولا يقول «كم في
--    الواحدة ولا بأيّ وحدة». فكرتون ١٢ × ١ لتر وكرتون ١٢ × ٥٠٠ مل
--    سواءٌ عنده — وسعرُ اللتر فيهما مختلفٌ ضعفين.
-- ═══════════════════════════════════════════════════════════════

-- ── ١. البيعة تعرف فرعها ──
alter table sales
  add column if not exists branch_id text references branches(id) on delete set null;

create index if not exists sales_branch_idx on sales (branch_id);

-- ── ٢. الهويّة تمنع التكرار ──
alter table sale_lines
  add column if not exists external_id text;

create unique index if not exists sale_lines_external_uniq
  on sale_lines (sale_id, external_id);

create unique index if not exists sale_payments_external_uniq
  on sale_payments (sale_id, method, external_id);

create unique index if not exists settlement_external_uniq
  on settlement_batches (source_id, external_id);

-- ── ٣. الصنف يعرف محتوى عبوته ──
do $$
begin
  if not exists (select 1 from pg_type where typname = 'base_unit') then
    create type base_unit as enum ('PIECE', 'KG', 'GRAM', 'LITER', 'ML', 'PACK');
  end if;
end $$;

alter table supplier_products
  add column if not exists content_unit     base_unit,
  add column if not exists content_quantity numeric(12,3);

-- حجم العبوة ومحتواها موجبان أو غائبان — و«صفر» ليس «غير معروف».
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_products_pack_positive') then
    alter table supplier_products add constraint supplier_products_pack_positive
      check (
        (pack_size is null or pack_size > 0)
        and (content_quantity is null or content_quantity > 0)
      );
  end if;
end $$;

-- والوحدة والكمّية تُذكران معاً أو تُتركان معاً: «١٢ × ٥٠٠» بلا وحدة
-- لا تعني شيئاً، و«لتر» بلا كمّية كذلك.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_products_content_pair') then
    alter table supplier_products add constraint supplier_products_content_pair
      check ((content_unit is null) = (content_quantity is null));
  end if;
end $$;
