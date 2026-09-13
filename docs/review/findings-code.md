> كتبها وكيل الجودة ونقلها المنسّق آلياً من ردّه.

# ملاحظات الجودة (CODE): مراجعة ٢٠٢٦-٠٩-١٣ عند `8d36f4e`

> **الدور الغالب:** المهندس الرئيسي، ومعه مهندس الجودة.
> **النطاق:** الشيفرة الميّتة، والمحرّكات المكرّرة، و`as`/`any`، والوحدات التي لا يصل إليها أحد، وفجوات الاختبار، ومطابقة الوثائق للواقع، وصدق رؤوس النصوص في قولها «يكتب» أو «يقرأ».
> **ما لم أكرّره لأنّ غيري أبلغ عنه:** كتابة سيناريو ٨ في `ops:certify` (عند OPS/SEC)، و`findPaymentTwin` في اثنين من ثمانية مسارات (FIN)، و`res.json` في المكوّنات، والمعاملة في `/api/counterparty`. أحيل إليها حيث تمسّ نطاقي.
> **مصفوفة التغطية:** مكتوبة في `docs/review/coverage.md` بـ٣٢٥ بنداً، ولم يبقَ فيها بندٌ من نطاق CODE بلا حكم. ولّدها `SCRATCH/gen-coverage.cjs` من `SCRATCH/verdicts.json`، وتُحدَّث بإعادة التوليد.

## ١. الملخّص

1. **`db:verify` لا يُثبت ما يقوله.** دالّة `mustFail` تعدّ أيّ خطأ «رفضاً». لذلك يمرّ فحصا الفاتورة الماليّان بقيد الفرادة على `document_id`، ويمرّ فحص «سباق دفعتين» بحدّ الدفعة لا بحدّ الفاتورة. ولا يُشغَّل النصّ في CI.
2. **جدول «مبنيّ ولا يصل إليه أحد» في `CLAUDE.md` قديم في الاتّجاهين.** `bank_account_id` ممتلئ الآن (١٤٤٠ من ١٤٤٠). و`insights.ts` (٣١١ سطراً) لا يستورده إلّا اختباره وليس في القائمة. و`adjudications` صفر صفوف.
3. **محرّكان لعملٍ واحد في ثلاثة مواضع:**
   - مقياس النماذج: المكتبة لا يستعملها النصّ.
   - المطابقة القديمة: ما زالت تعمل في `try:match`.
   - إنشاء المورّد: الخدمة ميّتة، ونسخةٌ منها داخل الواجهة.
4. **لا اختبار واحد من ١٣٦٨ يلمس قاعدةً أو واجهة.** والواجهات الثلاث والعشرون بلا اختبار. والحارس الوحيد الذي يقرأ الشيفرة نصّاً يحرس قائمةً مكتوبة باليد من أربعة ملفّات.
5. **المؤشّرات الآليّة نظيفة:** صفر `any`، وصفر `eslint-disable`، وصفر `@ts-ignore`، وصفر `TODO`.
   - ١٠٩ `as` أغلبها `(e as Error)` و`request.json() as Body`.
   - ٢٤ `as never` لأعمدة JSON والتعدادات.
   - لا ترجمة `TxCategory↔TxKind` بـ`as` في أيّ مكان.

---

## ٢. الملاحظات مرتّبةً بالدرجة

### CODE-001: `db:verify` يعدّ أيّ خطأ رفضاً، فأربعةٌ من فحوصه تمرّ بقيدٍ غير الذي تسمّيه
- **الدور:** مهندس الجودة.
- **الدرجة:** P1. اختبارٌ يُخضِّر ادّعاءً لم يُفحَص، و`CLAUDE.md` يستند إليه في ستّة قرارات.
- **الثقة:** مُتتبَّعة، ومعها SQL لتعريفات القيود وللبيانات التي يختارها النصّ. لم يُشغَّل النصّ.
- **الموضع:** `scripts/verify-invariants.ts:10-20` (دالّة `mustFail`) و`:66-80`.
- **خطوات إعادة الإنتاج:**
  1. `mustFail` تلتقط كلّ استثناء في `catch {}` وتطبع «✓ رُفض» (`:15-18`) دون أن تفحص رمز الخطأ أو اسم القيد. فخطأ الصياغة، والعمود الغائب، وقيد الفرادة، كلّها تُعدّ نجاحاً.
  2. **«فاتورة بإجمالي صفر» و«فاتورة مجموعها يخالف إجماليها»** (`:73-78`) تُدرجان `select … document_id … from invoices where id='${inv.id}'`، أي مستند الفاتورة نفسها.
     - `invoices.document_id` لا يقبل `NULL`، وعدد الفواتير بلا مستند صفر.
     - وعليه قيد `invoices_document_id_unique UNIQUE (document_id)`.
     - **المتوقَّع:** يرفضهما `invoices_total_positive` و`invoices_parts_sum_to_total`.
     - **الواقع:** قيد الفرادة يرفضهما في كلّ الأحوال، فلو حُذف القيدان الماليّان بقي الفحص أخضر.
  3. **«تخصيصٌ يتجاوز إجمالي الفاتورة (سباق دفعتين)»** (`:66-68`):
     - يأخذ أكبر دفعة، ١١٬٦٠٠٫٠٠، وهي مخصَّصة كلّها.
     - ويأخذ أكبر فاتورة، ١٣٬٥٠٦٫٧٥، ومخصَّص منها ١٣٬٣٥٤٫٣٨.
     - فيُرفض الإدراج لأنّه يتجاوز **الدفعة**. قيد الفاتورة لا يُقاس، ولا سباق في الفحص أصلاً (إدراجٌ واحد).
     - وفحص «تخصيص أكبر من قيمة الدفعة» (`:70-71`) يُرفض للسبب نفسه، فهما فحصٌ واحد باسمين.
  4. `begin; …; rollback;` نصٌّ واحد على `Pool` (`src/db/index.ts`، و`max: 10` محلّياً).
     - عند الخطأ تبقى الجلسة في معاملةٍ مُجهَضة.
     - ويُرسَل `rollback` في استعلامٍ منفصل (`:16`) قد يأخذ اتّصالاً آخر من المجمَّع.
     - يعمل اليوم لأنّ المجمَّع يعيد آخر اتّصالٍ حُرّر، وهذه مصادفةٌ في التنفيذ لا ضمان.
- **الأثر:** على الثقة. القرارات التي تقول «يثبته `db:verify`» عن السباق وحدود الفاتورة غير مُثبَتة. والحارس الفعليّ الوحيد لسباق الفاتورة هو سيناريو ٨ في `ops:certify`، وهو يكتب في الإنتاج.
- **الإصلاح المقترح (نصف يوم):**
  - توقيعٌ جديد `mustFail(label, statement, expected: { code: "23514"|"23505"|"P0001", constraint?: string })` يطابق `e.code` و`e.constraint` أو `e.message`، وإلّا يطبع «✕ رُفض لسببٍ آخر».
  - إدراج فاتورة الفحص بمستندٍ يُنشأ داخل المعاملة نفسها.
  - اختيار دفعةٍ فيها متّسع وفاتورةٍ مفتوحة لفحص حدّ الفاتورة، أو إنشاؤهما داخل المعاملة.
  - اتّصالٌ مخصَّص لكلّ فحص عبر `pool.connect()`.
  - في `.github/workflows/ci.yml`: خدمة `postgres:16`، ثمّ `db:migrate`، ثمّ `db:verify`.
  - **مخاطرة الإصلاح:** قد يظهر أنّ قيداً «مُثبَتاً» لا يعمل. وهذا هو المطلوب.
