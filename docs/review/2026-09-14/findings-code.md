# ملاحظات جودة الشيفرة (CODE): مراجعة ٢٠٢٦-٠٩-١٤ عند `375f0d7`

> لم تسمح الأداة بكتابة `findings-code.md`، فالتقرير الكامل هنا ليكتبه المنسّق. أمّا `docs/review/2026-09-14/coverage-code.md` فكُتب فعلاً: ٢٧٣ بنداً كلّها محكومٌ عليها. وفي الملفّ نفسه نسخةٌ أولى قصيرة من `findings-code.md` كتبتُها قبل رفض الأداة، وتُستبدَل بهذا.
> **الدور:** المهندس الرئيسي، ومعه مهندس الجودة. **القاعدة:** `tph_code`.
> **الأدوات** (خارج المستودع، في `$SP/code-probe/`):
> - `scan.cjs`: مسحٌ بمترجم TypeScript للصادرات والمستوردات والتحويلات.
> - `tx.cjs`: يمرّ على كلّ كتل `transaction` بالشجرة النحويّة.
> - `coverage.cjs`: يولّد ملفّ التغطية.
>
> **ما شُغّل فعلاً:**
> - `sbx tph_code npx tsx scripts/verify-invariants.ts`، والنتيجة **١٤ من ١٤ «رُفض بقيده»**.
> - استعلامات قراءة على `tph_code`.
> - اختبار انتظام الحارس على ستّة أشكال.
>
> **ما ثبت عند غيري وأُحيل إليه دون إعادة:** UI-001/002 · FIN-101..107 · SEC-101..110 · BTN-101..116 · OPS-101/102/104/107/109/111/112 · SCN-101..112.

## ٠. المؤشّرات الآليّة (مُثبَتة بالمسح)

| المؤشّر | ١٣ سبتمبر | اليوم | ملاحظة |
|---|---:|---:|---|
| `any` في `src` (عقدة `AnyKeyword`) | ٠ | **٠** | |
| `eslint-disable` · `@ts-ignore` · `@ts-expect-error` · `TODO`/`FIXME` | ٠ | **٠** | ولا في `scripts/` |
| تحويلات `as` (غير `as const`) | ١٠٩ | **١٧٦** | `as Error` ٢٢ · `as never` ١٧ · `as unknown as` ٣ · غيرها ١٣١ (CODE-109) |
| `!` غير الفارغ | — | ٩٤ | لم يُقيَّم فرداً فرداً |
| صادرٌ ميّت | ٢٩ | **٢٧** | CODE-105 |
| صادرٌ لا يستورده إلّا اختباره | ١٥٤ | ١٥٣ | |
| صادرٌ لا يستورده إلّا نصٌّ في `scripts/` | — | ٣٤ | أغلبه مقصود |
| ملفٌّ لا يستورده إلّا اختباره | — | **٣** | `bank/reversal.ts` · `extraction/benchmark.ts` · `unit-conversion.ts` |
| الاختبارات | ١٣٦٨ في ٩٢ | ١٨٠١ في ١٠٢ | يطابق CLAUDE.md |
| اختبارٌ يلمس قاعدة | ٠ | **٠** | CODE-102 |

---

## ١. حال ملاحظات المراجعة السابقة

### CODE-*

| المعرّف | الحال | الدليل |
|---|---|---|
| CODE-001 | **أُصلحت** | `scripts/verify-invariants.ts:42-55` يطابق `e.code` و`e.constraint`. شُغّل على `tph_code` فخرج ١٤ من ١٤ «رُفض بقيده». يبقى خارج CI (CODE-102) |
| CODE-002 | **أُصلحت** | `scripts/migrate.ts:30-43`: `--reapply` صريح وقفل `pg_try_advisory_lock`. و`UPDATE` بلا `WHERE` باقٍ في `016:31`، لكنّه لا يُعاد إلّا بطلبٍ صريح |
| CODE-003 | **قائمة** | `scripts/benchmark-providers.ts:98` فيه `judge()` خاصّ به، ولا يستورد `scoreProvider` |
| CODE-004 | **جزئيّة** | حُذف `/api/supplier-alias`، و`/api/supplier/route.ts:45` يستدعي `createSupplier`. لكنّ `learnAlias` (`supplier.service.ts:147`) و`loadActiveSuppliers` (`:23`) ميّتان، و`bank-rule/route.ts:112` يُدرج `supplierAliases` بيده (CODE-105) |
| CODE-005 | **أُصلحت** | لا `matchBankTransactions`، ولا `try-match.ts`، ولا الأمر في `package.json` |
| CODE-006 | **أُصلحت** | `allocation-sql.test.ts` صار `GUARDED = walk("src")` بجداول المخطّط. حدوده مذكورة في ملفّ التغطية |
| CODE-007 | **جزئيّة** | `insights.ts` و`parsers/types.ts` حُذفا، والميّت صار ٢٧. والقائمة في CLAUDE.md ينقصها مزوّدو الحَكَم وغيرهم (CODE-106) |
| CODE-008 | **جزئيّة** | `db:push` و`db:generate` و`db:studio` حُذفت، وأُضيف `docs-claims.test.ts`. لكنّ «خمسة عشر بنداً» تخالف `GATE_ORDER=16` (CODE-108) |
| CODE-009 | **جزئيّة** | `guard-write` في ٦ نصوص، و`try-archive.ts:54` يستعمل `findFolder` ما لم يُطلب الرفع. الباقي عند OPS-102 |
| CODE-010 | **ساءت** | الملفّات كبرت: `bank-import/route.ts` من ٨٧٨ إلى **٩١٢** · `uploader.tsx` من ٧٧٠ إلى **٧٩٩** · `drive-sync/route.ts` من ٦٢٦ إلى **٦٤٥** · `review-workspace.tsx` من ٦٢٤ إلى **٦٤٦** · `attention.ts` من ٥٢٥ إلى **٥٥٧**. وتحسّن `bank-import.tsx` من ٦١٠ إلى ٥٧١ (CODE-110) |
| CODE-011 | **أُصلحت جزئيّاً** | `formatRiyalsDisplay` في `money.ts:92` ومعها حارس. تبقى ٤ قسمات مضمَّنة، كلّها في القائمة المستثناة |
| CODE-012 | **أُصلحت** | `src/proxy.ts` موجود، ولا `middleware.ts` |
| CODE-013 | **قائمة** | صفر ملفّ `*.db.test.ts`، و`ci.yml` بلا postgres ولا `db:migrate` ولا `db:verify` (CODE-102) |

