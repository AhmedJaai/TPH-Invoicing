# تقرير المال (FIN): مراجعة ١٤ سبتمبر ٢٠٢٦

## الخلاصة

- **لا ملاحظة P0 جديدة.** الأرقام الماليّة في الشاشات الرئيسة طابقت كلُّها SQL مستقلّاً كتبتُه بنفسي، ما عدا الفروق المذكورة أدناه.
- **الجديد:** ثلاث P1 مُثبَتة، وسبع ملاحظات دونها (P2: ٢، P3: ٥)، وأربع مشتبَه بها.
- **أخطر ما وجدت:** «سجّل أنّها سُدّدت» يؤرّخ الدفعة بتاريخ الفاتورة، فتفوت التوأمةُ الحوالةَ التي تأتي بعدها في كشف البنك، وتُقيَّد الواقعة دفعتين (FIN-101). الأثر اليوم ١٬٠٧٥ ريالاً تنتظر كشف سبتمبر.
- **ملاحظات المراجعة السابقة:** أُصلح أغلبها في الشيفرة. بقيت FIN-002 وFIN-006 جزئيّتين لأنّ البيانات لم تُصحَّح، وFIN-013 قائمة، والوثيقة ما زالت تقول إنّ `ops:certify` «لا يكتب شيئاً» وهو يكتب ثمّ يحذف.
- **لم أكرّر** ما سجّله المنسّق: UI-001 (‏6,851.34 مقابل 6,851.36) وUI-002 («▲281٪» والصحيح ▼54٪).
- **كتابة الملفّات:** رفضت الأداة كتابة `findings-fin.md`، فالتقرير كاملاً في هذا الردّ ليكتبه المنسّق. أمّا `docs/review/2026-09-14/coverage-fin.md` فكُتب، وأرقام الملاحظات فيه مطابقة لما هنا.

## البيئة والآثار الجانبيّة

- **البيئة:** قاعدة `tph_fin`، وخادم إنتاجيّ على 3500 شغّلتُه مرّةً بتوقيت الرياض ومرّةً بـ`TZ=UTC` مثل Vercel، وأعطت المرّتان الأرقام نفسها. الخادم متوقّف الآن.
- **الكتابة في القاعدة:** صفّا اختبار للتوقيت أدرجتُهما ثمّ حذفتُهما، وبصمة md5 لكلّ جدول بعدهما تطابق ما قبلهما. واختبار التوأمة جرى داخل معاملة أُلغيت.
- **أثر في المستودع:** تشغيلي لـ`ops:certify` كتب `certify-result.json`، فأعدتُه بـ`git checkout`. أمّا تعديل `.claude/launch.json` فليس منّي.

---

## ١) حال الملاحظات الماليّة السابقة

| القديم | الحال | الدليل (١٤ سبتمبر) |
|---|---|---|
| FIN-001 مستحقٌّ بتسامحين | **جزئيّة** | أُصلحت في `supplier-balance.service.ts:45` و`month-close-facts.ts:30` (عتبة هللة). بقي خارج ما سجّله المنسّق: `suppliers/page.tsx:158` يحسب `billed − paid` بلا عتبة، فـ«سرد كو» في `/suppliers` تساوي 0.02 وفي `/suppliers/SardCo` «0.00 لا رصيد». والهللتان في فاتورتي سرد كو `92` و`84` (1,500.01 ولكلٍّ منهما تخصيص 1,500.00) ما زالتا في البيانات |
| FIN-002 الواقعة دفعتان | **جزئيّة**: الشيفرة أُصلحت والبيانات لا | `createPayment` يسأل عن التوأم ويرمي `PaymentTwinError` (`payment.service.ts:145-152`)، و`recordBankPayment` يتبنّى التوأم المخصَّص (`:194`)، وسيناريو الشهادة ١٠ نجح. لكنّ الدفعتين الزائدتين قائمتان: لافا 945 (`15bd5c9f`) وأطلس 575 (`e578c109`) ← FIN-102. وبقيت ثغرة في الأصل ← FIN-101 |
| FIN-003 حساب المورّد أعمى عن غير المخصَّص | أُصلحت | `loadSupplierBalances` يحسب الرصيد، و`/suppliers/Ganache` تعرض «لك عنده 26,767.40»، وهو يطابق SQL (credit 2,676,740) |
| FIN-004 الكوب الذهبي يُقارَن بكشفٍ في غير زمنه | أُصلحت في الشيفرة | `suppliers/[slug]/page.tsx:136-154` يقارن بما قُيّد حتى `period_end`. المعروض: نعرف 5,854.38 حتى 07-15، والكشف 12,003.13، والفرق 6,148.75، وهو يطابق SQL. الفرق نفسه لم يُحسم (المشتبَه بها) |
| FIN-005 قائمة الدخل | أُصلحت | `money/statement/page.tsx:80-87`: المستبعَد الشخصيّ 112,722.18، و«شراء بضاعة» 6,178.00، والتشغيليّ 103,198.22 وقد أُعيد جمعه بنداً بنداً. بقي تضارب الرواتب ← FIN-103 |
| FIN-006 جدول `expenses` لا يتبع إعادة التصنيف | **جزئيّة** | `resyncBankExpenses` بُني (`expense.service.ts:167`) ويُستدعى من `api/counterparty:261` و`match-confirm:218` و`reclassify-bank.ts:122`، لكنّه لم يُشغَّل على الصفوف القائمة. ما زالت ٤ مصروفات على حركات صُنّفت PERSONAL بمبلغ 22,724.00 (رواتب: يونيو 5,500، يوليو 5,500، أغسطس 10,724؛ و«أخرى» يوليو 1,000)، و٢٥ صفّ BANK_FEE حركاتها BANK_VAT (5.03) |
| FIN-007 الإقفال بلا كشف ولا معادلة | أُصلحت | `month-close.ts:200` غياب الكشف مانع، و`:234-238` المعادلة المجهولة مانع. `/close` لأغسطس: «لا يمكن الإقفال بعد · معادلة كشف البنك ✕» مع نموذج الرصيدين. و`reconciliation_periods` له كاتبان (`month-close/route.ts:93`، `bank-import/route.ts:836`)، وفيه 0 صفوف لأنّ الكشف لم يُستورَد بعد الإصلاح |
| FIN-008 النقر المزدوج يُنشئ دفعتين | أُصلحت | `claimBankTransaction` يشترط `matched_payment_id is null` ويرمي عند صفر صفوف (`payment.service.ts:218-232`)، وتستعمله `match-confirm` و`match-confirm-bulk` |
| FIN-009 حدود الشهر بـUTC | أُصلحت، وبقي أثر كامن | `riyadh-time.ts` مستعمل في `/payments:36` و`/close:35` و`attention-facts:22` و`analytics:361`. كلّ التواريخ المخزَّنة 00:00Z (١٤١ فاتورة، ٦٣ دفعة، ١٤٤٠ حركة، ١٤ كشفاً، ٢٠١ سطر). الأثر الكامن ← FIN-107 |
| FIN-010 سطر كشفٍ مجهول المبلغ يصير صفراً | أُصلحت | `statement-extras.ts:56-92` `unreadLines`، و`statement-reconcile/route.ts:184` |
| FIN-011 `db:unpaid` بـ`sum(distinct)` | أُصلحت | `diagnose-unpaid.ts:28-37` يجمع على الفواتير المميّزة، والمخرَج «14 · 6851.34» يطابق SQL. بقي تلميع ← FIN-106 |
| FIN-012 `detectAnomalies` غير موصولة | أُصلحت | `attention-facts.ts:299-324` |
| FIN-013 `::int` على المجاميع | **قائمة** (P3) | 22 موضعاً `sum(...)::int`، منها `app/page.tsx:82` و`bank/page.tsx:65-97` و`match-confirm/route.ts:290,429,539` و`mark-paid/route.ts:147`. ينكسر عند 21.47 مليون ريال للفاتورة أو الدفعة الواحدة |
| FIN-014 الرقم الضريبيّ بأرقام عربية | أُصلحت | `validation.ts:71-85` `latinDigits` قبل `\D`، والرقم ١٥ خانة يبدأ بـ3 وينتهي بـ3 (`:80-84`) |
| FIN-015 تحجيم البنود بعدد عشريّ | أُصلحت | `line-pricing.ts:165-178`: قسمة صحيحة ×100÷115، ثمّ يُردّ الفرق إلى أكبر بند |
| SCN-015 الإقفال لا يحرس إلّا الأرشفة | أُصلحت | `month-guard.ts` في `createPayment` و`allocate` و`createInvoice`، ومؤثِّرات `028`. `db:verify` مرّ 14 من 14، منها ثلاثة فحوص للشهر المقفل وواحد يقبل تحديث الحال |
| BTN-003 الوسم الجماعيّ بالسداد | **جزئيّة** | `mark-paid` صار يقبل `invoiceIds` بأعيانها (حتى 50، `:128-131`). لكنّه ما زال يكتب `BANK_TRANSFER` ويؤرّخ الدفعة بتاريخ الفاتورة ← FIN-101 |
| «الشهادة لا تكتب شيئاً» (`ops:certify`) | **قائمة** (P2، وثيقة) | رأس `certify-flow.ts:5` و`CLAUDE.md` يقولان «لا يكتب شيئاً»، والدليل يقول غير ذلك (التفصيل تحت الجدول) |
| M1/D1–D6 قيود المال في القاعدة | أُصلحت | `db:verify` 14/14. و`over_alloc`: 0 فاتورة و0 دفعة تجاوزت، و0 تخصيصات يتيمة، و0 تخصيصات على مردودة |
| `classification_source` و`bank_account_id` و«أُقرّت ولم تُقيَّد» | أُصلحت تقريباً | 5 حركات بلا `classification_source` من 1440، و0 بلا حساب، و0 SUPPLIER بحال CONFIRMED بلا دفعة |