- **يخالف قراراً؟** نعم: «الثوابت المالية تُفرَض في القاعدة… `npm run db:verify` يثبت أنّها ترفض فعلاً. والقيد بلا اختبار ادّعاء».
- **المحامي المضادّ:** حاولتُ نقضها بأنّ القيد الماليّ ربّما يُفحَص قبل قيد الفرادة. لكنّ المعيار هو: هل يتغيّر الحكم لو حُذف القيد الماليّ؟ لا يتغيّر، فتسقط صفة الإثبات. وحاولتُ بأنّ المؤثِّر `payment_allocations_bounds` موجود فعلاً (`pg_trigger`). وجوده صحيح، لكنّ الفحص لا يميّز شطر الفاتورة فيه عن شطر الدفعة.

### CODE-002: `db:migrate` يعيد تلقائياً أيّ هجرة مطبَّقة تغيّر ملفّها، و`016` فيها `UPDATE` بلا `WHERE` يعيد كتابة الطبقات
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2. خطرٌ كامن: لا فرق بين البصمات اليوم، لكنّ أوّل تعديلٍ على تعليقٍ في `016` يطلقه.
- **الثقة:** مُثبَتة بـSQL لحساب الأثر، ومُتتبَّعة في `migrate.ts`.
- **الموضع:**
  - `scripts/migrate.ts:44-47`: «تغيّرت بعد تطبيقها — تُعاد».
  - `drizzle/sql/016_lifecycle_and_expense_events.sql:31-39`: `update bank_transactions set lifecycle = case …` بلا `WHERE`.
  - `:54-57`: `update expenses set event_key = …`.
- **خطوات إعادة الإنتاج:**
  1. عدّل حرفاً في تعليقٍ داخل `016`، ثمّ شغّل `npm run db:migrate`.
  2. **المتوقَّع:** تحذيرٌ يوقف التشغيل، لأنّ القاعدة والملفّ افترقا.
  3. **الواقع:** تُعاد الهجرة داخل معاملة وتنجح، لأنّ DDL فيها `if not exists`. ويُعاد حساب `lifecycle` لكلّ الحركات من القواعد القديمة.
- **الأثر (SQL):** ٨٩ حركة تتغيّر طبقتها:
  - ٤٩ من `CONFIRMED` إلى `INFERRED`، بقيمة **١٠٧٬٨٧٢٫٩٧ ريالاً**، و٢٦ منها قرّرها إنسان (`classification_source='HUMAN'`).
  - ٣٢ من `RAW` إلى `CONFIRMED`، و٧ من `CONFIRMED` إلى `POSTED`، وواحدة من `INFERRED` إلى `CONFIRMED`.
  - ما قرّره أحمد يتراجع إلى «مُستنتَج» دون أثر في سجلّ التدقيق.
  - بصمات الملفّات الستّة والعشرين تطابق `schema_migrations` كلّها اليوم، فالخطر لم يقع.
- **الإصلاح المقترح (ساعة):**
  - في `migrate.ts`: إن اختلفت بصمة هجرةٍ مطبَّقة، يتوقّف ويخرج بـ`exit 1` ما لم يُمرَّر `--reapply <name>`.
  - إضافة `where lifecycle = 'RAW'` إلى تحديث `016`، أو نقل الاشتقاق إلى نصّ إصلاح.
  - **مخاطرة الإصلاح:** من اعتاد تعديل هجرةٍ ثمّ إعادة تشغيلها سيحتاج الوسيط صراحةً.
- **يخالف قراراً؟** نعم، روحَ «نصٌّ يُشغَّل مرّتين فيعطي نتيجتين ليس نصَّ إصلاح»، وروحَ «الهجرات: SQL صريح… يترك أثراً يُراجَع».

### CODE-003: مقياسا نماذج: المكتبة التي تقيس «الخطأ الواثق» لا يستعملها النصّ الذي يقيس فعلاً
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2.
- **الثقة:** مُتتبَّعة.
- **الموضع:**
  - `src/lib/extraction/benchmark.ts` فيها `scoreProvider` و`rankProviders` و`CONFIDENT`، ولا يستوردها إلّا `benchmark.test.ts` (`SCRATCH/dead.txt`، قسم `testOnlyFiles`).
  - `scripts/benchmark-providers.ts:98` فيه `judge()` خاصّ به، ولا ذكر فيه للثقة (`grep CONFIDENT|confiden` لا يجد شيئاً).
- **خطوات إعادة الإنتاج:** `grep -rn 'extraction/benchmark"' src scripts | grep -v test` لا يُرجع شيئاً.
- **الأثر:**
  - رأس المكتبة يقول إنّ المعيار الأهمّ «نسبة الخطأ الواثق».
  - والقياس المنشور في `CHANGELOG` (١٢٦ فاتورة، ٨٤٫٠٪ مقابل ٩٣٫٨٪) حُسب بمحرّكٍ لا يقيسها.
  - فقرار «جيميني أم ديب سيك» بُني على نصف المعيار.
  - و`CLAUDE.md` يقول عن `benchmark.ts` «لا يُقاس أيّ نموذجٍ أدقّ»، والنصّ يقيس فعلاً بمحرّكٍ آخر.
- **الإصلاح المقترح (نصف يوم):** يبني `benchmark-providers.ts` مصفوفات `GroundTruth[]` و`Prediction[]` ويستدعي `scoreProvider` و`rankProviders`، ويُحذف `judge()`.
  - **مخاطرة الإصلاح:** تتغيّر أرقام CHANGELOG، فتُعلَن لا تُستبدَل بصمت.
- **يخالف قراراً؟** نعم، روحَ «خوارزميّةُ هويّةٍ واحدة… محرّكان، أحدهما موصول والآخر يبدو موصولاً».

### CODE-004: إنشاء المورّد مكتوبٌ مرّتين، والنسخة التي في الخدمة ميّتة، و`/api/supplier-alias` بلا مستدعٍ
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2.
- **الثقة:** مُتتبَّعة بمسح الاستيراد والبحث عن المستدعين.
- **الموضع:**
  - `src/services/supplier.service.ts:121,132,146`: `createSupplier` و`learnAlias` و`loadActiveSuppliers` صادرات ميّتة (`SCRATCH/dead.txt`).
  - `src/app/api/supplier/route.ts:89,101`: يُدرج `suppliers` و`supplierAliases` بيده.
  - `src/app/api/supplier-alias/route.ts` بأكمله: واجهة كتابة لها سجلّ تدقيق.
