-- أبواب حركة البنك التي لم تكن موجودة.
--
-- كان كل وارد يُصنَّف «حركة تشغيلية»، فذهبت تسويات البطاقات كلّها إلى
-- سلّة الضجيج: خمسمئة وثمانية وخمسون ألف ريال من إيراد المقهى يصل
-- حسابه ولا يحلّله شيء. ورسومها وضريبتها معها.
--
-- وهذه الأبواب شرطٌ لربط المبيعات بالبنك لاحقاً: «بعتُ تسعة آلاف
-- ووصلني ثمانية آلاف وسبعمئة وستّون» لا يُسأل قبل أن يُعرف أيّ حركة
-- تسويةٌ وأيّها رسم.

alter type tx_category add value if not exists 'POS_SETTLEMENT';
alter type tx_category add value if not exists 'POS_FEE';
alter type tx_category add value if not exists 'POS_VAT';
alter type tx_category add value if not exists 'BANK_FEE';