**تفصيل الدليل على أنّ `ops:certify` يكتب:** بعد تشغيله على `tph_fin`:
- `pg_stat_user_tables.suppliers.n_tup_del` زاد 1، ولا سيناريو غير الثامن يحذف مورّداً. وزادت كذلك `invoices` و`documents` و`payments` بواحد، و`payment_allocations` باثنين.
- بصمة كلّ الجداول قبله وبعده متطابقة، فلا أثر يبقى. لكن الانقطاع بين الإدراج والحذف (`:405-438`) يترك مورّداً وفاتورةً ودفعةً في القاعدة.
- وكتب `certify-result.json` في المستودع، فأعدتُه بـ`git checkout`.

---

## ٢) مطابقة الأرقام: الصفحة مقابل SQL مستقلّ

| الرقم | الصفحة | المعروض | SQL المستقلّ (هللات) | الفرق | السبب |
|---|---|---|---|---|---|
| المستحقّ للمورّدين | `/` `/money` `/purchases` | 6,851.34 | `supplier_owed_total` = 685,134 (مفتوح 685,134 − خصم 0) | 0 | — |
| مشتريات 2026-09 | `/` | 6,059.84 ▼69٪ عن أوّل 14 يوماً من 08 | 605,984؛ أغسطس حتى يوم 14 = 1,939,944 ⇒ −68.8٪ | 0 | — |
| ضريبة مدخلات مؤكَّدة / قابلة للاسترداد | `/` `/money` | 11,994.91 | VALID/ELIGIBLE 1,199,491 (67 فاتورة) | 0 | — |
| ضريبة معرّضة للضياع | `/money` `/attention` | 1,498.18 · 7 لم تُقرأ | NOT_ELIGIBLE 149,818 · UNKNOWN 7 | 0 | — |
| الحالة الضريبية | `/purchases` | 67 / 7 | INVALID 67 · UNKNOWN 7 | 0 | — |
| الفواتير | `/purchases` | 141 · 138,803.65 | 141 · 13,880,365 | 0 | — |
| الصادر من الحساب | `/money` | 367,946.74 | DEBIT 36,794,674 (1022 حركة، 0 UNKNOWN) | 0 | — |
| حركات كشف البنك | `/money` | 1440 | 1022 + 418 | 0 | — |
| دفعات مسجّلة | `/money` | 63 | APPLIED 47 + UNAPPLIED 9 + PARTIALLY 4 + VOID 2 + REVERSED 1 | 0 | يعدّ الملغاة والمردودة «مسجّلة» (P3 تسمية) |
| المصروف حسب نوعه: رواتب | `/money` | 34,973.75 (20 حركة) | SALARY 3,497,375 | 0 | يخالف `/money/statement` ← FIN-103 |
| إيجار · حكومي · مرافق · رسوم شبكة · أخرى · ضريبة رسوم الشبكة · رسوم بنكية · ضريبتها | `/money` | 47,500 · 14,709.32 · 6,722.12 · 4,423.33 · 500 · 490.16 · 52.28 · 5.26 | 4,750,000 · 1,470,932 · 672,212 · 442,333 · 50,000 · 49,016 · 5,228 · 526 | 0 | — |
| تحويلات شخصيّة مستبعَدة | `/money/statement` | 112,722.18 | PERSONAL 11,272,218 (38) | 0 | — |
| «شراء بضاعة» مستبعَد | `/money/statement` | 6,178.00 | SALARY 567,800 + OTHER 50,000 بوصف «بضاعة» | 0 | — |
| رواتب وأجور | `/money/statement` | 29,295.75 | 3,497,375 − 567,800 | 0 | — |
| مجموع المصروفات التشغيليّة | `/money/statement` | 103,198.22 | جمع البنود الثمانية = 10,319,822 | 0 | — |
| المشتريات | `/money/statement` | 138,803.65 | 13,880,365 | 0 | — |
| وارد وصادر 2026-09 | `/money/statement` | 2,996.70 / 13,690.51 | 299,670 / 1,369,051 | 0 | الشهر بـUTC ← FIN-107 |
| المتوسّط الشهريّ «الفعلي» | `/money/statement` | إيجار 9,500 · رواتب 5,859.15 | 4,750,000 ÷ 5 · 2,929,575 ÷ 5 | القاسم يشمل ١٤ يوماً من سبتمبر | FIN-104 |
| الفعليّ في 2026-08: رواتب | `/money/expenses?month=2026-08` | 22,474.00 | `expenses` 2,247,400، منها 1,072,400 على حركة PERSONAL | +10,724 | FIN-006 جزئيّة، FIN-103 |
| الفعليّ في 2026-09 | `/money/expenses` | 28.20 · 14 بنداً | BANK_FEE 150 + POS_FEE 2,670 | 0 | ضريبة رسوم الشبكة لسبتمبر غائبة من الجدول ← FIN-105 |
| دفعة خرجت ولا فاتورة تفسّرها | `/` `/attention` | 13 · 35,644.90 | 13 · 3,564,490 | 0 | يشمل توائم FIN-102 |
| مالٌ خرج مرّتين | `/` `/attention` | 2,350.77 (3) | 169,939 + 36,388 + 28,750 | 0 | — |
| متأخّر أكثر من 60 يوماً | `/attention` | 1,796.00 · المحمصة الغربية · 106 يوماً | 179,600 (263347455) | 0 | أحمد وصفها «ملغاة» ← المشتبَه بها |
| دفعة 2026-08: جاهز للتحويل | `/payments` | 956.00 (أفال 506 · بيكوف 450) | 50,600 + 3 × 15,000 | 0 | — |
| مستحقّات الشهر | `/close?month=2026-08` | 4 فواتير · 956.00 | 4 · 95,600 | 0 | — |
| غير مسدَّدة | `db:unpaid` | 14 · 6851.34 | 14 · 685,134 | 0 | — |
| الكوب الذهبي: المستحقّ | `/suppliers` `/suppliers/GoldenCup` | 0.00 «لا رصيد» | الفاتورتان مخصَّصتان كاملتين (1,350,675 و1,200,313) | 0 | — |
| الكوب الذهبي: نعرف / الكشف / الفرق / دفعتَ بعده | `/suppliers/GoldenCup` | 5,854.38 / 12,003.13 / 6,148.75 / 5,854.38 | 2,550,988 − 1,965,550 = 585,438؛ مدفوع بعد 07-15 = 585,438 | 0 | الفرق حقيقيّ ولم يُحسم |
| غاناش | `/suppliers` `/suppliers/Ganache` | لك عنده 26,767.40 · نعرف −21,334.80 · الكشف 5,432.60 | credit 2,676,740؛ 541,420 − 2,674,900 | 0 | — |
| لوريفا | `/suppliers/Loreva` | 1,012.00 | open 101,200 | 0 | — |
| لافا كمبوتشا | `/suppliers/LavaKombucha` | لك عنده 1,512.00 | credit 151,200 | 0 | منه 945 توأم ← FIN-102 |
| أوراق الزيتون | `/suppliers/OliveLeaves` | 700.00 · الكشف يوافق 3,760.00 | 70,000 · 2,133,200 − 1,757,200 | 0 | — |
| أفال — بدر | `/suppliers/AVAL` `/suppliers` | 2,653.34 · نعرف 6,457.83 · الكشف 8,402.77 · الفرق 1,944.94 | 265,334 · 2,783,202 − 2,137,419 | 0 | — |
| المحمصة الغربية | صفحته | 1,796.00 | 179,600 | 0 | — |
| بيكوف | صفحته | 690.00 · الكشف يوافق 900 | 69,000 · 90,000 | 0 | — |
| زاكوباك | صفحته | 0.00 · الكشف يوافق 2,656.90 | 772,595 − 506,905 | 0 | — |
| أطلس / كوهي / مريم / أوسكا | صفحاتهم | لك عنده 575 / 833.75 / 2,560 / 396.75 | credit 57,500 / 83,375 / 256,000 / 39,675 | 0 | أطلس ← FIN-102 |
| هنقري مان بيكري | صفحته | نعرف 0.00 · الكشف 80.00 | 24,000 − 24,000 | 0 | — |
| سرد كو | `/suppliers` مقابل `/suppliers/SardCo` | 0.02 مقابل 0.00 | 375,002 − 375,000 | هللتان بين شاشتين | FIN-001 جزئيّة |