- **خطوات إعادة الإنتاج:** `grep -rlE "/api/supplier-alias" src/components src/app scripts` لا يُرجع شيئاً. والأسماء البديلة تُكتب اليوم من `/api/bank-rule/route.ts:105` ومن `/api/supplier`.
- **الأثر:**
  - ثلاثة مواضع تكتب اسماً بديلاً بثلاث قواعد تطبيع وتحقّق مختلفة. الحدّ الأدنى «ثلاثة أحرف» موجود في `supplier-alias` وحده.
  - وواجهة كتابةٍ مفتوحة لا يستعملها أحد، فهي سطحٌ بلا فائدة.
- **الإصلاح المقترح (ساعتان):**
  - تستدعي `/api/supplier` الدالّتين `createSupplier` و`learnAlias` من الخدمة، ويُنقل إليها حدّ الثلاثة أحرف.
  - يُحذف `/api/supplier-alias`، أو يُوصَل من شاشة البنك إن كان مقصوداً.
  - **مخاطرة الإصلاح:** اختلافٌ خفيّ في التطبيع بين النسختين يغيّر ما يُطابَق.
- **يخالف قراراً؟** نعم، روحَ «مصدر قرارٍ واحد».

### CODE-006: الحارس الذي يقرأ الشيفرة نصّاً يحرس قائمةً باليد، والشكل الممنوع قائمٌ خارجها وسليمٌ بالمصادفة
- **الدور:** مهندس الجودة.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة. صُيِّر SQL بـdrizzle دون اتّصال (`SCRATCH/render.mts` و`render2.mts`)، وقورن بـSQL للقراءة.
- **الموضع:**
  - `src/lib/allocation-sql.test.ts:37-42`: `GUARDED` أربعة ملفّات مكتوبة باليد.
  - `src/app/purchases/invoices/page.tsx:50,54`: `where pa.invoice_id = ${invoices.id}`.
  - `CLAUDE.md`، قسم «المصائد».
- **خطوات إعادة الإنتاج:**
  1. تصيير الاستعلام **بجدولٍ واحد**: `where pa.invoice_id = "id"`. هذا يُحلّ إلى `pa.id`، فتكون المدفوعات صفراً.
     - SQL: عدد الفواتير المدفوعة ١١٩ بالشكل الصحيح، و**صفر** بالشكل غير المؤهَّل.
  2. تصيير الاستعلام كما في الصفحة **مع `leftJoin(suppliers)`**: `pa.invoice_id = "invoices"."id"`، وهو صحيح.
  3. أي أنّ الصفحة التي تعرض «ما بقي عليك» وزرّ «سجّل أنّها سُدّدت» (الكوميت `8d36f4e` اليوم) صحيحةٌ لأنّ فيها `join` فقط. فمن يحذف الـ`join` غداً يجعل كلّ فاتورة «غير مسدَّدة»، والمستحقّ ١٣٣٬٩٦٩٫٣٦ ريالاً بدل **١٨٬٤٤٧٫٦٧**.
  4. والنمط `CORRELATED` في الاختبار سيمسك هذا الملفّ لو كان في القائمة، لكنّه ليس فيها.
- **الأثر:** على الثقة، وخطرٌ كامن على أهمّ رقمٍ عند أحمد. وخادم `/api/mark-paid` يكتب `invoices.id` حرفياً (`:67`)، فيردّ الوسم المزدوج. هذا يحدّ الأثر المالي ولا يحدّ الرقم المعروض.
- **الإصلاح المقترح (ساعة):**
  - يُبنى `GUARDED` بمسحٍ لكلّ `src/**/*.{ts,tsx}` بدل القائمة.
  - يُكتب الملفّان `${invoices}.id`.
  - وتُصحَّح المصيدة في `CLAUDE.md`: التجريد يقع في `select` على جدولٍ واحد، لا في كلّ `select`.
  - **مخاطرة الإصلاح:** إنذاراتٌ على استعلاماتٍ سليمة، فيُضاف استثناءٌ مسمّى بسببه.
- **يخالف قراراً؟** نعم، روحَ «عدد الهجرات يُقرأ من المجلّد لا يُكتَب رقماً». هنا قائمة الملفّات المحروسة تُكتب باليد.

### CODE-007: «مبنيّ ولا يصل إليه أحد» في `CLAUDE.md` قديم في الاتّجاهين، وفي الشيفرة ٢٩ صادراً ميّتاً
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2. يضلّل من يبني، وهو ما حذّر منه القسم نفسه.
- **الثقة:** مُثبَتة بـSQL وبمسحٍ آليّ للاستيراد (`SCRATCH/dead-exports.cjs`، ومخرجه في `dead.txt`).
- **الموضع:** `CLAUDE.md`، قسم «مبنيٌّ ولا يصل إليه أحد».
- **خطوات إعادة الإنتاج والواقع، بنداً بنداً:**

| البند في `CLAUDE.md` | الواقع اليوم | الدليل |
|---|---|---|
| `credit-notes.ts` لا تصل إليها شاشة | **وُصلت جزئياً:** يستدعيها `supplier-account.ts:66` من `suppliers/[slug]/page.tsx:91`، لكنّ `credits` لا يُمرَّر أبداً فيكون `[]` دائماً | `page.tsx:91-97` |
| `bank/reversal.ts` | ما زالت: لا يستوردها إلّا اختبارها | `dead.txt` قسم `testOnlyFiles` |
| `unit-conversion.ts` | ما زالت | `dead.txt` |
| `extraction/benchmark.ts` | ما زالت، ومحرّكٌ موازٍ يقيس (CODE-003) | `dead.txt` |
| `detectAnomalies` | ما زالت | `grep` لا يجدها إلّا في `lifecycle.test.ts` |
| `branches` | صفّ واحد، وصفر ملفّ في `src` يذكره | `SCRATCH/table-usage.txt` |
| `bank_accounts`، و«`bank_account_id` فارغ في ١٤٢٢» | **تغيّر:** صفّ واحد يكتبه `bank-account.service.ts:59`، و`bank_account_id` ممتلئ في **١٤٤٠ من ١٤٤٠**، لكنّ `bank_imports.bank_account_id` فارغ في **٢ من ٢** | SQL |
| `reconciliation_periods` | صفر صفوف. يُقرأ في `month-close-facts.ts:135` و`attention-facts.ts:193`، **ولا شيفرة تكتبه** | SQL وgrep |

  **وغير مسرود في القائمة:**
  - `src/lib/insights.ts` (٣١١ سطراً): مولّد التوصيات، لا يستورده إلّا `insights.test.ts`.
  - `src/lib/bank/parsers/types.ts`: لا يستورده أحد، و`BankAdapter` و`MIN_CONFIDENCE` فيه ميّتان.
  - `balance-equation.ts`: `reconcileAccount` و`describeReconciliation` للاختبار وحده، والمستعمل `checkBalance` فقط.
  - `review-queue.ts`: `describeQueue`. و`fees.ts`: `splitGroupFee`. و`entity-candidates.ts`: `proposeEntities`. و`pos.ts`: `groupBatches`. و`payment-state.ts`: `canTransition` و`availableMinor`. كلّها للاختبار وحده.
  - `adjudications` صفر صفوف: الحَكَم لم يُستدعَ على بيانات حقيقية قطّ.

  **الصادرات الميّتة التسعة والعشرون** (لا يستوردها أحد، ولا الاختبار):
  - في `ui-client.tsx`: `StickyActions` و`Progress`. وفي `ui.tsx`: `ErrorState`.
  - في `ai/deepseek.ts`: `contentHash`. وفي `ai/models.ts`: `DEEPSEEK_MODELS`. وفي `analytics.ts`: `AGE_LABEL`.
  - في `bank/adjudicate.ts`: `HIGH_VALUE_MINOR`. وفي `bank/classification.ts`: `LAYER_SOURCE`. وفي `bank/lifecycle.ts`: `LIFECYCLE_LABEL`.
  - في `bank/parsers/types.ts`: `BankAdapter` و`MIN_CONFIDENCE`. وفي `bank/rules.ts`: `NON_SUPPLIER_CATEGORIES`.
  - في `bank/taxonomy.ts`: `REVENUE_KINDS` و`POS_COST_KINDS` و`NON_OPERATIONAL` و`OUTCOME_LABEL` و`DISPOSITION_LABEL`.
  - في `bank/vision-statement.ts`: `VISION_PROMPT_VERSION`. وفي `extraction/schemas-by-kind.ts`: `utilityExtractionSchema`. وفي `extraction/versions.ts`: `provenance`.
  - في `insights.ts`: `SEVERITY_LABEL`. وفي `payment-state.ts`: `OPEN_STATUSES`.
  - في `expense.service.ts`: `expensesOfMonth`. وفي `rate-limit.service.ts`: `currentCount`. وفي `supplier.service.ts`: الثلاث المذكورة في CODE-004.
  - في `middleware.ts`: `middleware` و`config`، وهما مدخلا Next ولا يُعدّان ميّتين.
  - وفي الشيفرة ١٥٤ صادراً لا يستعمله إلّا الاختبار.
