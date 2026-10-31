-- 095 — جوابُ المستشار عملٌ في الخلفية لا اتّصالٌ مفتوح.
--
-- كان الجوابُ يُبثّ في الطلب نفسه، فإن خرج صاحبُ المقهى من الصفحة انقطع الاتّصال وتوقّف
-- المستشار ومُحي سؤالُه (أحمد، ٣١ أكتوبر ٢٠٢٦: «لازم أقعد أنتظره»). فصار الجوابُ صفّاً يُكتب
-- «يعمل» حين يُسأل، ويُكمَل في الخلفية ولو أُغلقت الصفحة، وتُحفَظ خطواتُه فتُرى عند العودة.
-- إضافةٌ خالصة: أعمدةٌ بقيمٍ افتراضيّة، وما كُتب قبلها «تمّ».

alter table advisor_messages add column if not exists status text not null default 'DONE'
  check (status in ('PENDING', 'DONE', 'FAILED'));
-- ما فعله وهو يعمل: ["يراجع ربح سبتمبر", …] — يُعرض لمن ينتظر أو يعود
alter table advisor_messages add column if not exists steps jsonb;
alter table advisor_messages add column if not exists error text check (error is null or length(error) <= 500);
-- الجوابُ الذي ينتظر لا نصَّ له بعد — فشرطُ الطول على «تمّ» وحده
alter table advisor_messages drop constraint if exists advisor_messages_content_check;
alter table advisor_messages add constraint advisor_messages_content_len
  check (length(content) <= 40000 and (status <> 'DONE' or length(content) >= 1));
create index if not exists advisor_messages_pending_idx on advisor_messages (thread_id) where status = 'PENDING';