**«كم أدين لمصنع الكوب الذهبي؟» في كلّ شاشة:**
- لا يظهر في `/` و`/money` و`/purchases` و`/payments` و`/attention`، لأنّ المستحقّ صفر.
- `/suppliers`: الصافي 0.00.
- `/suppliers/GoldenCup`: المستحقّ 0.00، ومعه «الفرق 6,148.75 — يطالب بأكثر ممّا نعرف».
- مصدر الصفر قيدان من خارج البنك:
  1. «سُدّدت من حساب المالك» بمبلغ 12,003.13 مؤرّخاً 07-15 (سجلّ التدقيق 2026-09-13 21:03).
  2. «سجّل أنّها سُدّدت» بمبلغ 152.37 مؤرّخاً 05-18، بلا حركة بنك ولا مستند (سجلّ التدقيق 2026-09-14 10:35).

---

## ٣) الملاحظات الجديدة

### FIN-101 · P1 · مُثبَتة · «سجّل أنّها سُدّدت» يؤرّخ الدفعة بتاريخ الفاتورة، فتفوت التوأمةُ حوالةَ البنك وتُقيَّد الواقعة دفعتين

- **الدور:** المدقّق المالي السعودي، ومهندس الجودة.
- **الموضع:**
  - `src/app/api/mark-paid/route.ts:163-171`: الدفعة تُنشأ بـ`paidAt: inv.invoiceDate` و`method: "BANK_TRANSFER"`.
  - `src/services/payment.service.ts:113-114`: `findPaymentTwin` يطابق **اليوم نفسه** فقط.
  - الزرّ «سجّل أنّها سُدّدت» (`MarkInvoicePaid` في `/purchases/invoices`، و`MarkSupplierPaid` في `/payments`).
- **إعادة الإنتاج (`twin-miss.mts` في معاملة أُلغيت على `tph_fin`):**
  - المدخل: دفعة «مختبرات القهوة» `d79e2dc6` بمبلغ 638.00، أنشأها `mark-paid` في 2026-09-14 10:34. سجلّ التدقيق: «وسم يدوي بالسداد · إقرار المالك لا مطابقة بنكية». تاريخها تاريخ الفاتورة V405669 (09-08)، ولا حركة بنك لها.
  - الحوالة الحقيقيّة تظهر في كشف البنك بتاريخ الخصم، وليكن 09-10. آخر حركة في الكشف الحاليّ 09-03.
  - النتيجة:
    - `findPaymentTwin(09-08)` = `{id: d79e2dc6, hasBankRow: false}`.
    - `findPaymentTwin(09-10)` = `null`.
    - `recordBankPayment({paidAt: 09-10, 638})` = `{"adopted": false}`، أي دفعة ثانية.
  - **المتوقَّع:** تُتبنّى الدفعة القائمة وتُربط بالحركة. **الواقع:** الواقعة الواحدة تُقيَّد دفعتين.
