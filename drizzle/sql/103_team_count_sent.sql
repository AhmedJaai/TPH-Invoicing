-- 103 — إرسالُ جرد السبت للإدارة واتساب (أحمد، ٨ نوفمبر ٢٠٢٦: «بعدها يطبع تقرير ويرسله ليّ واتس — لازم يرسله»).
-- متى أُرسل التقريرُ آخرَ مرّة ومَن أرسله: ما عُدّ بعده يُعدّ «عُدّل بعد الإرسال». إضافةٌ خالصة.
alter table inventory_counts add column if not exists team_sent_at timestamptz;
alter table inventory_counts add column if not exists team_sent_by_employee_id text references employees(id) on delete set null;
