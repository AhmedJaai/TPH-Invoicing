-- 102 — جردُ السبت من «TPH Team» (أحمد، ٨ نوفمبر ٢٠٢٦: «صلاحية تسجيل لا تعديل… جرد كل يوم سبت»).
-- `employees.can_count_inventory`: يرى الموظّفُ في رابطه صفحةَ الجرد ويُدخل عدَّ أسبوعه يومَ السبت (أو الأحد بعده).
-- `inventory_count_lines.counted_by_employee_id`: مَن عدّ السطرَ من الموظّفين — فهم ليسوا مستخدمين. إضافةٌ خالصة.
alter table employees add column if not exists can_count_inventory boolean not null default false;
alter table inventory_count_lines add column if not exists counted_by_employee_id text references employees(id) on delete set null;
alter table inventory_counts add column if not exists started_by_employee_id text references employees(id) on delete set null;