### GAP-*

| المعرّف | الحال | الدليل |
|---|---|---|
| GAP-001 | أُصلحت في الشيفرة | `archive/route.ts:30` يقرأ `extractionCache`. لكنّ الجدول **٠ صفوف** (CODE-111) |
| GAP-002 | أُصلحت | `pipeline.ts:115` يستثني `STATEMENT` |
| GAP-003 | أُصلحت | `verdict-policy.ts:132` يفحص `quality === null` |
| GAP-004 | أُصلحت | `statement-match.ts:51` فيه الحالة `APPROXIMATE` |
| GAP-005 | أُصلحت | `optimizer.ts:107` يحفظ `bestScore` |
| GAP-006 | أُصلحت | `parse.ts:269`: «بنك غير محدَّد» |
| GAP-007 | أُصلحت | `adapters.ts` صار ١٢١ سطراً، ولا `headersFor` فيه |
| GAP-008 | أُصلحت | `bank-account.service.ts:35` فيه `MIN_ACCOUNT_DIGITS` |
| GAP-009 | أُصلحت | `items.ts:39` يحوّل «٫» قبل الحذف |
| GAP-010 | أُصلحت | `extraction/index.ts:30` يشترط `EXTRACTION_ALLOW_ALT_PROVIDER` |
| GAP-011 | أُصلحت (مُتتبَّعة جزئيّاً) | `safe-xlsx.ts:36` فيه `MAX_CELL_CHARS`، ولم أقرأ نصّ الإعلان |
| GAP-012 | أُصلحت | `pdf-text.ts:49`: `MAX_TEXT_PAGES = 60` |
| GAP-013 | أُصلحت | `entities.ts:34`: `MIN_CONTAINED_ALIAS = 6` |
| GAP-014 | أُصلحت | `suppliers/[slug]/page.tsx:83` يعدّ `statement_months` |
| GAP-015 | أُصلحت | `validate-extraction.ts:64` فيه `isCalendarDate` |
| GAP-016 | أُصلحت | `extraction/schema.ts:51` يقرأ «95» على أنّها ٠٫٩٥ |
| GAP-017 | أُصلحت جزئيّاً | `archive/route.ts:113` يردّ ٤٠٩. أمّا الرفع قبل القيد فعند SEC |
| GAP-018 | أُصلحت | `bank-import/route.ts:176`: أسبوعٌ من كلّ طرف |

---

## ٢. ادّعاءات CLAUDE.md مقابل الشيفرة

| الادّعاء | الحكم | الدليل |
|---|---|---|
| «لا `db.` داخل معاملة»، ويحرسه `code-guards.test.ts` | **صحيح اليوم، والحارس يُخدَع** | `tx.cjs`: ٢٢ معاملة، ولا `db.` داخل أيٍّ منها، ولا استدعاء لدالّة تكتب بـ`db` بلا مقبض. لكنّ الحارس لا يرى إلّا صياغة واحدة (CODE-101) |
| «لا `renameFile` خارج `/api/drive-rename`» | صحيح | يستدعيها `drive-rename/route.ts:167` وحده |
| «لا `res.json()` خامّ في الشاشات» | صحيح | لا `.json()` في أيّ ملفّ `.tsx` إلّا في تعليق (`drive-sync.tsx:113`) |
| «كلّ `setCredentials` يمرّ بـ`openToken`» | صحيح (٤ من ٤) | `drive.ts:53,64,147` و`health/route.ts:125`. أمّا قراءة `refresh_token` مباشرةً في وضع التجربة فعند SEC |
| «كلّ مسارٍ جديد يستدعي الذكاء يُلفّ بـ`withDeadline`» | **جزئيّ** | الملفوف أربعة: `analyze` و`bank-import` و`drive-sync` و`statement-reconcile`. و`ai-analysis` خارجها (OPS-101) |
| «كلّ عددٍ في الواجهة يمرّ بـ`arabic.ts`» | **لا** | ٢٥ قالباً من نوع `${n} اسم` في ملفّات `.ts` (CODE-107) |
| «الجدول يصير بطاقات على الجوّال» | صحيح | `<table` لا يرد إلّا في `ui.tsx` |
| «التوأم يُسأل في `createPayment` نفسها» | صحيح للدالّة، ومسارٌ يتجاوزها | `payment.service.ts:146,188`. لكنّ `drive-sync/route.ts:336` يُدرج الدفعة بيده (CODE-103) |
| «`assertMonthsOpen` في `createPayment` و`allocate` و`createInvoice`» | صحيح للخدمات، ومسارٌ يتجاوزها | `payment.service.ts:135,195,360` و`invoice.service.ts:35`. و`drive-sync/route.ts:290,495,336` يكتب بلا الحارس، ومؤثِّرات ٠٢٨ خلفه (CODE-103) |
| «المصدر `supplier-balance.service.ts` لكلّ شاشة تقول «عليك»» | **لا** | ستّ شاشات تستورده، وتخالفه أربعة مواضع: `changes-facts.ts` (UI-001)، و`attention-facts.ts:74-90` («مستحقّ عليك»)، و`bank/page.tsx:91-98`، و`month-close-facts.ts:30-35` (CODE-104) |
| «`detectAnomalies` موصولةٌ ببند» | صحيح | `attention-facts.ts:317` |
| «`notConnected` يرمي `NotConnectedError`» | صحيح | `sales/connector.ts:93,96` |
| «`TOTAL_ROUNDING_TOLERANCE_MINOR` هي نفسها في القاعدة» | صحيح بالقيمة | `money.ts:19` تساوي ١٠٠، و`007:85` يكتب `<= 100` حرفياً (رقمٌ منسوخ لا مشتقّ) |
| «`db:verify` يثبت أنّ القيود ترفض» | صحيح | شُغّل فخرج ١٤ من ١٤ |
| «٤١ جدولاً» · «١٨٠١ اختباراً في ١٠٢ ملفاً» · ٣١ هجرة | صحيح | `pg_stat_user_tables` وسجلّ الاختبار و`schema_migrations` |
| «`ops:gate` خمسة عشر بنداً» | **لا** | `GATE_ORDER` فيه ١٦ بنداً (CODE-108) |
| «`ops:certify` أحدَ عشر سيناريو» | صحيح | ١٠ بـ`scenario()` وواحد خارجها |
| «`branches`: `branchId` لا يرد في استعلام» | صحيح | و`bank_accounts.branch_id` صفر من ١ |
| «`bank_accounts` ممتلئ في كلّ حركة» | صحيح للحركات | ١٤٤٠ من ١٤٤٠. لكنّ `bank_imports.bank_account_id` **صفر من ٢** |
| «`reconciliation_periods` يكتبه الاستيراد ونموذج الإقفال» | **الشيفرة نعم، والبيانات لا** | يكتبه `bank-import/route.ts:837` و`month-close/route.ts:93`، والجدول **٠ صفوف** (CODE-111) |
| «`credit-notes` موصولة نصفَ وصل» · «`reversal` و`unit-conversion` و`benchmark` لا تصل إليها شاشة» | صحيح | المسح: الثلاثة لا يستوردها إلّا اختبارها |
| «حُذف `insights.ts` و`parsers/types.ts` و`matchBankTransactions` و`/api/supplier-alias`» | صحيح | لا ملفّ ولا رمز |
| «`as` تُسكت المترجم» (حادثة `TxCategory↔TxKind`) | صحيح في موضع الحادثة | لا ترجمة بينهما بـ`as`. ويبقى `as TxCategory` في ٩ مواضع (CODE-109) |
| «`documents.text_source` يُملأ» (CHANGELOG) | **الشيفرة نعم، والبيانات لا** | ٧ من ١٧٥ فقط (CODE-111) |

