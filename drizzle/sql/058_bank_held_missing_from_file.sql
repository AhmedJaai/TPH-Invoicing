-- 058 — حركةٌ عندنا وليست في كشف البنك الذي يغطّي يومها.
--
-- المزامنةُ تسأل «أهذا الصفّ عندنا؟» ولا تسأل العكس: رسومُ ٢ و٣ سبتمبر ٢٠٢٦ دخلت مرّتين
-- أيّامَ إعادة بناء الهويّة، فبقي في معادلة البنك فرقٌ بـ١٫٧٣ لا يُعرف مصدره، وكلُّ كشفٍ
-- بعدها يذكرها مرّةً واحدة. فتُحفظ هنا بنوعٍ ثالث `MISSING_FROM_FILE` والحركةُ نفسُها
-- في `against_transaction_id`، حتّى يقرّر إنسان: «احذفها — ليست في الكشف» (`REMOVED`)
-- أو «أبقِها» (`CHECKED`).
--
-- توسيعُ قيدَي فحص: إضافةٌ آمنة — الشيفرةُ القديمة لا تكتب القيمتين الجديدتين.
alter table bank_held_rows drop constraint if exists bank_held_rows_kind_check;
alter table bank_held_rows add constraint bank_held_rows_kind_check
  check (kind in ('AMBIGUOUS', 'CONFLICT', 'MISSING_FROM_FILE'));
alter table bank_held_rows drop constraint if exists bank_held_rows_resolution_check;
alter table bank_held_rows add constraint bank_held_rows_resolution_check
  check (resolution in ('SAME', 'ADDED', 'CHECKED', 'REMOVED'));