- **الأثر:**
  - في البيانات اليوم ثلاث دفعات من هذا النوع بمبلغ 1,227.37: رونة 437.00 (`107142da`)، ومختبرات القهوة 638.00 (`d79e2dc6`)، والكوب الذهبي 152.37 (`c1f48658`).
  - أوّل استيراد لكشف سبتمبر يُنشئ لرونة ومختبرات القهوة دفعتين غير مخصَّصتين بمبلغ 1,075.00. يظهر عندها «لك عنده»، ويرتفع «دفعة خرجت بلا فاتورة».
  - بعد ذلك يخصم `applySupplierCredit` الرصيد الوهميّ من فاتورتهما القادمة خلال ٧ أيّام، فتبدو فاتورةٌ مسدَّدة لم تُدفع، وقد يفوت سدادها.
  - وفي الكوب الذهبي كُتب `BANK_TRANSFER` لحوالةٍ لا وجود لها: SQL `bank_same_amount_new_payments` لا يجد أيّ حركة بـ15,237. فصار العمود يكذب، والدفعة من «دفعات بلا أصل» (12).
- **الإصلاح المقترح:**
  1. يسأل `mark-paid` عن تاريخ السداد، وافتراضيّه اليوم بتوقيت الرياض (`todayInRiyadh`)، ويكتب طريقةً غير `BANK_TRANSFER` (قيمة `MANUAL` تُضاف إلى `payment_method` بهجرة).
  2. يتبنّى `findPaymentTwin` الدفعاتِ اليدويّة التي بلا حركة بنك بنافذة من تاريخها حتى ١٤ يوماً بعده، بدل اليوم نفسه.
  3. سيناريو شهادة على نمط السيناريو ١٠: دفعة يدويّة ثمّ حركة بتاريخ مختلف، والنتيجة دفعة واحدة.
  - **الجهد:** نصف يوم.
  - **مخاطر الإصلاح:** النافذة الأوسع قد تبتلع سداداً حقيقيّاً ثانياً (بيكوف يُسدَّد بـ150 مرّةً بعد مرّة)، فيبقى إقراراً مع عرض التوأم لا منعاً صامتاً.
- **يخالف قراراً في CLAUDE.md؟** نعم:
  - «الريال الواحد يأتي من بابين فيُقيَّد مرّتين… **الإيصالُ دليلٌ على دفعة لا دفعةٌ ثانية**، والكشفُ يتبنّى ما قُيّد من إيصاله ولا ينسخه».
  - «التوأم يُسأل في `createPayment` نفسها». هو يُسأل فعلاً، لكن بمفتاحٍ يُفلته هذا الباب.
- **حال المراجعة السابقة:** جديدة، وتمتدّ من FIN-002 وBTN-003.
- **المحامي المضادّ:**
  - بحثتُ عن تبنٍّ بغير مفتاح اليوم في `reconcile.service.ts` و`match-confirm/route.ts` و`bank-import/route.ts`: كلّها تمرّ بـ`findPaymentTwin` أو `recordBankPayment`.
  - بحثتُ عن قيد في القاعدة: لا يوجد، والتوأمة «كشفٌ لا قيد» عمداً.
  - سجلّ التدقيق يسمّيها «إقرار المالك لا مطابقة بنكية»، لكنّ التوأمة لا تقرأ السجلّ، والعمود `method` يقول `BANK_TRANSFER`.
  - ليست حالة نظريّة: الدفعتان الأوليان لسداداتٍ لم يصل كشفها بعد.
  - لم تنتقض.

### FIN-102 · P1 · مُثبَتة · توأما لافا وأطلس ما زالا في القاعدة، ورفضُ أحمد لاقتراح الذكاء ثبّتهما

- **الدور:** المدقّق المالي السعودي، وأحمد.
- **الموضع:**
  - **البيانات:**
    - `payments.15bd5c9f`: لافا كمبوتشا، 945.00، APPLIED على الفاتورة `003` (2026-06-02)، بلا مستند ولا حركة، أُنشئت 09-04 00:52.
    - `payments.e578c109`: محمصة أطلس، 575.00، APPLIED على `INV-2026-05297`، بلا أصل، أُنشئت 09-04 01:10.
  - **القرار:** `ai_findings` بنوع `DUPLICATE_PAYMENT` رُفض مرّتين. سجلّ التدقيق 2026-09-13 21:00:44: «هي دفعة واحدة وقرائتك خاطئة». و21:04:03: «سددت مرة واحدة وهذا خطأ في قرائتك للملف».
  - **الواجهة:** `src/components/ai-analysis.tsx` (أقرّ / ارفض)، و`src/services/supplier-analysis.service.ts` («الرفض يقرؤه التحليل القادم»).
- **إعادة الإنتاج:**
  - SQL `twins`: مجموعتان (مورّد · يوم · مبلغ)، في كلّ منهما دفعة لها حركة بنك (`bank=1`) وأخرى بلا أصل (`bank=0, doc=false`).
  - `/suppliers/LavaKombucha`: «لك عنده 1,512.00 دفعتَها بلا فاتورة».
  - `/suppliers/AtlasRoastery`: «لك عنده 575.00».
  - في كشف البنك حركة واحدة بـ945 وحركة واحدة بـ575.
- **الأثر:**
  - 1,520.00 ريالاً رصيداً وهميّاً عند مورّدَين، داخلةً في بطاقة «13 دفعة خرجت ولا فاتورة تفسّرها · 35,644.90».
  - فاتورة لافا `003` (945) تبدو مسدَّدة بدفعة لم تقع. إن لم تُدفع فالمستحقّ ناقص 945، وإن دُفعت فالرصيد 945 وهميّ.
  - أحمد قال الصواب («دفعة واحدة»)، لكنّ الفعل الوحيد أمامه «ارفض»، والرفض يُسكت الاقتراح في التحليل القادم. صار الخطأ مؤكَّداً بقرار إنسان.
- **الإصلاح المقترح:**
  1. فعلٌ ثالث لنوع `DUPLICATE_PAYMENT`: «هي دفعة واحدة — ألغِ الزائدة». يعاين ما يتحرّر ثمّ يستدعي `reversePayment({kind: "VOID"})` على الدفعة التي بلا أصل، ويكتب في التدقيق.
  2. يُحسم التوأمان الحاليّان بقرار أحمد (سؤال HANDOFF: أيّ فاتورتي لافا سُدّدت؟).
  - **الجهد:** نصف يوم.
  - **مخاطر الإصلاح:** الإلغاء يُعيد `003` مستحقّةً، وهذا صحيح إن لم تُدفع. ويلزم ألّا يُتاح الفعل على دفعة لها حركة بنك.