---

## ٣. «مبنيّ ولا يصل إليه أحد»: واحدةً واحدة

| الوحدة | من يستوردها (غير الاختبار) | هل في البيانات ما تحتاجه؟ | الحكم |
|---|---|---|---|
| `credit-notes.ts` | `supplier-account.ts:1` وحده، ولا يُمرَّر لها `credits` | لا إشعار دائن مقيَّد | نصف وصل |
| `bank/reversal.ts` | لا أحد | دفعةٌ واحدة بحال `REVERSED` | لا يصل |
| `unit-conversion.ts` | لا أحد | ٤ أصناف مربوطة من ١٠٩ | لا يصل |
| `extraction/benchmark.ts` | لا أحد، والنصّ يقيس بـ`judge()` | — | لا يصل، ومعه محرّك موازٍ (CODE-003) |
| `branches` | لا شيفرة | صفّ واحد، ولا حساب مربوط به | مخطّط بلا شيفرة |
| **غير مسرود:** `adjudicator-provider.ts` (`geminiProvider` `claudeProvider` `deepseekProvider` `qwenProvider` `adjudicatorNames`) | اختبارها وحده | `adjudications` **٠** | CODE-106 |
| **غير مسرود:** `statement-vision.service.ts` (`claudeVision` `geminiVision`) | يُستعملان داخل الملفّ فقط | — | CODE-106 |
| **غير مسرود:** `balance-equation.ts` (`reconcileAccount` `describeReconciliation`) | اختبارها وحده | `reconciliation_periods` ٠ | CODE-106 |
| **غير مسرود:** `entity-candidates.ts` (`proposeEntities` `beneficiaryGuess`) · `fees.ts` (`splitGroupFee`) · `lifecycle.ts` (`lifecycleRank`) · `decision.ts` (`tally` `strengthLabel`) | اختبارها وحده | — | CODE-106 |
| **غير مسرود:** `extraction_cache` | يكتبه `/api/analyze` ويقرؤه `/api/archive` | **٠** | موصول، ولم يمرّ عليه صفّ (CODE-111) |
| **غير مسرود:** `month_closes` · `recurring_expenses` | شاشتا الإقفال والمصروفات المتكرّرة | ٠ · ٠ | لم يُستعملا بعد |

---

## ٤. خريطة الاختبارات للمسارات الماليّة الحرجة

«قاعدة» تعني اختباراً في `npm test` يلمس Postgres. و«`certify`» سيناريو في `ops:certify`: معاملة تُلغى، خارج CI، تُشغَّل باليد.

| المسار | الشيفرة | اختبار نقيّ | يلمس قاعدة | `certify` | الاختبار الناقص بالضبط |
|---|---|---|---|---|---|
| إنشاء دفعة والتوأم | `payment.service.ts`: `createPayment` و`findPaymentTwin` و`recordBankPayment` | لا (`payment-state.test.ts` للحالات وحدها) | **لا** | ٧ · ١٠ · ١١ | `src/services/payment.service.db.test.ts`: «توأمٌ بلا `acknowledgeTwin` → `PaymentTwinError`»، و«`recordBankPayment` يتبنّى دفعةً مخصَّصة بلا حركة ولا يُنشئ ثانية» |
| التخصيص | `allocate` ومؤثِّر ٠٢٦ | `allocation.test.ts` (`planAllocations` فقط) | **لا** (`db:verify` إدراجٌ واحد) | ٢ · ٣ | «طلبان متزامنان على فاتورة ١٠٠٠ بدفعتين ٧٠٠ → واحدٌ يُرفض بـ`payment_allocations_bounds`» |
| تأكيد مطابقة، فردياً وجماعياً | `match-confirm` و`match-confirm-bulk` و`claimBankTransaction` | `reconcile.service.test.ts` (المحرّك) | **لا** | لا | `src/app/api/match-confirm/route.db.test.ts`: «ضغطتان متوازيتان → دفعة واحدة، والثانية ٤٠٩». وللجماعيّ: «مجموعة من ٣ حركات والثالثة تفشل → صفر دفعات» |
| التراجع | `match-undo` ثمّ `reversePayment` | `payment-state.test.ts` | **لا** | ٥ | «بعد التراجع: الدفعة `REVERSED`، والفاتورة مفتوحة، و`matched_payment_id` فارغ، وقيد `MATCH_UNDONE` موجود» |
| استيراد كشف | `bank-import/route.ts` | `sync.test.ts` و`parse.test.ts` و`canonical.test.ts` | **لا** | لا (`certify-real-bank` يقرأ فقط) | «الملفّ نفسه مرّتين → الثاني `newRows = 0`» |
| أرشفة | `archive/route.ts` | `confirm.test.ts` و`pipeline.test.ts` | **لا** | لا | «أرشفة بلا صفّ في `extraction_cache` → رفض»، و«إيصالٌ له توأم بلا مستند → يُعلَّق عليه ولا تُنشأ دفعة ثانية» |
| إقفال شهر | `month-close/route.ts` و`month-guard.ts` ومؤثِّرات ٠٢٨ | `month-close.test.ts` (الموانع) | **لا** (`db:verify` للمؤثِّرات وحدها) | لا | «`createInvoice` في شهر `CLOSED` → `MonthClosedError` من الخدمة قبل المؤثِّر» |
| سداد من حساب المالك | `supplier-credit.service.ts`: `markPaidByOwner` | **لا شيء** | **لا** | لا | «فاتورة مايو مخصَّصة من حوالات يوليو → بعد `markPaidByOwner` تنتقل الحوالات إلى يوليو، ومجموع المخصَّص ثابت» |
| خصم رصيد المورّد | `applySupplierCredit` | `supplier-balances.test.ts` (الدالّة لا الاستعلام) | **لا** | لا | «حوالة ثمّ فاتورة بعد ٣ أيّام → تُخصم آلياً، وبعد ٨ أيّام → لا» |
| وسم السداد | `mark-paid/route.ts` | لا | **لا** | لا | «فاتورتان بأعيانهما → دفعتان `APPLIED`، وإعادة الطلب → `marked: 0`» |
| مزامنة الدرايف | `drive-sync/route.ts` | `drive-sync.test.ts` (المشي وحده) | **لا** | لا | «إيصالٌ في شهرٍ مقفل → يُتخطّى برسالة من الخدمة، لا بخطأ ٥٠٠ من المؤثِّر» |

