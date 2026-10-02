-- 056 — اسمٌ آخر لصنف المورّد نفسه.
--
-- النموذجُ يكتب البندَ الواحد بصيغٍ (الغربية: «كولومبي عنب» · «كولومي عنب» · «عنب»)،
-- فيصير كلٌّ صنفاً: يتفرّق تاريخُ سعره، ويُسأل عن ربطه بالجرد مرّةً لكلّ صيغة.
-- فيقرّ الإنسانُ مرّةً أنّ الصيغةَ هي الصنف، ويُحفظ هنا: يُطبَّع بها كلُّ بندٍ يُكتب
-- بعدها (`replaceLines`)، وتُنقل إليه بنودُها القائمة. لا تخمينَ من الاسم — إقرار.
--
-- جدولٌ جديد: إضافةٌ آمنة.
create table if not exists supplier_item_aliases (
  id                   text primary key,
  supplier_id          text not null references suppliers(id) on delete cascade,
  alias_normalized     text not null,
  canonical_normalized text not null,
  created_by_id        text references users(id),
  created_at           timestamptz not null default now(),
  constraint supplier_item_aliases_not_self check (alias_normalized <> canonical_normalized)
);
create unique index if not exists supplier_item_aliases_uniq
  on supplier_item_aliases (supplier_id, alias_normalized);