- **يخالف قراراً في CLAUDE.md؟** نعم:
  - «**الواقعة الواحدة لا تُقيَّد دفعتين**».
  - نصّ `createPayment` يقول: «فبقيت لافا ٩٤٥ دفعتين… وأطلس ٥٧٥ رصيداً وهميّاً» بصيغة ما عولج، والبيانات لم تُعالَج.
  - يخالف أيضاً «من يبني طبقةً جديدة يُعيد تشغيلها على البيانات القائمة».
- **حال المراجعة السابقة:** FIN-002، والشقّ الباقي منها هو البيانات.
- **المحامي المضادّ:**
  - هل هما واقعتان حقيقيّتان؟ في البنك حركة واحدة لكلّ مبلغ، وأحمد نفسه قال «دفعة واحدة».
  - هل يكشفهما بندٌ آخر؟ بند «دفعات بلا فاتورة» يعرض الرصيد ولا يسمّي التوأم، ولا يوجد بند «دفعات بلا أصل» ظاهر في `/attention` (العناوين الظاهرة ثلاثة، والبقيّة مطويّة «أقلّ أهمّية»).
  - لم تنتقض.

### FIN-103 · P1 · مُثبَتة · ثلاثة أرقام لـ«الرواتب»، وجدول المصروف ما زال يحسب سحب المالك راتباً

- **الدور:** المدقّق المالي السعودي، وأحمد.
- **الموضع:**
  - `src/app/money/page.tsx:51-57`: يستثني PERSONAL وPOS_SETTLEMENT ولا يطبّق `looksLikeGoodsPurchase`.
  - `src/app/money/statement/page.tsx:80-87`: يطبّقها.
  - `/money/expenses` يقرأ جدول `expenses` الذي لم يُعَد اشتقاقه (`expense.service.ts:167`، `resyncBankExpenses` لم يُشغَّل على القائم).
- **إعادة الإنتاج:**
  - `/money` «المصروف حسب نوعه»: «راتب أو أجر 34,973.75».
  - `/money/statement`: «رواتب وأجور 29,295.75».
  - `/money/expenses?month=2026-08`: «راتب أو أجر 22,474.00». منها 10,724.00 تحويلٌ لأحمد (`احمد محمد يسلم الجعيدي … رواتب`) صنّفه إنسان PERSONAL.
  - SQL `exp_on_personal_by_month`: 4 صفوف بمبلغ 22,724.00. و`expenses_vs_bank_cat`: 3 SALARY وOTHER واحد على PERSONAL، و25 BANK_FEE على BANK_VAT.
- **الأثر:**
  - «كم أنفقتُ على الرواتب؟» له ثلاثة أجوبة. الفرق بينها 5,678 (بضاعة) و22,724 (سحب شخصيّ عبر الأشهر).
  - المصروف الفعليّ لأغسطس منفوخ 10,724 (15٪ من 71,560.60). والمقارنة بالمتوقَّع، متى سُجّل، ستقول «تجاوزتَ الرواتب» كذباً.
- **الإصلاح المقترح:**
  1. يُشغَّل `resyncBankExpenses(t, null, {})` مرّةً على القاعدة، كما يفعل `db:reclassify`. يحذف 4 صفوف ويحدّث 25، ويكتب ذلك في التدقيق.
  2. `/money` يستثني «شراء بضاعة» بالدالّة نفسها، أو يقرأ الأرقام من مصدرٍ واحد تشترك فيه الصفحات الثلاث.
  3. اختبار قاعدة: تغيير تصنيف حركة إلى PERSONAL يُخرج مصروفها من الصفحات الثلاث.
  - **الجهد:** ساعتان.
  - **مخاطر الإصلاح:** حذف صفوف ماليّة. يُعايَن أثره قبل التشغيل، وهي أربعة صفوف كلّها سحب شخصيّ ثابت.
- **يخالف قراراً في CLAUDE.md؟** نعم:
  - «**من يبني طبقةً جديدة يُعيد تشغيلها على البيانات القائمة في الكوميت نفسه، وإلّا فهي دعوى**».
  - «عددٌ واحد للعمل الباقي… العدد الذي يتغيّر بتغيّر الصفحة يفقد صفته عدداً».
  - «المصروف الفعلي لا يشمل سداد المورّد… وما يقول وصفه شراء بضاعة يُستبعَد».
- **حال المراجعة السابقة:** FIN-006 جزئيّة (الشيفرة أُصلحت والبيانات لا)، وبقيّة FIN-005 (الأرقام بين الشاشات).
- **المحامي المضادّ:**
  - هل يُصلحه الزرّ «اشتقّ من كشف 2026-08»؟ نعم، لو ضُغط: `deriveExpensesFromBank` يستدعي `resyncBankExpenses` للشهر (`:125`). لكن لم يُضغط، ولا شيء في الشاشة يقول إنّ الرقم مبنيّ على تصنيفٍ قديم.
  - هل الفرق بين `/money` و`/money/statement` مقصود؟ نصّ `/money` نفسه يقول «وسداد المورّدين والتحويل الشخصيّ مستثنيان» ولا يذكر البضاعة، و`/money/statement` يستثنيها معلِناً.
  - لم تنتقض.

### FIN-104 · P2 · مُثبَتة · «المتوقَّع مقابل الفعلي» يقسم على خمسة أشهر، منها نصف سبتمبر

- **الدور:** المدقّق المالي السعودي.
- **الموضع:** `src/app/money/statement/page.tsx:103-107`: `monthsCount = cash.months.length`، وفيه 2026-09 وعمره ١٤ يوماً (حركات حتى 09-03).
- **إعادة الإنتاج:** الإيجار 47,500 وقع مرّة واحدة في أغسطس، والصفحة تعرض «الفعلي شهرياً 9,500.00». والرواتب 5,859.15 = 29,295.75 ÷ 5.
- **الأثر:** المتوسّط منقوص بقدر الشهر الناقص (خُمسه تقريباً). ومتى سُجّلت المصروفات المتكرّرة سيقول «أنفقتَ دون المتوقَّع» كذباً.
- **الإصلاح المقترح:** استثناء الشهر الجاري غير التامّ من القاسم، أو القسمة على الأيّام المغطّاة بالكشف ضرب ثلاثين. **الجهد:** نصف ساعة. **المخاطر:** لا شيء.
- **يخالف قراراً في CLAUDE.md؟** نعم: «**الشهر الجاري يُقارَن بمثله**… والنقص يومٌ لا سلوك».

### FIN-105 · P2 · مُثبَتة · جدول المصروف لا يُشتقّ عند الاستيراد، والشاشة لا تقول إنّ الشهر ناقص