**هل يوجد اختبار يختبر المحاكاة بدل الشيفرة؟**
- لا يوجد اختبار يحاكي الوحدة المختبَرة نفسها.
- `adjudicator.service.test.ts` يحقن مزوّداً بـ`vi.fn` ويختبر السياسة، وهذا مشروع.
- أمّا `adjudicator-provider.test.ts` فيختبر ثلاثة مزوّدين لا يستدعيهم المنتج (CODE-106): أخضرُ على شيفرة لا تعمل.

**أيّ الحرّاس النصّيّين يُخدَع؟**
- `code-guards.test.ts` (CODE-101).
- `ui-terms.test.ts` (CODE-107).
- `docs-claims.test.ts` لا يفحص الأعداد (CODE-108).
- `allocation-sql.test.ts` نافذته ٢٠٠ حرف قبل `where` و١٢٠ بعدها.

---

## ٥. الصادرات الميّتة (٢٧)

`ui-client.tsx:131 StickyActions` · `ui-client.tsx:145 Progress` · `ui.tsx:243 ErrorState` · `ai/deepseek.ts:150 contentHash` · `ai/supplier-analysis.ts:38 FINDING_LABEL, SEVERITY_LABEL` · `analytics.ts:49 AGE_LABEL` · `arabic.ts:205 TRANSFER` · `bank/adjudicate.ts:58 HIGH_VALUE_MINOR` · `bank/classification.ts:53 LAYER_SOURCE` · `bank/lifecycle.ts:33 LIFECYCLE_LABEL` · `bank/match.ts:48 BankMatch` · `bank/rules.ts:39 NON_SUPPLIER_CATEGORIES` · `bank/taxonomy.ts:54,57,60,82,97 REVENUE_KINDS, POS_COST_KINDS, NON_OPERATIONAL, OUTCOME_LABEL, DISPOSITION_LABEL` · `bank/vision-statement.ts:212 VISION_PROMPT_VERSION` · `extraction/schemas-by-kind.ts:104 utilityExtractionSchema` · `extraction/versions.ts:51 provenance` · `payment-state.ts:42 OPEN_STATUSES` · `expense.service.ts:275 expensesOfMonth` · `rate-limit.service.ts:63 currentCount` · `supplier-credit.service.ts:307 invoiceSupplier` · `supplier.service.ts:23 loadActiveSuppliers` · `supplier.service.ts:147 learnAlias`.

- **الجديد منذ ١٣ سبتمبر:** `invoiceSupplier` · `TRANSFER` · `FINDING_LABEL` · `SEVERITY_LABEL` · `BankMatch`.
- **القوائم الكاملة** (١٥٣ صادراً لا يستورده إلّا اختباره، و٣٤ لا يستورده إلّا نصّ) في `$SP/code-probe/scan.txt`.

---

## ٦. المحرّكات المكرّرة

| العمل | المرجع | النسخ الأخرى | الحكم |
|---|---|---|---|
| «كم أدين» | `supplier-balance.service.ts` (المفتوح ناقص الرصيد، بتسامح هللة) | `changes-facts.ts:60-71` (UI-001) · `attention-facts.ts:37-44,74-90` · `bank/page.tsx:91-98` · `month-close-facts.ts:30-35` · `mark-paid/route.ts:153` (`> 1`) | CODE-104 |
| إنشاء الفاتورة | `invoice.service.ts`: `createInvoice` | `drive-sync/route.ts:290,495` | CODE-103 |
| إنشاء الدفعة | `payment.service.ts`: `createPayment` | `drive-sync/route.ts:336` | CODE-103 |
| التخصيص | `payment.service.ts`: `allocate` | `mark-paid/route.ts:178` | CODE-103 |
| الاسم البديل | `supplier.service.ts`: `learnAlias` (ميّت) | `bank-rule/route.ts:112` | CODE-105 |
| مقياس النماذج | `extraction/benchmark.ts` | `scripts/benchmark-providers.ts:98` | CODE-003 قائمة |
| العمل الباقي | `pending.ts`: `countPendingWork` | لا نسخة (مستدعٍ واحد في `page-shell.tsx:46`) | سليم |
| قراءة الردّ في المتصفّح | `http-client.ts` | لا نسخة | سليم |
| قائمة المفتوح للتخصيص | `supplier-credit.service.ts:80-90` | — | مشروع: يسأل عن الفواتير، لا عن «عليك» |

---

## ٧. الملاحظات الجديدة

### CODE-101: حارس «لا `db.` داخل معاملة» يرى صياغةً واحدة، ومعاملةٌ قائمة خارج نظره
- **الدور:** مهندس الجودة.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة، بتشغيل الانتظام نفسه وبالمسح النحويّ.
- **الموضع:**
  - `src/lib/code-guards.test.ts`: الدالّة `transactionBodies` والانتظام `/\.transaction\(\s*async\s*\(\s*[a-zA-Z_]+\s*\)\s*=>\s*\{/g`.
  - معاملة لا يراها الحارس: `src/app/api/mark-paid/route.ts:85`، أي `db.transaction((tx) => markPaidByOwner(tx, invoiceId))`.