- **الأثر:** من يقرأ `CLAUDE.md` يظنّ تقييد الفرادة بالحساب بلا أثر، وهو يعمل. ويظنّ `insights` جزءاً من المنتج، وهو خارجه.
- **الإصلاح المقترح (ساعتان):**
  - تحديث القسم بالجدول أعلاه.
  - `scripts/dead-exports.ts` (نقل `SCRATCH/dead-exports.cjs`) يُشغَّل في CI ويفشل عند صادرٍ ميّتٍ جديد.
  - حذف `insights.ts` و`parsers/types.ts` أو وصلهما.
  - **مخاطرة الإصلاح:** المسح نصّيّ، وقد يخطئ في `import * as`. عولج في النصّ بفحص `ns.name`.
- **يخالف قراراً؟** نعم، القسم نفسه: «ما بُني ولم يُوصَل يُظنّ عاملاً».

### CODE-008: أرقام الوثائق ودعاواها تخالف الواقع في أحد عشر موضعاً
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة بعدٍّ آليّ.
- **الموضع والواقع:**

| الدعوى | موضعها | الواقع |
|---|---|---|
| ١٣١٣ اختباراً في ٨٨ ملفاً | `CLAUDE.md` «الأوامر» | **١٣٦٨ في ٩٢** |
| ١٬٢٥٨ اختباراً في ٨٥، و٢٥ هجرة | `ARCHITECTURE.md:9` | ١٣٦٨ في ٩٢، و**٢٦** هجرة |
| جدول الهجرات (٢٥ صفّاً) | `CLAUDE.md` | ينقصه `026_allocation_bounds_serialize.sql`، والمطبَّق في القاعدة ٢٦ |
| «ثلاثة مكوّنات عميل فقط» | `ARCHITECTURE.md:27` | **٢١** ملفّاً فيه `"use client"` |
| «لا دالة حذف ولا نقل ولا إعادة تسمية في `lib/drive.ts`» | `ARCHITECTURE.md:56` | `renameFile` في `src/lib/drive.ts:260`، و`CLAUDE.md` نفسه يأذن بها |
| «`apphosting.yaml` موجود» | `ARCHITECTURE.md:35` | غير موجود (أُصلح A4 ولم تُحدَّث الوثيقة) |
| `ops:certify`: «ستّة» / «سبعة» / «أحدَ عشر» | `certify-flow.ts:15` / `ARCHITECTURE.md:277` / `CLAUDE.md` | ١١ (عشرة بـ`scenario()` وواحدٌ خارجها). و«لا يكتب شيئاً» خطأ (عند OPS/SEC) |
| جدول الخدمات تسعة صفوف، منها `guard.service` | `ARCHITECTURE.md:100-110` | الملفّ `guard.ts`. وتنقص تسع خدمات: adjudicator وbank-account وcounterparty وreconcile وsearch وstatement-file وstatement-vision وsupplier-profile وexpense |
| «لا `drizzle-kit push`» | قرار في `CLAUDE.md` | `"db:push": "drizzle-kit push"` ما زال في `package.json` مع `db:generate` و`db:studio` |
| أوامر غير موثَّقة | `package.json` | ١٧ أمراً خارج `CLAUDE.md`: `db:seed` و`db:remove-dupe` و`db:missing-invoices` و`db:backfill-invoices` و`bench:extraction` و`drive:migrate` و`db:demo` و`try` و`try:archive` و`try:bank` و`try:match` و`try:statement` و`db:repair-months` و`ops:real-bank` و`db:generate` و`db:push` و`db:studio` |
| «`bank_account_id` فارغ في ١٤٢٢» | `CLAUDE.md` | ١٤٤٠ من ١٤٤٠ ممتلئ (CODE-007) |

  **وما طابق الواقع:**
  - ٣٩ جدولاً (٣٩ `pgTable`).
  - `ops:gate` خمسة عشر بنداً (`GATE_ORDER`).
  - جدول «المكتبات» (٦٢ صفّاً): كلّ ملفّ موجود، وكلّ رمزٍ مذكور بين علامتي الشيفرة موجود في ملفّه.
  - `arabic.ts` ثلاثة عشر جدولاً.
  - `detectAnomalies` لا يستدعيها شيء.
  - `ConfirmAction` مستعمل في `bank-import.tsx` و`month-close.tsx`.
  - كلّ أمرٍ في `CLAUDE.md` موجود في `package.json`.
  - `tsconfig.json` يشمل `**/*.ts`، فالنصوص يفحصها `typecheck` وكلّ مستورداتها موجودة.
- **الأثر:** «الملفّ يدّعي والشيفرة تشهد». وثلاث روايات لعددٍ واحد تُسقط الثقة بالبقيّة. و`db:push` يناقض قراراً مكتوباً ومتاحٌ بأمرٍ واحد.
- **الإصلاح المقترح (ساعتان):**
  - تحديث الوثيقتين.
  - حذف `db:push` و`db:generate` و`db:studio` من `package.json`.
  - اختبار `src/lib/docs-claims.test.ts` يقرأ `CLAUDE.md` ويقارن جدول الهجرات بالمجلّد، وأوامره بـ`package.json`.
  - **مخاطرة الإصلاح:** لا شيء يُذكَر.
- **يخالف قراراً؟** نعم: «التعليق الذي يصف نيّةً غير محقَّقة أسوأ من غيابه»، و«عدد الهجرات يُقرأ من المجلّد».