- **الدور:** المدقّق المالي السعودي.
- **الموضع:** `src/services/expense.service.ts:46` (`deriveExpensesFromBank` بزرّ «اشتقّ من كشف الشهر» وحده)، و`src/app/money/expenses/page.tsx`.
- **إعادة الإنتاج:** SQL `bank_expense_missing` يجد حركات مدينة من أبواب المصروف بلا صفّ في `expenses`:
  - POS_FEE: 9 حركات (102.87)
  - POS_VAT: 8 (15.42)
  - BANK_FEE: 20 (17.78)
  - BANK_VAT: 2 (0.23)
  - SALARY: 8 (5,758.00، منها 5,678 «بضاعة» مستبعَدة عمداً، والباقي 80 رواتب بلا وصف)
  - OTHER: 2 (500، «بضاعة» عمداً)

  و`/money/expenses` لسبتمبر تعرض 28.20 (14 بنداً) بلا ضريبة رسوم الشبكة، ولا تذكر أنّ حركاتٍ من الكشف لم تُقيَّد.
- **الأثر:** 216.30 ريالاً ناقصة. المبلغ صغير، لكنّ الشاشة تعرض «الفعليّ» كأنّه كامل.
- **الإصلاح المقترح:** عدّاد «حركات مصروف في الكشف لم تُقيَّد بعد: N بقيمة X» بجانب الفعليّ مع رابط الاشتقاق، أو اشتقاق تلقائيّ في معاملة الاستيراد. **الجهد:** ساعة. **المخاطر:** الاشتقاق التلقائيّ يطيل معاملة الاستيراد (OPS-009).
- **يخالف قراراً في CLAUDE.md؟** نعم: «**المجهول ليس صفراً**»، و«التغطية لا تُختلق».

### FIN-106 · P3 · مُثبَتة · `db:unpaid` يطبع `150.0000000000000000` ويقترح حوالةً لا صلة لها

- **الدور:** مهندس الجودة.
- **الموضع:** `scripts/diagnose-unpaid.ts`، أسطر الأمثلة بعد `:37`: المبلغ `numeric / 100` بلا تنسيق، والمطابقة بالمبلغ ونافذة ٤٥ يوماً وحدهما.
- **إعادة الإنتاج:** المخرَج «150.0000000000000000 · بيكوف فاتورة 00346 … الحركة 2026-08-10 · تصنيفها OTHER · شركة الرعاية المتناهية». الفواتير الثلاث كلّها تُطابَق بحوالة شركة فلاتر المياه.
- **الأثر:** تشخيصٌ مضلِّل يوحي بأنّ فواتير بيكوف ربّما سُدّدت.
- **الإصلاح المقترح:** `formatRiyalsDisplay`، واشتراط تطابق المورّد أو المستفيد، أو تصنيف SUPPLIER. **الجهد:** ربع ساعة. **المخاطر:** لا شيء.

### FIN-107 · P3 · مُثبَتة · الشهر يُحسب بـUTC، و`payment_month` موسومة IMMUTABLE وهي تتبع المنطقة الزمنيّة

- **الدور:** مهندس البرمجيات الرئيسي، والمدقّق المالي.
- **الموضع:**
  - `to_char(value_date,'YYYY-MM')` في `money/statement/page.tsx:38` و`expense.service.ts:64` و`search.service.ts:192`.
  - `month-close-facts.ts:18-19` (حدود بـ`Z`).
  - `payment.service.ts:135` (`toISOString().slice(0,7)`).
  - `supplier-analysis.service.ts:146` (`today` بـUTC).
  - `drizzle/sql/028_month_lock.sql` `payment_month(...) IMMUTABLE` حول `to_char(timestamptz)`.
- **إعادة الإنتاج:**
  - أُدرجت حركتان مدينتان في `tph_fin`: 23:30 بتوقيت الرياض 08-31 (20:30Z، 1,234.56) و00:30 بتوقيت الرياض 09-01 (21:30Z، 6,543.21). ثمّ حُذفتا، والبصمة مطابقة.
  - `/money/statement`: صادر أغسطس من 139,084.93 إلى 146,862.70 (+7,777.77، أي الحركتان)، وسبتمبر 13,690.51 بلا تغيير.
  - `/close?month=2026-09`: لا تغيّر.
  - في جلسة `set timezone='Asia/Riyadh'`: `payment_month(null,'2026-08-31 21:30Z')` = `2026-09`، وفي جلسة UTC = `2026-08`. و`provolatile = 'i'`.
- **الأثر:** صفر اليوم. كلّ التواريخ المخزَّنة 00:00Z، والمحلّلات تستعمل `Date.UTC`، وجلسة القاعدة UTC، ولا مسار سداد يكتب `new Date()`. يصير أثراً في حالتين:
  - إن كُتب تاريخٌ بساعة.
  - إن شُغّل نصٌّ من جهازٍ بتوقيت +03 يقرأ عمود `date`: `pg` يحوّله إلى منتصف ليلٍ محلّيّ، فيتأخّر `toISOString()` يوماً. هذا الجهاز نفسه +03، ومثاله `attention-facts.ts:51,58` لو شُغّل محلّياً.
- **الإصلاح المقترح:** اصطلاح موثَّق «التاريخ المدنيّ = 00:00Z» في `ARCHITECTURE.md`، وحارس في `code-guards.test.ts` يرفض `paidAt: new Date()` و`valueDate: new Date()`، و`payment_month` تُوسم STABLE. **الجهد:** ساعة. **المخاطر:** لا شيء.
- **يخالف قراراً في CLAUDE.md؟** يمسّ روح «"اليوم" و"الشهر الجاري" بتوقيت الرياض — لا `toISOString().slice(0, 7)`»، و`payment.service.ts:135` يستعمل الصيغة الممنوعة نصّاً (سليمةٌ اليوم بالاصطلاح وحده).

---

## ٤) مشتبَه بها (معزولة)

1. **ضريبة أقلّ من ١٥٪ بمضاعفات ١٨ ريالاً بالضبط.** خمس فواتير: `2595` و`2823` (VALID)، و`2317` و`2330` (INVALID) ينقصها 18.00 عن 15٪ من الصافي، و`2483` (INVALID) ينقصها 9.00 (SQL `vat15_mismatch`). يوحي بصافٍ يشمل بنداً غير خاضع للضريبة بقيمة 120 أو 60 ريالاً، أو بخطأ قراءة. `validation.ts:150-157` يجعلها INFO فلا تمنع. تحتاج فتح المستندات.
2. **الكوب الذهبي: لأيّ فاتورة كان سداد المالك؟** كشف المورّد في 07-15 يقول إنّ المستحقّ 12,003.13، أي فاتورة يوليو وحدها ومايو مسدَّدة. وأحمد أقرّ «فاتورة يوليو مسددة من خارج حساب المقهى» بتاريخ 07-15. فإن صحّ الكشف فسداد المالك كان لمايو لا ليوليو، ويبقى الفرق 6,148.75 بلا تفسير في الحسابين. الصفحة تعرضه، والحسم لأحمد.
3. **المحمصة الغربية 263347455 (1,796.00).** أحمد رفض اقتراحاً عنها بملاحظة «الفاتورة هذي ملغاة» (التدقيق 2026-09-13 21:02:50)، والفاتورة ما زالت في «عليك» وفي «متأخّرة أكثر من 60 يوماً». لم أجد مساراً في الواجهة لإلغاء فاتورة، ولم أبحث فيه بعمق.
4. **61 فاتورة بلا `seller_vat`، وواحدة برقم بائع غير صالح** (SQL `vat_invoice_seller`). لم أتحقّق أنّ حالتها الضريبية كلّها INVALID.