- **إعادة الإنتاج:** طُبّق الانتظام على ستّة أشكال:
  - يُمسَك شكلٌ واحد: `async (tx) => { await db.insert(a) }`.
  - لا يُمسَك أيٌّ من الخمسة الباقية: `async (tx: Tx) => {…}` · `(tx) => { return db.insert(a) }` · `async function (tx) {…}` · `async tx => {…}` · `async (tx) => write(tx, db)`.
  - مسح الشجرة (`tx.cjs`): في `src` ٢٢ معاملة، يرى الحارس منها ٢١.
  - ولا يرى الحارس الاستدعاء غير المباشر: دالّة تكتب بـ`db` وتُستدعى من داخل المعاملة.
  - **المتوقَّع:** يُمسك الحادثة التي كُتب لأجلها بأيّ صياغة. **الواقع:** يُمسك صياغةً واحدة، ولا مخالفة اليوم، فالسلامة بالمصادفة.
- **الأثر:** على الثقة. الحادثة الأصليّة (خمسة أيّام لم يُحفَظ فيها تعريف جهة) تعود بتغيير توقيعٍ واحد دون أن يحمرّ اختبار.
- **الإصلاح (ساعتان):**
  - في `code-guards.test.ts` يُستبدَل الانتظام بمرورٍ على شجرة TypeScript: كلّ `CallExpression` اسمها `transaction` وحجّتها دالّة (سهمٌ أو `function`، بجسمٍ أو تعبير، بمعاملٍ منمَّط أو لا)، فلا يُقبَل داخلها `PropertyAccessExpression` جذره `db`.
  - يُوسَّع النطاق من `api/` و`services/` إلى `src` كلّه.
  - تُضاف حالات: «يُمسك `async (tx: Tx) =>`» · «يُمسك `(tx) => db.insert()`» · «يُمسك `async function (tx)`».
  - **مخاطرة الإصلاح:** لا شيء على المنتج.
- **يخالف قراراً؟** رأس الملفّ نفسه: «والحارس يُثبت نفسه أيضاً… وإلّا كان طمأنينةً بلا سند».

### CODE-102: لا مسار ماليّ حرج له اختبارٌ يلمس قاعدة، و`db:verify` خارج CI (امتداد CODE-013)
- **الدور:** مهندس الجودة.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة.
- **الموضع:**
  - `vitest.config.mts` يشمل `src/**/*.test.ts` فقط.
  - `.github/workflows/ci.yml` بلا خدمة postgres.
  - خدمات بلا أيّ اختبار: `payment.service.ts` · `supplier-credit.service.ts` · `month-guard.ts` · `supplier-balance.service.ts` · `invoice.service.ts`.
- **إعادة الإنتاج:** لا ملفّ اختبار يستورد `@/db` أو `pg`. والمصفوفة الكاملة في §٤.
- **الأثر:** عطوبٌ ثبتت في هذه الجولة كلّها في مساراتٍ لا يلمسها اختبار: FIN-101 وBTN-101 وSEC-110 وOPS-104. والاختبارات خضراء: ١٨٠١ من ١٨٠١.
- **الإصلاح (يومان):**
  1. في `ci.yml`: خدمة `postgres:16`، ثمّ `npm run db:migrate`، ثمّ `npm run db:verify`.
  2. ملفّ `vitest.db.config.mts` لملفّات `src/**/*.db.test.ts` وأمر `npm run test:db`، وكلّ اختبار داخل معاملة تُلغى على نمط `ops:certify`.
  3. البدء بالحالات الإحدى عشرة في §٤، وأوّلها `payment.service.db.test.ts` و`match-confirm/route.db.test.ts`.
  - **مخاطرة الإصلاح:** زمن CI يصير دقيقتين، وقد تكشف الاختبارات عطوباً، وهذا هو المطلوب.
- **يخالف قراراً؟** «الاختبارات النقيّة لا تُثبت أنّ النظام يعمل… الأخضر يقول إنّ القطع سليمة، لا إنّها موصولة».

### CODE-103: المزامنة ووسم السداد يكتبان المال بأيديهما لا بالخدمات
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2.
- **الثقة:** مُتتبَّعة.
- **الموضع:**
  - `drive-sync/route.ts:290` و`:495`: `tx.insert(invoices)` بدل `createInvoice`، فلا `assertMonthsOpen`.
  - `drive-sync/route.ts:329-345`: يسأل `findPaymentTwin` بنفسه ثمّ `tx.insert(payments)` بدل `createPayment`.
  - `mark-paid/route.ts:177-182`: `assertMonthsOpen` ثمّ `tx.insert(paymentAllocations)` بدل `allocate`.
- **إعادة الإنتاج (لم يُشغَّل):** شهر ٢٠٢٦-٠٨ مقفل، ثمّ مزامنة إيصالٍ بتاريخ أغسطس.
  - **المتوقَّع:** `MonthClosedError` برسالةٍ عربية من الخدمة.
  - **الواقع:** يصل الطلب إلى مؤثِّر ٠٢٨ فيُرمى خطأ قاعدة داخل حلقة المزامنة.
- **الأثر:**
  - لا مال خاطئ اليوم، فمؤثِّرات ٠٢٨ و٠٢٦ تحمي.
  - لكنّ «التوأم يُسأل في `createPayment` نفسها» صحيحٌ هنا لأنّ المسار نسخ السؤال بيده. فأوّل تغييرٍ في سياسة التوأم لن يبلغ المزامنة.
- **الإصلاح (نصف يوم):**
  - في `drive-sync/route.ts`: `createInvoice(tx, …)` في الموضعين، و`createPayment(tx, {..., documentId})` بعد حذف فحص التوأم المنسوخ، مع التقاط `PaymentTwinError` لتعليق المستند على التوأم.
  - في `mark-paid/route.ts:177-182`: `allocate(tx, payId, [{ invoiceId, amountMinor: remaining }])`.
  - اختبار `src/app/api/drive-sync/route.db.test.ts`: «إيصالٌ في شهرٍ مقفل → يُتخطّى برسالة، لا ٥٠٠».
  - **مخاطرة الإصلاح:** `createPayment` يرمي حيث كان المسار يعلّق، فيجب ترجمة الخطأ.