### CODE-009: نصوصٌ تكتب في الإنتاج أو في الأرشيف بلا حارس بيئة، وبعض رؤوسها لا يقول ذلك
- **الدور:** مهندس الجودة.
- **الدرجة:** P2. لم يُشغَّل شيءٌ منها، والخطر عند أوّل تشغيل.
- **الثقة:** مُتتبَّعة.
- **الموضع والواقع:**
  - `scripts/try-archive.ts:49-54`: يستدعي `findOrCreateFolder` لشهر `2026-08` ومجلّد «BeCof (بيكوف)» **قبل** فحص `--upload` (`:59`)، و`findOrCreateFolder` تُنشئ المجلّد إن غاب (`src/lib/drive.ts:131-135`). فوضع «تشخيص بلا رفع» قد يكتب في أرشيف الدرايف. ومع `--upload` يرفع أيّ ملفّ باسمٍ مثبَّت `2026-08-13_BeCof_Invoice_00282_SAR150.00.pdf` (`:57`) دون قيدٍ في القاعدة، أي ملفّاً يتيماً في الأرشيف.
  - `scripts/diagnose-drive.ts:1,36-37`: رأسه «بلا رفع»، ويستدعي `findOrCreateFolder` مرّتين، فالسلوك نفسه.
  - `scripts/seed-demo.ts:87-131`: يُدرج مستندات وفواتير ودفعات وتخصيصات موسومة `DEMO-` في القاعدة الوحيدة، وهي الإنتاج بحكم `ops:isolation`، بلا حارس. فتدخل «المستحقّ» و«المصروف» عند أحمد حتى يُشغَّل `--clear`.
  - `scripts/derive-expenses.ts` و`build-products.ts` و`seed-suppliers.ts`: تكتب مباشرةً بلا وضع معاينة. رؤوسها صادقة لكنّها لا تقول «يكتب».
  - `scripts/repair-integrity.ts` (٤٨٨ سطراً) إصلاحٌ لحادثة ٤ سبتمبر، و`migrate-archive.ts` (`drive:migrate`) ترحيلٌ انتهى. كلاهما باقٍ قابلاً للتشغيل وموثَّق في `ARCHITECTURE.md:271`.
  - بلا رأسٍ أصلاً: `diagnose-unpaid.ts` و`try-bank.ts` و`try-extract.ts` (ينادي النموذج، أي كلفة) و`try-match.ts`.
  - `grep -rnE 'VERCEL_ENV|NODE_ENV|systemIdentifier' scripts` لا يجد حارساً في أيّ نصٍّ كاتب.
  - **ما هو صادق** (الرأس يطابق السلوك، والكتابة خلف وسيط): `dedupe-bank` و`identity-report` و`learn-counterparties` و`reclassify-bank` و`rematch-bank` و`repair-import-scope` بوسيط `apply`، و`backfill-content` و`merge-suppliers` و`recompute-line-pricing` و`repair-bank-rules` بـ`--commit`، و`backfill-missing-invoices` و`repair-period-month` و`remove-duplicate-transaction` بـ`--apply`، و`drive-auth` بـ`--write`. والتقارير: `audit-data` و`measure-system` و`production-gate` و`truth-audit` و`find-split-suppliers` و`missing-invoices` و`link-counterparties` و`certify-real-bank` و`try-statement` و`check-isolation`. تفصيل كلّ نصّ في `coverage.md`.
- **الأثر:** قد يُنشأ مجلّدٌ في أرشيفٍ «لا يُمسّ» من أداة تشخيص. وقد تدخل فواتير وهمية المستحقَّ الحقيقيّ.
- **الإصلاح المقترح (نصف يوم):**
  - `scripts/lib/guard-write.ts` بدالّة `assertWriteAllowed()` تقارن `systemIdentifier` بمعرّف الإنتاج في `ops-attestation.json` وتطلب `--i-know-this-is-production`، ويستدعيها كلّ نصٍّ كاتب.
  - نسخة `findFolder` بلا إنشاء لنصوص التشخيص.
  - نقل نصوص الحوادث المنتهية إلى `scripts/archive/` خارج `package.json`.
  - **مخاطرة الإصلاح:** إزعاجٌ لتشغيلٍ مقصود.
- **يخالف قراراً؟** نعم: قيد «لا يُمسّ أرشيف جوجل درايف»، وقرار «لا بيانات مبيعات مخترَعة» بروحه، لأنّ `seed-demo` يخترع مشتريات.

### CODE-010: المسؤوليّات المختلطة كبرت منذ AUDIT بدل أن تُقسَّم
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة بـ`wc -l`.
- **الموضع:**

| الملفّ | AUDIT (٤ سبتمبر) | اليوم |
|---|---:|---:|
| `src/app/api/bank-import/route.ts` | — | **٨٧٨** |
| `src/components/uploader.tsx` | ٧٧٠ | ٧٧٠ (لم يُقسَّم، A2 و§١٩) |
| `src/app/api/match-confirm/route.ts` | — | ٦٦٥ |
| `src/app/api/drive-sync/route.ts` | ٣٨٣ | **٦٢٦** (منطقٌ في المسار، §١٣ و§١٩) |
| `src/components/review-workspace.tsx` | — | ٦٢٤ |
| `src/components/bank-import.tsx` | ٤١٢ | **٦١٠** (§١٩: «معالج بخمس خطوات» لم يقع) |
| `src/lib/attention.ts` | — | ٥٢٥ |

  و`ARCHITECTURE.md:112` يقول: «الواجهات تستقبل الطلب وتُترجم أخطاء الخدمات، لا أكثر».
- **خطوات إعادة الإنتاج:** مثلاً `drive-sync/route.ts:262-325` و`:465-486` يُدرج `documents` و`invoices` بيده، مع `as never` في `:262,465,469,471` و`!` في `:277,282,482`. وهذا تكرارٌ لمسار `/api/archive` عبر `createInvoice` بدل استدعاء `invoice.service`.
- **الأثر:** مسارا الأرشفة (الرفع والمزامنة) يكتبان الفاتورة بطريقتين. وهذا من جنس «الريال الواحد يأتي من بابين»، وأبلغ عنه FIN من جهة المال.
- **الإصلاح المقترح (أسبوع):**
  - `src/services/drive-sync.service.ts`، و`bank-import.service.ts` لما في المسار من سطر ١٣٥ إلى ٦٣٠.
  - يستدعي `drive-sync` الدالّتين `createDocument` و`createInvoice` كما يفعل `archive`.
  - **مخاطرة الإصلاح:** مسارٌ ماليّ بلا اختبار قاعدة (CODE-013)، فالتقسيم قبل الاختبار يخاطر.
- **يخالف قراراً؟** `ARCHITECTURE.md` §٥: «المنطق هنا (في الخدمات)، والواجهات رقيقة».

### CODE-013: لا اختبار يلمس قاعدةً أو واجهة، ولا يُشغَّل `db:migrate` أو `db:verify` في CI
- **الدور:** مهندس الجودة.
- **الدرجة:** P2.
- **الثقة:** مُثبَتة.
- **الموضع:**
  - `.github/workflows/ci.yml` يشغّل `typecheck` و`lint` و`test` و`build` فقط.
  - `vitest.config.mts` يشمل `src/**/*.test.ts`.
  - `find src/app -name '*.test.ts'` لا يُرجع شيئاً.
  - `grep -l 'from "@/db"' src/**/*.test.ts` لا يُرجع شيئاً.