---

## ٥) النصوص المشغَّلة على `tph_fin`

| النصّ | المخرَج | ملاحظة |
|---|---|---|
| `db:verify` (`verify-invariants.ts`) | 14 من 14 قيداً يعمل، كلٌّ رُفض بقيده المسمّى | البصمة بعده مطابقة |
| `db:identity` (`identity-report.ts`) | 1440 حركة · 0 مكرَّر قاطع · 0 محتمل · 36 صفّاً في 18 مجموعة تكرار مشروع | عرض فقط. `apply` يكتب بلا `guard-write`، ولم يُشغَّل |
| `db:split-check` | «لا مورّد يبدو مسجّلاً مرّتين بدليلٍ ماليّ» | — |
| `db:unpaid` | 14 · 6851.34 · 3 · 450.00 | FIN-106 |
| `ops:certify` | 11 من 11 · «أثرٌ باقٍ 0» | يكتب ويحذف فعلاً (القسم ١)، ويكتب `certify-result.json` في المستودع |
| سباق التخصيص على فاتورة | `db:verify` «تخصيصٌ يتجاوز إجمالي الفاتورة (سباق دفعتين) — رُفض بقيده»، والشهادة ٨ «نجح 1 من 2 · المخصَّص 3000» | مؤثِّر `026` يعمل |

---

## ٦) ما لم يُفحَص ولماذا

- **`/purchases/invoices` و`/bank` و`/review`:** جُلبت صفحاتها ولم تُطابَق رقماً رقماً، والوقت ذهب إلى الصفحات المطلوبة نصّاً.
- **صفحات المورّدين الذين لا مستحقّ عليهم ولا رصيد:** مختبرات القهوة، ورونة، وملتقى الأواني، وسرد للتجارة. أرقامهم في SQL `slugs` ولم تُجلب صفحاتهم.
- **بقيّة `scripts/`** (غير الخمسة المشغَّلة): فُحصت ببحث الأنماط وحده (`float-grep.txt`، ٤٠٩ نتيجة)، ولم تُقرأ كاملة.
- **ملفّات `src/lib/bank/**` غير الماليّة الصرفة** (التصنيف والهويّة والمرشّحون): بحث أنماط لا قراءة كاملة. النتائج كلّها درجات ونصوص أدلّة لا مال مكتوب.
- **FIN-101 عبر الواجهة كاملةً:** لم أستورد كشفاً حقيقيّاً فيه حوالة سبتمبر. البرهان استدعى الخدمة التي يستدعيها الاستيراد، داخل معاملة أُلغيت.
- **الهجري:** لا تاريخ هجريّ في الشيفرة الماليّة ولا في البيانات. لم يُبحث في مخرَج الاستخراج عن تواريخ هجريّة مكتوبة في المستندات.
- **الفاتورة المبسّطة:** لا توجد مبسّطة في البيانات. منطقها في `validation.ts` قُرئ ولم يُختبر.

---

## ملحق أ — SQL المستعمل

الملفّات في `$SP/fin/`: `q1-headline.sql`، `q2-tz-integrity.sql`، `q3-suppliers.sql`، `q5.sql`، `q6.sql`، `q7.sql`، `q8-tz-insert.sql`، `q9-del.sql`، `pgstat.sql`، و`counts.mjs` (بصمة md5 لكلّ جدول)، و`twin-miss.mts`. الاستعلامات الحاكمة:

```sql
-- المستحقّ بالمورّد (عتبة هللة، الرصيد لا يُخصم من مورّدٍ آخر)
with inv as (select supplier_id, sum(case when total_minor-coalesce((select sum(amount_minor) from payment_allocations pa where pa.invoice_id=i.id),0) > 1
         then total_minor-coalesce((select sum(amount_minor) from payment_allocations pa where pa.invoice_id=i.id),0) else 0 end) open
       from invoices i where supplier_id is not null group by 1),
pay as (select supplier_id, sum(greatest(0, amount_minor - fee_minor - coalesce((select sum(amount_minor) from payment_allocations pa where pa.payment_id=p.id),0))) credit
       from payments p where supplier_id is not null and status not in ('REVERSED','VOID') group by 1)
select s.name_ar, coalesce(inv.open,0) open, coalesce(pay.credit,0) credit,
       greatest(0,coalesce(inv.open,0)-coalesce(pay.credit,0)) owed, greatest(0,coalesce(pay.credit,0)-coalesce(inv.open,0)) credit_left
from suppliers s left join inv on inv.supplier_id=s.id left join pay on pay.supplier_id=s.id
where coalesce(inv.open,0)+coalesce(pay.credit,0) > 0 order by owed desc;

-- المفتوح بلا عتبة وبعتبة
select count(*) filter (where total_minor-coalesce(a,0) > 0), sum(greatest(0,total_minor-coalesce(a,0))) from (select i.total_minor,(select sum(amount_minor) from payment_allocations pa where pa.invoice_id=i.id) a from invoices i) x;
select count(*) filter (where total_minor-coalesce(a,0) > 1), sum(case when total_minor-coalesce(a,0)>1 then total_minor-coalesce(a,0) else 0 end) from (select i.total_minor,(select sum(amount_minor) from payment_allocations pa where pa.invoice_id=i.id) a from invoices i) x;

-- «قبل ٣٠ يوماً»: كما في الشيفرة، والصحيح
select sum(greatest(0, i.total_minor - coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id=i.id),0))) from invoices i where i.invoice_date < now() - interval '30 days';
select sum(greatest(0, i.total_minor - coalesce((select sum(pa.amount_minor) from payment_allocations pa join payments p on p.id=pa.payment_id
       where pa.invoice_id=i.id and p.paid_at < now() - interval '30 days'),0))) from invoices i where i.invoice_date < now() - interval '30 days';

-- المشتريات والشهر الجاري بمثله
select period_month, count(*), sum(total_minor) from invoices group by 1 order by 1 desc;
select sum(total_minor) from invoices where period_month='2026-08' and extract(day from invoice_date) <= 14;

-- الضريبة
select tax_status, input_vat_status, count(*) n, sum(vat_minor) vat, count(*) filter (where vat_minor is null) vat_null, sum(total_minor) total from invoices group by 1,2;
select invoice_number, subtotal_minor, vat_minor, total_minor, subtotal_minor+vat_minor-total_minor diff from invoices where subtotal_minor is not null and vat_minor is not null and subtotal_minor+vat_minor <> total_minor;
select invoice_number, subtotal_minor, vat_minor, round(subtotal_minor*0.15) expected, tax_status from invoices where subtotal_minor>0 and vat_minor>0 and abs(vat_minor-round(subtotal_minor*0.15))>1;
select count(*) filter (where seller_vat is null), count(*) filter (where seller_vat is not null and not seller_vat ~ '^3\d{13}3$'), count(*) filter (where buyer_vat is not null and buyer_vat <> '310007971600003') from invoices;

-- البنك والدفعات
select direction, count(*), sum(amount_minor), count(*) filter (where category='UNKNOWN') from bank_transactions group by 1;
select category, count(*), sum(amount_minor) from bank_transactions where direction='DEBIT' group by 1 order by 3 desc;
select to_char(value_date,'YYYY-MM'), sum(amount_minor) filter (where direction='CREDIT'), sum(amount_minor) filter (where direction='DEBIT') from bank_transactions group by 1 order by 1;
select status, count(*), sum(amount_minor) from payments group by 1;
select count(*), sum(amount_minor - fee_minor - coalesce((select sum(amount_minor) from payment_allocations pa where pa.payment_id=p.id),0)) from payments p where status in ('UNAPPLIED','PARTIALLY_APPLIED') and not is_advance;

-- السلامة
select s.name_ar, p.paid_at::date, p.amount_minor, count(*), array_agg((select count(*) from bank_transactions bt where bt.matched_payment_id=p.id)) bank, array_agg(p.document_id is not null) doc
from payments p left join suppliers s on s.id=p.supplier_id where p.status not in ('REVERSED','VOID') group by 1,2,3 having count(*)>1;
select p.id, s.name_ar, p.paid_at::date, p.amount_minor, p.method, p.status, p.created_at from payments p left join suppliers s on s.id=p.supplier_id
where p.document_id is null and not exists (select 1 from bank_transactions bt where bt.matched_payment_id=p.id) and p.status not in ('REVERSED','VOID');
select count(*) from payment_allocations pa where not exists (select 1 from payments p where p.id=pa.payment_id) or not exists (select 1 from invoices i where i.id=pa.invoice_id);
select count(*) from payment_allocations pa join payments p on p.id=pa.payment_id where p.status in ('REVERSED','VOID');
select (select count(*) from (select invoice_id from payment_allocations pa join invoices i on i.id=pa.invoice_id group by invoice_id,i.total_minor having sum(pa.amount_minor) > i.total_minor) x),
       (select count(*) from (select payment_id from payment_allocations pa join payments p on p.id=pa.payment_id group by payment_id,p.amount_minor,p.fee_minor having sum(pa.amount_minor) > p.amount_minor-p.fee_minor) y);
select count(*) total, count(*) filter (where classification_source is null), count(*) filter (where bank_account_id is null),
       count(*) filter (where category='SUPPLIER' and direction='DEBIT' and matched_payment_id is null) from bank_transactions;
select amount_minor, value_date::date, category, matched_payment_id from bank_transactions where amount_minor in (63800,43700,15237);

-- الكشف في زمنه
select s.name_ar, st.period_end::date, st.closing_balance_minor,
  (select sum(total_minor) from invoices i where i.supplier_id=s.id and i.invoice_date::date <= st.period_end::date) billed_at,
  (select sum(amount_minor-fee_minor) from payments p where p.supplier_id=s.id and p.status not in ('REVERSED','VOID') and p.paid_at::date <= st.period_end::date) paid_at,
  (select sum(amount_minor-fee_minor) from payments p where p.supplier_id=s.id and p.status not in ('REVERSED','VOID') and p.paid_at::date > st.period_end::date) paid_after
from statements st join suppliers s on s.id=st.supplier_id
where st.closing_balance_minor is not null and st.period_end = (select max(period_end) from statements x where x.supplier_id=st.supplier_id and x.closing_balance_minor is not null);

-- المصروف
select period_month, category, count(*), sum(amount_minor) from expenses group by 1,2 order by 1,2;
select e.category, bt.category, count(*), sum(e.amount_minor) from expenses e join bank_transactions bt on bt.id=e.bank_transaction_id where e.category::text <> bt.category::text group by 1,2;
select bt.category, count(*), sum(bt.amount_minor) from bank_transactions bt where bt.direction='DEBIT' and bt.category not in ('SUPPLIER','PERSONAL','INTERNAL','UNKNOWN','POS_SETTLEMENT')
  and not exists (select 1 from expenses e where e.bank_transaction_id=bt.id) group by 1;

-- دفعة أغسطس والمتأخّر
select s.name_ar, i.invoice_number, i.total_minor - coalesce((select sum(amount_minor) from payment_allocations pa where pa.invoice_id=i.id),0) rem from invoices i join suppliers s on s.id=i.supplier_id
where i.period_month='2026-08' and i.total_minor - coalesce((select sum(amount_minor) from payment_allocations pa where pa.invoice_id=i.id),0) > 1;
select s.name_ar, i.invoice_number, i.total_minor - coalesce((select sum(amount_minor) from payment_allocations pa where pa.invoice_id=i.id),0) from invoices i left join suppliers s on s.id=i.supplier_id
where i.invoice_date < now() - interval '60 days' and i.total_minor - coalesce((select sum(amount_minor) from payment_allocations pa where pa.invoice_id=i.id),0) > 1;

-- التوقيت
select to_char(invoice_date at time zone 'UTC','HH24:MI'), count(*) from invoices group by 1;   -- وكذلك payments وbank_transactions وstatements وstatement_lines
select proname, provolatile from pg_proc where proname in ('payment_month','month_is_closed');
set timezone='Asia/Riyadh'; select payment_month(null,'2026-08-31 21:30:00+00'::timestamptz);
insert into bank_transactions (id, bank_import_id, bank_account_id, value_date, amount_minor, direction, category, description, lifecycle, classification_source)
select 'fin-tz-2330', bank_import_id, bank_account_id, '2026-08-31 23:30:00+03', 123456, 'DEBIT', 'UTILITY', 'FIN TZ TEST', 'POSTED', classification_source from bank_transactions where category='UTILITY' limit 1;
-- (ومثله 'fin-tz-0030' عند '2026-09-01 00:30:00+03' بمبلغ 654321) ثمّ:
delete from bank_transactions where id like 'fin-tz-%';

-- أثر الشهادة
select relname, n_tup_ins, n_tup_upd, n_tup_del from pg_stat_user_tables
where relname in ('suppliers','invoices','documents','payments','payment_allocations','audit_logs') order by 1;   -- قبل ops:certify وبعده

-- أثر القرار (FIN-101/102)
select at, action, entity_type, left(after::text,300) from audit_logs where at > '2026-09-13 20:00' order by at;
```