- **يخالف قراراً؟** «التوأم يُسأل في `createPayment` نفسها لا في المستدعين»، و`ARCHITECTURE.md` §٥: «الواجهات رقيقة».

### CODE-104: ثلاثة محرّكاتٍ أخرى لـ«المستحقّ» غير `changes-facts` (UI-001)
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة بـSQL لـ`bank/page.tsx`، ومُتتبَّعة للباقي.
- **الموضع:**
  - `attention-facts.ts:37-44` و`:74-90`: بند «ديون أقدم من ٦٠ يوماً» بنوع الأثر `OWED`، أي «مستحقّ عليك» (`attention.ts:352-365`). يحسب بالفاتورة، فلا يُنقص رصيد المورّد، ولا تسامح فيه (`greatest(0,…)`).
  - `bank/page.tsx:91-98`: «ما على كلّ مورّد الآن» في معاينة «سيُخصَّص · ويبقى على حسابه» (`reconcile-queue.tsx:321-335`). بلا تسامح الهللة.
  - `month-close-facts.ts:30-35`: شرطٌ ثالث مختلف.
- **إعادة الإنتاج (SQL على `tph_code`):** قورن حساب `bank/page.tsx` بمنطق `loadSupplierBalances`.
  - خمسة مورّدين متطابقون.
  - **سرد كو: ٠٫٠٢ مقابل ٠**، فتقول المعاينة «سيُخصَّص ٠٫٠٢» عن مورّدٍ لا يُدان بشيء.
  - رصيد المورّدين صفرٌ لكلّهم اليوم، فالفرق الكبير كامن حتّى أوّل حوالة مقدَّمة.
- **الأثر:** على الثقة اليوم بهللتين. وعند أوّل رصيدٍ لنا عند مورّد، يتكرّر خطأ «عليك ١٨ ألفاً» في «يحتاج انتباهك».
- **الإصلاح (نصف يوم):**
  - `supplier-balance.service.ts`: دالّة `loadOverdueBalances(executor, olderThanDays)` تُعيد «المفتوح ناقص الرصيد»، وتستدعيها `attention-facts.ts:37-44,74-90`.
  - `bank/page.tsx:91-98`: يُستبدَل الاستعلام بـ`loadSupplierBalances()`.
  - `month-close-facts.ts`: يستعمل `SETTLED_TOLERANCE_MINOR`.
  - حارس نصّيّ `src/lib/owed-single-source.test.ts`: لا `i.total_minor - coalesce` خارج `supplier-balance.service.ts` و`supplier-credit.service.ts` والواجهات الكاتبة.
  - **مخاطرة الإصلاح:** رقم «يحتاج انتباهك» يتغيّر، فيُعلَن التغيير.
- **يخالف قراراً؟** «**«كم أدين؟» بالمورّد لا بالفاتورة**… المصدر `supplier-balance.service.ts` لكلّ شاشة تقول «عليك»».

### CODE-105: ٢٧ صادراً ميّتاً، ومنها بقيّة «الاسم البديل يُكتب مرّتين»
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P3.
- **الثقة:** مُثبَتة بالمسح.
- **الموضع:** القائمة في §٥. ومعها `bank-rule/route.ts:112` يُدرج `supplierAliases` بيده، و`learnAlias` (بحدّ `MIN_ALIAS_LENGTH`) ميّت.
- **إعادة الإنتاج:** `node $SP/code-probe/scan.cjs $SP/code-probe`، القسم `## dead (27)`.
- **الأثر:** سطحٌ يُقرأ ولا يعمل، واسمٌ بديل يُكتب بلا حدّ الطول الأدنى.
- **الإصلاح (ساعتان):**
  - حذف الصادرات الخمسة والعشرين الباقية.
  - `bank-rule/route.ts:105-115` يستدعي `learnAlias`.
  - `scripts/dead-exports.ts` (نقل `scan.cjs`) يُضاف إلى CI ويفشل عند صادرٍ ميّتٍ جديد، مع استثناء مداخل Next.
- **يخالف قراراً؟** «وما كان ميّتاً بلا شاشةٍ ولا مستدعٍ **حُذف بدل أن يُسرَد**».

### CODE-106: قائمة «مبنيّ ولا يصل» ينقصها أحد عشر رمزاً، أبرزها أربعة مزوّدين للحَكَم مختبَرون ولا يُستدعَون
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة بالمسح وبـSQL.
- **الموضع:**
  - `adjudicator-provider.ts:62,101,197,240,268`: `geminiProvider` و`claudeProvider` و`deepseekProvider` و`qwenProvider` و`adjudicatorNames`، لا يستوردها إلّا اختبارها.
  - `statement-vision.service.ts:72,116`: `claudeVision` و`geminiVision`، لا يستدعيهما شيء خارج الملفّ.
  - اختبارها وحده: `balance-equation.ts:144,188` · `entity-candidates.ts:53,148` · `fees.ts:65` · `lifecycle.ts:106` · `decision.ts:91,106`.
- **إعادة الإنتاج:** قسم `testOnly` في `scan.txt`. وفي القاعدة: `adjudications` ٠ صفوف، و`reconciliation_periods` ٠.
- **الأثر:** ١٣ اختباراً في `adjudicator-provider.test.ts` تُخضِّر شيفرةً لا تعمل. ومن يقرأ CLAUDE.md يظنّ الحَكَم متعدّد المزوّدين.
- **الإصلاح (ساعة):**
  - حذف `geminiProvider` و`claudeProvider` و`qwenProvider` واختباراتها، وحذف `claudeVision` و`geminiVision`.
  - إضافة الرموز الباقية إلى جدول CLAUDE.md.
  - حالة في `docs-claims.test.ts`: «كلّ ملفٍّ لا يستورده إلّا اختباره مسرودٌ في القسم».
  - **مخاطرة الإصلاح:** إن كان الاحتياط مقصوداً فالقرار لأحمد، مع أنّ CLAUDE.md يقول «لا احتياط».
- **يخالف قراراً؟** «قبل أن تُضيف وحدةً جديدة: أوصِل واحدةً من هذه»، و«الذكاء: DeepSeek وحده».