- **الواقع:**
  - صفر اختبار للواجهات الثلاث والعشرين.
  - صفر `vi.mock` على الوحدة المختبَرة نفسها. الموجود `vi.stubGlobal("fetch")` في `deepseek.test.ts` و`provider.test.ts` و`adjudicator-provider.test.ts`، وهي حدودٌ شبكيّة مشروعة لا محاكاة للمختبَر.
  - اختبارٌ واحد يقرأ الملفّات نصّاً: `allocation-sql.test.ts` (CODE-006).
- **المسارات الماليّة الحرجة والاختبار الناقص بالاسم:**
  1. `POST /api/match-confirm`: التخصيص، وتبنّي التوأم (`:552-572`)، ورفض فاتورةٍ مسدَّدة. الناقص `src/app/api/match-confirm/route.db.test.ts`.
  2. `POST /api/match-confirm-bulk`: مجموعةٌ في معاملة، وتناقص المستحقّ بين حركتين. الناقص `route.db.test.ts`.
  3. `POST /api/mark-paid`: الدفعة والتخصيص و`refreshPaymentStatus`، ووسمٌ مكرَّر يُرجع `marked: 0`. الناقص `route.db.test.ts`.
  4. `POST /api/bank-import`: تبنّي الصفوف بلا حساب (`:545-551`)، واستيراد الملفّ مرّتين. الناقص `route.db.test.ts`، و`certify-real-bank` يقرأ ولا يكتب.
  5. `db:migrate` على قاعدة فارغة: لا يُعرف إن كانت الهجرات الست والعشرون تُطبَّق من الصفر. الناقص خطوة CI.
- **الأثر:** «الأخضر يقول إنّ القطع سليمة، لا إنّها موصولة» ما زال صحيحاً حرفياً. وكلّ عطبٍ ماليٍّ في CHANGELOG ٨ سبتمبر كشفه سجلّ الإنتاج لا الاختبار.
- **الإصلاح المقترح (يومان):** خدمة `postgres:16` في CI، و`vitest.db.config.mts` لملفّات `*.db.test.ts` تستدعي `POST` مباشرةً مع `AUTH_BYPASS` في بيئة الاختبار. تبدأ بالخمسة أعلاه.
  - **مخاطرة الإصلاح:** زمن CI من ثانيتين إلى دقيقتين تقريباً.
- **يخالف قراراً؟** لا يخالف نصّاً، ويؤكّد قرار «الاختبارات النقيّة لا تُثبت أنّ النظام يعمل» الذي لم يُعمَل به بعد.

### CODE-005: `matchBankTransactions` خرج من الاستيراد وبقي حيّاً في `try:match`
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P3.
- **الثقة:** مُتتبَّعة.
- **الموضع:** `src/lib/bank/match.ts:222`، و`scripts/try-match.ts:6,54`، و`package.json` `"try:match"`، وهو غير موثَّق.
- **خطوات إعادة الإنتاج:** `npm run try:match -- <كشف>` يطبع مطابقاتٍ بالمحرّك القديم الجشع، وتختلف عمّا يكتبه الاستيراد.
- **الأثر:** من يشخّص به مطابقةً يرى جواباً غير جواب النظام. وتعليق `bank-import/route.ts:356` «خرج من المسار» صحيح للمسار وحده.
- **الإصلاح المقترح (ساعة):** يُحذف `matchBankTransactions` و`findInvoiceCombination` من `match.ts`، ويُعاد كتابة `try-match.ts` على `runReconciliation`. ويبقى `findDuplicatePayments`.
- **يخالف قراراً؟** جزئياً: «مصدر قرارٍ واحد… خرج نهائياً».

### CODE-011: تنسيق المال بتسع دوالّ محلّية وخمسٍ وعشرين قسمةً مضمَّنة، وسجلّ التدقيق يحفظ ريالاتٍ عشريّة
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P3.
- **الثقة:** مُتتبَّعة.
- **الموضع:**
  - الدالّة الرسميّة `formatRiyals` في `src/lib/money.ts:83`، ومعها `components/money.tsx`.
  - نسخٌ محلّية: `insights.ts:73`، و`month-close.ts:67`، و`attention.ts:178`، و`balance-equation.ts:181`، و`statement-match.ts:334`، و`adjudicator-prompt.ts:60`، و`api/match-confirm/route.ts:649`.
  - `(x/100).toFixed(2)` مضمَّنة في نحو ٢٥ موضعاً، منها `bank-import.tsx:440` و`attention-facts.ts:147` و`payment-run.ts:122`. بعضها بفواصل آلاف وبعضها بلا.
  - في سجلّ التدقيق: `mark-paid/route.ts:127` `المبلغ: totalMinor / 100`، و`expense/route.ts:101`، و`match-confirm/route.ts:353-355,474-475`.
  - واستيرادات غير مستعملة (lint): `memoryKeyFor` و`IdentityKind` في `api/counterparty/route.ts:26`، و`TRANSACTION` في `changes.ts:1`، و`Empty`/`EmptyState` في ستّ صفحات.
- **الأثر:** الرقم نفسه يُكتب «1500.00» في موضع و«1,500.00» في آخر. وسجلّ التدقيق، وهو لا يُعدَّل، يحفظ `15.5` بدل `1550` هللة.
- **الإصلاح المقترح (نصف يوم):** كلّ عرضٍ عبر `formatRiyals`، وكلّ قيدٍ في التدقيق بالهللات (`amountMinor`). ويُحرَس ذلك بقاعدة lint من نوع `no-restricted-syntax` على `/ 100`.
- **يخالف قراراً؟** جزئياً، القيد ٣: «لا عدد عشري في أي حساب مالي». العرض ليس حساباً، أمّا سجلّ التدقيق فسجلٌّ ماليّ.

