-- 061 — فاتورةٌ يُقرّ صاحبُ المقهى أنّها ضريبيّةٌ على الورقة فتُحسب في خصم الإقرار.
--
-- الآلةُ حكمت «لا تُخصم» لأنّ ركناً لم يُقرأ (رقمُ المورّد غالباً) — والورقةُ تحمله. وتصحيحُ
-- الفاتورة نفسِها هو العلاجُ الدائم، لكنّه ممنوعٌ في الشهر المقفل (028)، والإقرارُ الربعيّ
-- يُعَدّ بعد إقفال أشهره. فيُحفَظ الإقرارُ هنا: لا يغيّر الفاتورة ولا مبلغها ولا حالَها.
--
-- جدولٌ جديد: إضافةٌ آمنة على الكود القديم.
create table if not exists vat_invoice_choices (
  invoice_id text primary key references invoices(id) on delete cascade,
  included boolean not null,
  decided_by_id text references users(id),
  decided_at timestamptz not null default now()
);