### CODE-107: ٢٥ عدداً في ملفّات `.ts` لا تمرّ بـ`arabic.ts`، والحارس يقرأ `.tsx` وحده
- **الدور:** مهندس الجودة، ومصمّم الواجهة.
- **الدرجة:** P3.
- **الثقة:** مُتتبَّعة.
- **الموضع:**
  - `attention.ts:211` («`${f.bankGapDays} يوماً بلا كشف بنكيّ`») و`:303` («`${f.unbackedPaymentCount} دفعة خرجت…`»).
  - `attention-facts.ts:90,187` · `month-close.ts:220` · `balance-equation.ts` · `candidates.ts` · `coverage.ts` · `supplier-profile.ts` · `invoice-filter.ts`.
  - `ui-terms.test.ts` يمشي `.tsx` وحده، وبثمانية أسماء فقط.
- **إعادة الإنتاج:**
  - `unbackedPaymentCount = 3` يُنتج «3 دفعة خرجت»، والصواب «٣ دفعات».
  - `bankGapDays = 1` يُنتج «1 يوماً».
- **الأثر:** النصّ في «يحتاج انتباهك» وفي الإقفال، وهما أكثر ما يقرؤه أحمد.
- **الإصلاح (ساعتان):**
  - كلّ موضعٍ عبر `countNoun(n, PAYMENT|DAY|…)`.
  - `ui-terms.test.ts` يمشي `.ts` و`.tsx` معاً، و`RAW_COUNT` يُوسَّع إلى: فاتورة · فواتير · حركة · حركات · دفعة · دفعات · مورّد · مستند · يوماً · أيّام.
  - حالة جديدة: «يُمسك `${n} دفعة` في `.ts`».
- **يخالف قراراً؟** «كلُّ عددٍ في الواجهة يمرّ بها».

### CODE-108: الوثيقة تخالف الشيفرة في عدد بنود البوّابة، و`docs-claims.test.ts` لا يفحص الأعداد
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P3.
- **الثقة:** مُثبَتة.
- **الموضع:**
  - `CLAUDE.md`: «`npm run ops:gate` خمسة عشر بنداً»، و`GATE_ORDER` في `production-gate.ts` فيه **١٦**.
  - «`reconciliation_periods` يكتبه الاستيراد» والجدول ٠ صفوف.
  - `docs-claims.test.ts` يفحص الهجرات والأوامر والملفّات وحدها.
- **إعادة الإنتاج:** عدّ `GATE_ORDER` يُرجع ١٦.
- **الأثر:** روايتان لعددٍ واحد تُسقطان الثقة بالبقيّة.
- **الإصلاح (ساعة):**
  - تصحيح النصّ إلى «ستّة عشر بنداً».
  - حالات في `docs-claims.test.ts`: «بنود البوّابة = `GATE_ORDER.length`» · «الجداول = عدد `pgTable`» · «السيناريوهات = عدد `scenario(` + ١».
- **يخالف قراراً؟** «عدد الهجرات يُقرأ من المجلّد لا يُكتَب رقماً».

### CODE-109: ١٧٦ تحويلاً بـ`as` بعد أن كانت ١٠٩
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P3.
- **الثقة:** مُتتبَّعة، وقُيِّم كلّ صنف.
- **الموضع والتقييم:**
  - **أجسام الطلبات:** `as Body` ×١٤، و`as ArchiveBody` و`as typeof body` ×٣، في ١٧ واجهة بلا zod. هذه عند SEC.
  - **اتّجاه الحركة:** `as "DEBIT" | "CREDIT"` ×١٠، منها `bank-import/route.ts:184,194` و`bank/page.tsx:263,273,363`.
  - **التصنيف:** `as TxCategory` ×٩، منها `bank-import/route.ts:433` و`money/statement/page.tsx:48,81,98` و`settings/page.tsx:55`. مصدرها `db.execute` خامّ، ويسكت المترجم إن تغيّر التعداد.
  - **أعمدة JSON:** `as never` ×١٧، منها `document.service.ts:77,82,85` و`audit.ts:71,76` و`drive-sync/route.ts:278,470,480,483` و`month-close/route.ts:174,180`. تُسكت كلّ فحص نوع.
  - **مبرَّر اليوم:** `counterparty.service.ts:142` (`as EvidenceKind`) و`:315` (`as IdentityKind`). التعداد في القاعدة ٧ قيم ويساوي `EvidenceKind`، و`IdentityKind` هو التعداد ناقص `REFERENCE` المستثنى في `:313`. كان مشتبَهاً به في ١٣ سبتمبر، وحُسم.
  - **مبرَّر:** `as unknown as` ×٣ (`auth.ts:98` و`safe-xlsx.ts:47,55`)، و`as Error` ×٢٢.
- **الأثر:** على الأمان النوعيّ، ولا خطأ قائم.
- **الإصلاح (يوم):**
  - أعمدة `jsonb` في `schema.ts` بـ`.$type<…>()`، فيسقط `as never`.
  - أنواع `db.execute<Row>` تُشتقّ من `$inferSelect` بدل `as TxCategory`.
  - حارس: «لا `as never` خارج `schema.ts`».
- **يخالف قراراً؟** «`as` تُسكت المترجم ولا تُصلح اختلافاً».

### CODE-110: الملفّات الطويلة كبرت بعد الإصلاح (امتداد CODE-010)
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة بـ`wc -l`، ومُتتبَّعة للخلط.
- **الموضع:**

| الملفّ | أسطر | ماذا يخلط | أين يُقسَم |
|---|---:|---|---|
| `db/schema.ts` | ١٣٠٣ | مخطّطٌ وحده | لا حاجة |
| `api/bank-import/route.ts` | ٩١٢ | القراءة والمزامنة والتحكيم والكتابة والأرصدة والتدقيق | `services/bank-import.service.ts` بثلاث دوالّ: `previewImport()`، و`applyImport(tx)` (من `:624`)، و`recordMonthBalances()` (`:835-850`، وهي اليوم بـ`db` بعد المعاملة) |
| `components/uploader.tsx` | ٧٩٩ | القائمة والقراءة والمراجعة والأرشفة | `upload-queue.tsx` و`review-form.tsx` و`useArchive()` |
| `api/match-confirm/route.ts` | ٦٦٥ | خمسة أفعال في معالجٍ واحد | `services/match.service.ts` بدالّة لكلّ فعل (الفرعان الميّتان عند BTN-101) |
| `components/review-workspace.tsx` | ٦٤٦ | ثلاثة أبواب بألواحها | ملفّ لكلّ باب |
| `api/drive-sync/route.ts` | ٦٤٥ | المشي والقراءة وكتابة المال بيده (CODE-103) | `services/drive-sync.service.ts` |
| `app/bank/page.tsx` | ٥٣٠ | استعلامات خامّ ومحرّك مستحقّ (CODE-104) | `lib/bank-page-facts.ts` |
| `services/supplier-analysis.service.ts` | ٤٥٥ | الوقائع والنداء والتخزين والقرار | نقل `gatherSupplierFacts` إلى `lib/` |
| `components/bank-import.tsx` (٥٧١) · `lib/attention.ts` (٥٥٧) · عشرة ملفّات بين ٤٠٢ و٤٤٩ سطراً | — | متجانسة في الغالب | لا حاجة عاجلة |