### CODE-012: `middleware.ts` اصطلاحٌ مهجور في Next.js 16
- **الدور:** المهندس الرئيسي.
- **الدرجة:** P3.
- **الثقة:** مُثبَتة في `SCRATCH/build.txt:9`: «The "middleware" file convention is deprecated. Please use "proxy" instead».
- **الموضع:** `src/middleware.ts`.
- **الأثر:** يعمل اليوم (`ƒ Proxy (Middleware)`)، وسيتوقّف عند إزالة التوافق.
- **الإصلاح المقترح (ساعة):** `npx @next/codemod@canary middleware-to-proxy .`، ثمّ مراجعة `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.
- **يخالف قراراً؟** نعم، `AGENTS.md`: «Heed deprecation notices».

---

## ٣. حال ملاحظات المراجعات السابقة التي في نطاقي

| المعرّف القديم | المصدر | الحال | الدليل |
|---|---|---|---|
| A2 `uploader.tsx` ٧٧٠ سطراً | AUDIT §٣ | ما زالت | ٧٧٠ سطراً اليوم |
| A3 `/dashboard` مكرّرة | AUDIT §٣ و§١٤ | أُصلحت | `src/app/dashboard/page.tsx` فيه `permanentRedirect("/")` |
| A4 `apphosting.yaml` | AUDIT §٣ | أُصلحت جزئياً | الملفّ حُذف، و`ARCHITECTURE.md:35` ما زال يذكره |
| §١٣ `bank-import.tsx` ٤١٢ | AUDIT | ساءت | ٦١٠ |
| §١٣ و§١٩ `drive-sync/route.ts` منطقٌ في المسار | AUDIT | ساءت | ٣٨٣ صارت ٦٢٦ (CODE-010) |
| §١٤ `/audit` | AUDIT | أُصلحت | `permanentRedirect("/attention")` |
| §١٩ تقسيم المكوّنات | AUDIT | لم يقع | CODE-010 |
| أ: `UNKNOWN_HIGH_VALUE` بلا مرشّحين | REVIEW-REPORT | أُصلحت جزئياً | `adjudicate.ts:109-111`: `candidates: []` مع `entityCandidates`. ولم يُختبَر على بيانات (`adjudications` صفر) |
| أ: `splitBankFee` لا يستدعيها أحد | REVIEW-REPORT | أُصلحت | مستعملة في `payment.service` و`reconcile.service` و`candidates.ts` |
| أ: `schemas-by-kind.ts` لا يستدعيه أحد | REVIEW-REPORT | أُصلحت، ويبقى صادرٌ ميّت | `schemaFor` في `provider-deepseek.ts:29` و`extract.ts:21`، و`utilityExtractionSchema` ميّت |
| أ: `detect.ts` يُرمى اسمه | REVIEW-REPORT | أُصلحت | `statement-file.service.ts:23` |
| أ: `exact` لا يُعرَض | REVIEW-REPORT | أُصلحت | `bank-import/route.ts:386` و`bank-import.tsx` |
| أ: `coverage.gaps` تُنسى | REVIEW-REPORT | أُصلحت | `month-close-facts.ts:12` و`attention-facts.ts:10` |
| أ: ثقة النموذج لا تؤثّر | REVIEW-REPORT | أُصلحت في الشيفرة، ولم تُجرَّب على بيانات | `weighVerdict` في `adjudicator.service.ts:21`، و`adjudications` صفر صفوف |
| و: الخدمات والمسارات الجديدة | REVIEW-REPORT | موجودة | كلّ ملفّ مسرود موجود (مسح الملفّات) |
| وحداتٌ مبنيّة لا تصل إليها شاشة | DEBUG | ما زالت، إلّا `credit-notes` (جزئيّاً) و`bank_accounts` (أُصلحت) | CODE-007 |
| تقييد الفرادة بالحساب بلا أثر | DEBUG | أُصلحت للحركات، وناقصة للاستيرادات | ١٤٤٠ من ١٤٤٠ حركة بحساب، و`bank_imports.bank_account_id` صفر من ٢ |

## ٤. تحقّق قرارات `CLAUDE.md` التي في نطاقي

| القرار مختصراً | طُبّق؟ | الدليل |
|---|---|---|
| خوارزميّة هويّة واحدة | كلّياً | `src/lib/bank/identity.ts` ٨٧ سطراً، والأسماء القديمة في التعليق `:6-7` وحده |
| `as` تُسكت المترجم | كلّياً في موضع الحادثة، وجزئياً في العموم | لا ترجمة `TxCategory↔TxKind` بـ`as`. و٢٤ `as never` لأعمدة JSON والتعدادات (`drive-sync/route.ts:262,465`، `document.service.ts:75`، `month-close/route.ts:110`)، و`counterparty.service.ts:294` `kind as IdentityKind` (قسم «مشتبَه بها») |
| مصدر قرارٍ واحد (`matchBankTransactions`) | جزئياً | خرج من `bank-import/route.ts`، وبقي في `match.ts:222` و`try-match.ts` (CODE-005) |
| عدد الهجرات يُقرأ من المجلّد | جزئياً | `EXPECTED_MIGRATIONS` حُذف و`migrate.ts` يقرأ المجلّد. لكنّ جدول `CLAUDE.md` يُكتب باليد وناقص، و`GUARDED` قائمة يدويّة (CODE-006، CODE-008) |
| التعليق الذي يصف نيّة غير محقَّقة | لا | `certify-flow.ts:5-15`، و`verify-invariants.ts:4-5` «يثبت»، و`diagnose-drive.ts:1` «بلا رفع»، و`ARCHITECTURE.md:27,35,56` |
| الثوابت المالية في القاعدة ويثبتها `db:verify` | جزئياً | القيود موجودة (`pg_constraint`)، والإثبات معيب (CODE-001) |
| الاختبارات النقيّة لا تُثبت أنّ النظام يعمل | لم يُعمَل به | صفر اختبار قاعدة (CODE-013) |
| من يبني طبقة يُعيد تشغيلها على البيانات | جزئياً | `decision_history` ١٦٩٧ صفّاً. و`adjudications` و`reconciliation_periods` صفر |
| نصوص الإصلاح تحفظ كاملاً | لم يُفحَص بعمق | رأس `reclassify-bank.ts:13-15` يصرّح به، ولم أتتبّع الكتابة سطراً سطراً |
| نصٌّ يُشغَّل مرّتين يعطي نتيجة واحدة | جزئياً | `dedupe-bank` يصرّح به. و`migrate.ts` مع `016` يخالفه (CODE-002) |
| لا `drizzle-kit push` | لا | `package.json` فيه `"db:push": "drizzle-kit push"` (CODE-008) |
| `CLAUDE.md` مصدرٌ لا يكذب | جزئياً | CODE-007 وCODE-008 |

## ٥. مواضع «الغباء» في نطاقي

- **ثلاثة أرقام لشيءٍ واحد:** عدد سيناريوهات الشهادة (٦ و٧ و١١)، وعدد الاختبارات (١٢٥٨ و١٣١٣ و١٣٦٨ فعلياً)، وعدد الهجرات (٢٥ في الوثيقتين و٢٦ فعلياً).
- **سؤالٌ واحد يُسأل مرّتين:** فحصا «سباق دفعتين» و«أكبر من الدفعة» في `db:verify` يُرفضان بالسبب نفسه.
- **قائمةٌ يدويّة تتكرّر رغم قرارٍ صريح ضدّها:** `GUARDED` في `allocation-sql.test.ts`، وجدول الهجرات في `CLAUDE.md`.
- **فعلٌ بلا مستدعٍ:** `/api/supplier-alias` يكتب ويُدقِّق ولا يطلبه أحد.
- **أداتا قياس لا تتّفقان:** `benchmark.ts` و`benchmark-providers.ts`.

## ٦. جدول التغطية

كامل في **`docs/review/coverage.md`**، ولا تكرار هنا. فيه ٣٢٥ بنداً: كلّ صفحة وواجهة ومكوّن ومكتبة وخدمة ونصّ وهجرة وجدول. وفي عمود «ملاحظة الجودة» حكمٌ آليّ لكلّ ملفّ أيّاً كان مالكه: صادر ميّت، أو اختبارٌ وحده، أو طويل. وكلّ بندٍ مالكه CODE له حكم (صفر «لم يُحكَم بعد»).

**الخلاصة:**
- **نصوص (٤١):** ٩ في CODE-009، و`certify-flow` في CODE-008، و`verify-invariants` في CODE-001، و`migrate` في CODE-002، و`benchmark-providers` في CODE-003، و`try-match` في CODE-005. والباقي «سليم» بسببه.
- **هجرات (٢٦):** كلّها مطبَّقة، وبصماتها تطابق الملفّات. `016` في CODE-002. و`002` إعادتها تفشل صاخبةً بلا ضرر (أعمدةٌ أُسقطت). و`026` غير مسرودة في `CLAUDE.md`. وDDL كلّها بـ`if not exists` أو كتلة `do $$`.
- **جداول (٣٩):**
  - فارغة عمداً: مجال المبيعات، سبعة جداول.
  - فارغة بلا عمد: `reconciliation_periods` و`adjudications` و`month_closes` و`recurring_expenses`.
  - بلا شيفرة: `branches`.

## ٧. استعلامات SQL (كلّها للقراءة عبر `ro-sql.cjs`)

| الاستعلام | النتيجة |
|---|---|
| `bank_transactions`: الكلّ، وما له `bank_account_id`، وعدد الحسابات المختلفة | ١٤٤٠ و١٤٤٠ و١ |
| عدّ صفوف `bank_accounts` و`branches` و`reconciliation_periods` و`decision_history` و`adjudications` و`statement_lines` و`bank_imports` (ومنها ما له حساب)، والمبيعات | ١ و١ و٠ و١٦٩٧ و٠ و٢٠١ و٢ (٠ بحساب)، والمبيعات ٠ |
| بقايا `certify`: موردون وفواتير `RACE-` ومستندات `certify-` وتدقيق | ٠ و٠ و٠ و٠ |
| `information_schema.tables` في public، و`schema_migrations` وآخرها | ٤٠، و٢٦، و`026_allocation_bounds_serialize.sql` |
| أكبر فاتورة: إجماليها والمخصَّص منها. وأكبر دفعة: مبلغها والمخصَّص منها | ١٣٬٥٠٦٫٧٥ / ١٣٬٣٥٤٫٣٨. ١١٬٦٠٠٫٠٠ / ١١٬٦٠٠٫٠٠. ولا تخصيص بينهما |
| `pg_constraint` و`pg_indexes` و`pg_trigger` على invoices وexpenses وpayment_allocations | `invoices_document_id_unique`، وأربعة `CHECK` ماليّة، و`payment_allocations_bounds` |
| `invoices.document_id` يقبل NULL؟ وعدد الفواتير بلا مستند | لا، ٠ |
| الفواتير المدفوعة بالشكل الصحيح مقابل `pa.invoice_id = "id"` | ١١٩ مقابل ٠ |
| إجمالي الفواتير، والمستحقّ الحقيقيّ، والمسدَّدة | ١٣٣٬٩٦٩٫٣٦، و١٨٬٤٤٧٫٦٧، و١١٨ |
| ما تفعله إعادة `016` بطبقات الحركات | ٨٩ حركة تتغيّر، منها ٤٩ `CONFIRMED→INFERRED` بقيمة ١٠٧٬٨٧٢٫٩٧ و٢٦ منها بشريّة |
| `schema_migrations.sha256` مقابل بصمات الملفّات | ٢٦ من ٢٦ متطابقة |
| `pg_stat_user_tables` (عدد الصفوف لقسم الجداول) | في `SCRATCH/rowcounts.json` |

## ٨. مشتبَه بها (لم تُتتبَّع كاملاً)

- **`counterparty.service.ts:294` `memoryKeyFor(kind as IdentityKind, …)`:** `kind` نصٌّ من تعداد القاعدة `counterparty_evidence_kind`، ويُستثنى منه `REFERENCE` وحده. إن كان في التعداد نوعٌ ليس في `IdentityKind` فالتحويل يُسكت المترجم عنه. لم أقارن القائمتين.
- **`src/app/api/archive/route.ts:220` `body.invoiceNumber!.trim()`:** شرطه `review.canCreateInvoice` في `confirm.ts:144`، ولم أقرأ هل يشترط رقم الفاتورة. إن لم يشترطه فمستندٌ بلا رقم يُسقط الطلب بـ٥٠٠.
- **`drive-sync/route.ts:277,282` `p.invoiceNumber!` و`p.amountMinor!`:** شرطها `plan.createsInvoice` في `archive-import.ts:54`، ولم أقرأ الشرط كاملاً.
- **`ARCHITECTURE.md:186-191`:** قائمة `tx_category` قد ينقصها `BANK_VAT` (هجرة `022`). لم أقارنها بالتعداد في `schema.ts`.

---

=====COVERAGE=====
المصفوفة كاملة مكتوبة في `docs/review/coverage.md` (٣٢٥ بنداً). نجح توليدها بـBash، ولا تحتاج إلى استخراج من هذه الرسالة.

---

## للمنسّق: ملخّص قصير

- **العدد:** ١٣ ملاحظة: P0 = صفر · P1 = ١ · P2 = ٩ · P3 = ٣. ومعها أربع مشتبَه بها في قسمٍ منفصل.
- **لم يُكتب ملفّ الملاحظات:** رفضت الأداة كتابته. محتواه الكامل هو هذه الرسالة من أوّلها حتى سطر `=====COVERAGE=====`، ومسودّة احتياطيّة في `SCRATCH/findings-code.draft.txt`.
- **مصفوفة التغطية مكتوبة فعلاً** في `docs/review/coverage.md`، ولم يبقَ فيها بندٌ من نطاق CODE بلا حكم.
- **عقدة لم تثبت:** شككتُ في أنّ صفحة الفواتير تعرض كلّ فاتورة غير مسدَّدة (قيمة المدفوع صفر). صيّرتُ الاستعلام بلا اتّصال فوجدتُ الـ`leftJoin` يجعله صحيحاً، فخفّضتُها إلى P2 كامنة (CODE-006) ولم أُبلغ عنها P0.

**أخطر خمس:**
1. **CODE-001 (P1):** `db:verify` يعدّ أيّ خطأ رفضاً، فقيدا الفاتورة الماليّان وحدّ الفاتورة في السباق غير مُثبَتة فعلاً.
2. **CODE-002 (P2):** تعديلُ حرفٍ في `016` يجعل `db:migrate` يعيدها بلا سؤال، فتتراجع ٤٩ حركة مؤكَّدة (١٠٧٬٨٧٢٫٩٧ ريالاً، ٢٦ منها بيد أحمد).
3. **CODE-013 (P2):** صفر اختبار قاعدة أو واجهة، والهجرات و`db:verify` خارج CI، وسمّيتُ خمسة مسارات ماليّة والاختبار الناقص لكلٍّ منها.
4. **CODE-009 (P2):** `try-archive` و`diagnose-drive` قد يُنشئان مجلّدات في الأرشيف وهما في وضع «التشخيص»، و`seed-demo` يُدرج فواتير وهمية في الإنتاج، ولا حارس بيئة في أيّ نصٍّ كاتب.
5. **CODE-006 (P2):** الحارس النصّيّ يحرس قائمةً يدويّة، والشكل الممنوع حيٌّ في صفحة الفواتير وسليمٌ بفضل `join` وحده.