- **الأثر:** مسارا الاستيراد والمزامنة هما موضع أغلب عطوب هذه الجولة (OPS-104 وOPS-111 وCODE-103)، وكلاهما بلا اختبار قاعدة.
- **الإصلاح (أسبوع، بعد CODE-102 لا قبله):** التقسيم بالترتيب في الجدول، وحارس «لا `route.ts` فوق ٤٠٠ سطر» مع استثناءٍ مسمّى مؤقّت.
- **يخالف قراراً؟** `ARCHITECTURE.md` §٥: «الواجهات تستقبل الطلب وتُترجم أخطاء الخدمات، لا أكثر».

### CODE-111: الشيفرة تسبق البيانات مرّةً أخرى: خمس طبقات بُنيت أو أُصلحت ولم يمرّ عليها صفّ
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة بـSQL على `tph_code`.
- **الموضع والواقع:**
  - `documents.text_source` (الهجرة ٠٣١): **٧ من ١٧٥**.
  - `extraction_cache` (الهجرة ٠٣٠): **٠**.
  - `reconciliation_periods` (يكتبه `bank-import/route.ts:837` و`month-close/route.ts:93`): **٠**.
  - `bank_imports.bank_account_id`: **٠ من ٢**.
  - `bank_accounts.branch_id`: ٠ من ١.
  - `month_closes` و`adjudications`: ٠.
  - `classification_source`: فارغ في ٥ حركات.
- **إعادة الإنتاج:** `select text_source, count(*) from documents group by 1` يُرجع `null:168, TEXT:7`. و`select count(*) from reconciliation_periods` يُرجع ٠.
- **الأثر:**
  - الإقفال يمنع كلّ شهرٍ مضى لأنّ رصيديه مجهولان، مع أنّ `monthBalancesFromStatement` يستخرجهما من الكشفين المستوردين.
  - وما زال لا يُعرف كم من الأرشيف يتوقّف إن سُحب نموذج الرؤية.
- **الإصلاح (نصف يوم):**
  - نصّ `scripts/backfill-layers.ts` بوسيط `--apply` وبحارس `guard-write`، يعمل ثلاثة أشياء:
    1. يكتب `reconciliation_periods` من الكشفين بالدالّة نفسها.
    2. يملأ `text_source` عبر `documentInput()` بلا نداء نموذج.
    3. يكتب `bank_imports.bank_account_id` من حساب حركاته.
  - حالة في `production-gate.test.ts`: بند `layers_backfilled` يبقى `UNKNOWN` ما دام `text_source` فارغاً في أكثر من ٥٪.
  - **مخاطرة الإصلاح:** قراءة الأرشيف، وهي مسموحة.
- **يخالف قراراً؟** «**من يبني طبقةً جديدة يُعيد تشغيلها على البيانات القائمة في الكوميت نفسه، وإلّا فهي دعوى.**»

> لا ملاحظة P0 ولا P1 عندي، فلم تلزم محاولة نقض. رفعُ CODE-102 إلى P1 يستند إلى عطوبٍ ثبتت عند FIN وBTN وSEC، لا إلى دليلٍ جديد منّي.

---

## ٨. مشتبَه بها

- **`bank-import/route.ts:837-850`:** كتابة `reconciliationPeriods` و`recordAudit` تقعان بعد المعاملة (`:624-826`). إن سقط الطلب بينهما قُيِّدت الحركات بلا رصيد. قيد التدقيق خارج المعاملة عند SEC-110، أمّا الرصيد فلم أجده عند غيري.
- **`allocation-sql.test.ts`:** استعلامٌ فرعيّ يزيد فيه ما بين `select` و`where` على ٢٠٠ حرف يفلت من الحارس. لم أجد مثالاً قائماً.
- **٩٤ علامة `!`:** لم تُقيَّم فرداً فرداً. أبرزها `p.amountMinor!` في `drive-sync/route.ts:331,339`.

## ٩. ما لم يُفحَص

- لم أكتب اختبار قاعدة للخدمات، فـCODE-102 مُتتبَّعة. والعطوب الماليّة المُثبَتة عند FIN وBTN.
- لم أشغّل المزامنة على شهرٍ مقفل، فـCODE-103 مُتتبَّعة.
- لم أراجع المنطق الماليّ سطراً سطراً، وهو عند FIN. وحكم «سليم آليّاً» في ملفّ التغطية حكمٌ آليّ.
- لم أقيّم كلّ `!` من ٩٤، ولا ١٥٣ صادراً للاختبار وحده فرداً فرداً.
- لم أفحص `scripts/` إلّا بما يخصّ CODE-001 إلى CODE-009، والباقي عند OPS-102.

---

## الخلاصة

- **العدد:** ١١ ملاحظة جديدة: P0 = صفر · P1 = صفر · P2 = ٧ (CODE-101 · 102 · 103 · 104 · 106 · 110 · 111) · P3 = ٤ (CODE-105 · 107 · 108 · 109). ومعها ٣ مشتبَه بها.
- **ملاحظات ١٣ سبتمبر:**
  - من CODE: ٥ أُصلحت (001 · 002 · 005 · 006 · 012)، و٤ جزئيّة (004 · 007 · 008 · 009)، وواحدة أُصلحت جزئيّاً (011)، وواحدة ساءت (010)، واثنتان قائمتان (003 · 013).
  - من GAP: ١٦ من ١٨ أُصلحت، واثنتان جزئيّاً (011 · 017)، وGAP-001 في الشيفرة لا في البيانات.
- **التغطية:** ١٠٠٪، أي ٢٧٣ بنداً: ١١٣ في `lib` و٢٣ في `services` و٣٣ في `components` و٢ في `db` و١٠٢ اختباراً مصنَّفاً. الملفّ في `docs/review/2026-09-14/coverage-code.md`.
