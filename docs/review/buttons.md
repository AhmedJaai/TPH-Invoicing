# جرد الأزرار زرّاً زرّاً — `main` عند `8d36f4e`

> تتبّعتُ الشيفرة سطراً بسطر، واستعملتُ SQL للقراءة وحده. عمود «المتصفّح» فارغ ليملأه المنسّق.
> **ملاحظة عامّة تنطبق على كلّ الصفوف:** لا توجد واجهة واحدة تتحقّق من جسم الطلب بـzod. الجسم يُحوَّل بـ`as Body` (`grep "z\." src/app/api` لا يجد شيئاً)، ثمّ تُفحص الحقول يدوياً. لذلك عمود «التحقّق» يقول «لا» في كلّ الصفوف إلّا إن ذُكر غير ذلك.
> «قشرة» تعني العناصر التي تظهر في كلّ صفحة تمرّ بـ`PageShell`، أي كلّ الصفحات عدا `/login` و`/audit` و`/dashboard` (الأخيرتان تحويلٌ دائم).
> الإشارة `مرجع XXX` تعني ملاحظةً وجدها وكيلٌ آخر، ولم أُعِد اشتقاقها هنا.

| # | الصفحة | نصّ الزرّ كما في الشيفرة | موضعه | ماذا يَعِد به نصّه | الدالّة في الواجهة `file:line` | الطلب | `guard` والصلاحية | التحقّق | الخدمة ← الاستعلام | ماذا يفعل فعلاً | حالة الانتظار | حالة النجاح | حالة الفشل ورسالتها | النقر المزدوج | التراجع | سجلّ التدقيق | الحكم | المتصفّح |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | قشرة | «ذا بوبليك هاوس» | page-shell.tsx:61 | الرئيسية | Link | GET / | — | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 2 | قشرة | «تخطَّ إلى المحتوى» | page-shell.tsx:54 | القفز إلى المحتوى | `a#main` | — | — | — | — | يقفز | — | — | — | — | — | — | سليم | |
| 3 | قشرة | حقل «ابحث برقم أو مبلغ أو اسم…» ومفتاح «/» | search-box.tsx:99,37 | يجد ما يُكتب | useEffect :50-72 | GET /api/search?q | search / document:view | لا | search.service ← ilike على invoices وsuppliers وproducts وbank_transactions وdocuments | يعيد حتى ٦ نتائج من كلّ نوع **ومعها المبالغ** | «يبحث…» | قائمة نتائج | «تعذّر البحث. حاول ثانيةً.» لكلّ فشل، ولا يفرّق 429 عن 401 عن الشبكة | لا يُلغى الردّ القديم | — | لا (يكتب في rate_limits) | BTN-004 · BTN-021 | |
| 4 | قشرة | زرّ النتيجة | search-box.tsx:139 | يفتح السجلّ | go :83 | router.push(href) | — | — | — | ينتقل. ونتيجة البنك لمن لا يملك bank:view تفتح صفحة «خارج صلاحيتك» | — | — | — | — | — | — | BTN-004 | |
| 5 | قشرة | «خروج» | user-menu.tsx:20 | ينهي الجلسة | server action signOut | POST action | — | — | Auth.js | يُخرج ويحوّل إلى /login | — | يحوّل | — | — | — | لا | سليم (يُخفى في وضع التجربة) | |
| 6 | قشرة | روابط المساحات السبع | nav.tsx:77 · nav.ts:32 | ينتقل | Link | — | يُخفى بحسب `needs` | — | — | ينتقل. كلّ الوجهات موجودة | — | — | — | — | — | — | سليم | |
| 7 | قشرة | أقسام المساحة، وشارة العدد على «طابور المراجعة» | nav.tsx:101,117 · nav.ts:52-83 | ينتقل. والشارة = العمل الباقي | Link · countPendingWork (page-shell.tsx:46) | — | يُخفى بحسب `needs` | — | pending.ts | الشارة تُعاد قراءتها مع router.refresh | — | — | — | — | — | — | سليم، عدا «المستحقّ عليك» ← BTN-012 | |
| 8 | قشرة | «+ رفع» (حاسوب وجوّال) | nav.tsx:227 · page-shell.tsx:102 | الرفع | Link /upload | — | يُخفى بلا document:upload | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 9 | قشرة | شريط الجوّال، و«المزيد»، وخلفية «إغلاق» | nav.tsx:149,153,170 | تنقّل | useState | — | يُخفى بحسب `needs` | — | — | يعمل | — | — | — | — | — | — | سليم | |
| 10 | /login | «الدخول بحساب جوجل» | login/page.tsx:68 | الدخول | server action ‏`signIn("google",{redirectTo: from\|\|"/"})` | POST action | — | — | Auth.js | يحوّل إلى جوجل | لا حالة انتظار | يعود إلى `from` | نصّ من ERROR_TEXT مع رمز الخطأ | إرسالان | — | لا | سليم (وفي «مشتبَه بها»: قيمة `from`) | |
| 11 | / | الرقم الكبير «مشتريات الشهر» | page.tsx:121 · figure.tsx:46 | تفصيل المشتريات | Link /purchases | — | الصفحة: amounts:view، وإلّا تحويل إلى /upload (:57) | — | — | ينتقل | — | — | — | — | — | — | سليم (مرجع UX-002) | |
| 12 | / | الرقم الكبير «المستحقّ للمورّدين» | page.tsx:137 | تفصيل المستحقّ | Link /money | — | — | — | — | يفتح بوّابة المال لا قائمة الفواتير غير المسدَّدة | — | — | — | — | — | — | BTN-032 | |
| 13 | / | الرقم الكبير «ضريبة مدخلات مؤكَّدة» | page.tsx:145 | تفصيل الضريبة | Link /attention | — | — | — | — | لا صفحة للضريبة، يفتح «ما يحتاج انتباهك» | — | — | — | — | — | — | BTN-032 | |
| 14 | / | «من أين جاء؟ / أخفِ المصدر» | figure.tsx:57 | يعرض المصدر | useState | — | — | — | — | يطوي ويبسط | — | — | — | — | — | — | سليم | |
| 15 | / | «أصلِح: …» | figure.tsx:125 | مكان الإصلاح | Link c.href | — | — | — | provenance | ينتقل | — | — | — | — | — | — | سليم | |
| 16 | / | بطاقات «ما الذي تغيّر» | changes.tsx:78 | التفصيل | Link c.href | — | — | — | changes.ts | ينتقل | — | — | — | — | — | — | سليم | |
| 17 | / | «n حرج · n عالٍ ←» | page.tsx:170 | الانتباه | Link /attention | — | — | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 18 | / و/attention | «عالِجها ←» أو `actionLabel` | attention-list.tsx:70 | مكان الإصلاح | Link item.href | — | الصفحة: reports:view | — | attention.ts:85 (`href` إلزاميّ؛ ١٦ وجهة كلّها موجودة) | ينتقل | — | — | — | — | — | — | سليم (ووجهة NEEDS_REVIEW ← BTN-025) | |
| 19 | / و/attention | «اعرض التفاصيل (n)» | attention-list.tsx:48 | الأدلّة | `details` | — | — | — | — | يبسط | — | — | — | — | — | — | سليم | |
| 20 | / و/attention | «بقي N أقلّ أهمّية / اطوِ الباقي» | attention-list.tsx:137 | الباقي | useState | — | — | — | — | يبسط | — | — | — | — | — | — | سليم | |
| 21 | / | «أضف مستنداً» · «الأرشيف» | page.tsx:244-245 | ينتقل | LinkButton | — | — | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 22 | /attention | «ابدأ بالضريبة» | attention/page.tsx:38 | الفواتير ناقصة الضريبة | LinkButton | GET /purchases/invoices?tax=INVALID | — | — | — | ينتقل مرشَّحاً | — | — | — | — | — | — | سليم | |
| 23 | /performance | رابط «ذكاء الشراء» | performance/page.tsx:162 | التحليل | Link /analysis | — | amounts:view | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 24 | /purchases | بطاقات HubGrid السبع | purchases/page.tsx:48-90 · hub.tsx:64 | الأقسام | Link | — | amounts:view | — | — | ينتقل | — | — | — | — | — | — | مرجع UX-002 | |
| 25 | /purchases/invoices | أزرار الترشيح: الضريبة، السداد، «متأخّرة»، «بلا بنود»، الشهر | invoices/page.tsx:144-166 | ترشيح | Link linkTo | GET | amounts:view | parseFilters | invoices (من الخادم) | يرشّح | — | — | — | — | — | — | سليم | |
| 26 | /purchases/invoices | أزرار الترشيح بالمورّد | invoices/page.tsx:174 | ترشيح بالمورّد | `supplierList.slice(0,12)` | GET | — | — | — | يعرض ١٢ مورّداً من ٢٢ نشطاً | — | — | — | — | — | — | BTN-020 | |
| 27 | /purchases/invoices | «امسح الترشيح» · «أضف فاتورة» | invoices/page.tsx:126-127,190 | ينتقل | LinkButton | — | — | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 28 | /purchases/invoices | بطاقة الصفّ على الجوّال | ui.tsx:369 · invoices/page.tsx:188 | صفحة المورّد | Card href | — | — | — | — | ينتقل (والزرّ داخل الرابط يوقف الانتشار: mark-invoice-paid.tsx:94) | — | — | — | — | — | — | سليم | |
| 29 | /purchases/invoices | «سجّل أنّها سُدّدت» | mark-invoice-paid.tsx:105 | يفتح التأكيد | setState | — | — | — | — | يعرض «تُنشأ دفعة بـX» | — | — | — | — | — | — | سليم | |
| 30 | /purchases/invoices | «أكّد» | mark-invoice-paid.tsx:119 | يسجّل السداد | run :34 | POST /api/mark-paid `{invoiceIds:[id]}` | mark-paid / payment:approve (الصفحة تشترط amounts:view وحدها، فالمحاسب يرى الزرّ) | لا | mark-paid/route.ts:59-117: insert payments (`BANK_TRANSFER`، `paidAt`=تاريخ الفاتورة) ثمّ allocations ثمّ refreshPaymentStatus | يُنشئ دفعة بالمتبقّي | «يحفظ…» والزرّ معطَّل | «✓» مع router.refresh | نصّ الخادم أو «ردّ الخادم بالرمز N»، والشبكة مفصولة، و`marked:0` يُعلَن | مؤثِّر 026 يردّ الثاني بـ500 | لا مسار ردّ | INVOICES_MARKED_PAID | BTN-009 · BTN-008 · BTN-027 | |
| 31 | /purchases/invoices | «تراجع» | mark-invoice-paid.tsx:127 | يغلق التأكيد | setState | — | — | — | — | يغلق | — | — | — | — | — | — | سليم | |
| 32 | /purchases/invoices | «السابق» · «التالي» | invoices/page.tsx:278,284 | الصفحات | Link | — | — | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 33 | /purchases/products | «نعم، هو «…»» | product-mapping.tsx:291 | يربط بالمرشّح | send :209 | POST /api/product `{link, productId}` | product / supplier:edit | لا | product.service.linkToProduct | يربط | «يحفظ…» والزرّ معطَّل | onResolved، ثمّ index+1، ثمّ refresh | `res.json()` :219 | معطَّل | لا زرّ «فكّ الربط» (الواجهة تدعمه: route.ts:49) | PRODUCT_LINKED | BTN-010 · مرجع OPS-003 | |
| 34 | /purchases/products | «لا، أنشئ صنفاً له / أنشئ صنفاً معيارياً له» | product-mapping.tsx:295 | ينشئ صنفاً | createOwn :235 | POST /api/product | supplier:edit | لا | linkToProduct | ينشئ بتصنيف `OTHER` دون أن يسأل | «يحفظ…» | كما سبق | كما سبق | معطَّل | لا | ✓ | BTN-010 | |
| 35 | /purchases/products | «تخطَّ» · «رجوع» | product-mapping.tsx:298,250 | تنقّل في الطابور | setIndex | — | — | — | — | الفهرس يتقدّم بينما الطابور يقصر، فيُتخطّى بند | — | — | — | — | — | — | BTN-010 | |
| 36 | /purchases/products | قوائم «صنف معياري…» و«اسم الصنف» و«التصنيف» | product-mapping.tsx:121-150 | إدخال | useState | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 37 | /purchases/products | «اربط / اربط N معاً» | product-mapping.tsx:153 | يربط | save :58 | POST /api/product | supplier:edit | لا | linkToProduct | يربط، و`linked:0` يُعرض خطأً | «يحفظ…» | «✓» مع refresh | `res.json()` :73، ونصّ `e.message` خام :82 | معطَّل | لا | ✓ | مرجع OPS-003 | |
| 38 | /suppliers | اسم المورّد، وبطاقة الجوّال | suppliers/page.tsx:105 وhrefOf | صفحة المورّد | `a` (لا Link) | — | — | — | — | ينتقل بتحميلٍ كامل | — | — | — | — | — | — | سليم | |
| 39 | /suppliers | «أضف مورّداً» | suppliers/page.tsx:62,182 | إضافة مورّد | LinkButton /settings | — | — | — | — | لا نموذج في الوجهة | — | — | — | — | — | — | مرجع UX-003 | |
| 40 | /suppliers/[slug] | «راجع كشوفه» | [slug]/page.tsx:167 | كشوف هذا المورّد | LinkButton /statements | — | — | — | — | يفتح كلّ الكشوف بلا ترشيح | — | — | — | — | — | — | BTN-032 | |
| 41 | /suppliers/[slug] | «عدّل بياناته» | [slug]/page.tsx:168 | تعديل المورّد | LinkButton /settings | — | — | — | — | لا تعديل في الوجهة | — | — | — | — | — | — | مرجع UX-003 | |
| 42 | /suppliers/[slug] | «كلّها» (تحت «آخر فواتيره») | [slug]/page.tsx:283 | كلّ فواتيره | LinkButton /purchases | — | — | — | — | يفتح البوّابة لا `/purchases/invoices?supplier=slug` | — | — | — | — | — | — | BTN-032 | |
| 43 | /suppliers/[slug] | «طابقها» · «ارفع كشفاً» | [slug]/page.tsx:326,332 | الكشوف | LinkButton | — | — | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 44 | /statements | «طابِق / أعد المطابقة» | statement-reconcile.tsx:124 | يقرأ الكشف ويطابقه ويحفظ | send :65 | POST /api/statement-reconcile `statementId` | statement-reconcile / supplier:edit (حدّ ٢٠ في الساعة) | لا | تنزيل من الدرايف، ثمّ extractDocument (نموذج)، ثمّ المطابقة، ثمّ في معاملة: حذف الأسطر وإعادة إدراجها، وتحديث statements، و**إدراج issues** | يحفظ الأسطر والتنبيهات، والإعادة تكرّر التنبيهات | «يقرأ ويطابق…» وكلّ الأزرار معطَّلة | النتيجة مع refresh | `res.json()` :72، ونصّ `e.message` خام :80 | معطَّل | لا | STATEMENT_RECONCILED | BTN-011 · مرجع OPS-003 | |
| 45 | /statements | قائمة «المورّد: يُستنتج من الكشف» | statement-reconcile.tsx:150 | اختيار | useState | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 46 | /statements | «اختر ملف الكشف» | statement-reconcile.tsx:160 | فحص سريع لا يُحفظ | send upload | POST multipart | supplier:edit | لا | نداء نموذج في كلّ مرّة | لا يحفظ | «يقرأ…» | النتيجة | كما سبق | معطَّل | — | لا | سليم | |
| 47 | /statements | «انسخ المذكّرة» | statement-reconcile.tsx:297 | ينسخ | clipboard.writeText | — | — | — | — | لا `catch`: رفض الإذن يمرّ صامتاً | — | «✓ نُسخت» | لا شيء | — | — | — | BTN-029 | |
| 48 | /statements | «أرسلها واتساب» | statement-reconcile.tsx:307 | واتساب | a wa.me | — | — | — | — | يفتح | — | — | — | — | — | — | سليم | |
| 49 | /documents | حقل «ابحث في اسم الملف…» وزرّ «ابحث» | documents/page.tsx:190-207 | بحث | form GET | GET /documents?q | — | — | ilike على file_name | يرشّح | — | — | — | — | — | — | سليم | |
| 50 | /documents | «امسح الترشيح» · أزرار الحالة والشهر والنوع والمورّد | documents/page.tsx:209-253 | ترشيح | Link | GET | — | — | — | يرشّح | — | — | — | — | — | — | سليم | |
| 51 | /documents | «افتحه» | documents/page.tsx:337 | الملفّ في الدرايف | a target=_blank | — | — | — | — | يفتح | — | — | — | — | — | — | سليم | |
| 52 | /documents | «الأحدث» · «الأقدم» | documents/page.tsx:359,364 | الصفحات | Link | — | — | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 53 | /documents | (زرّ غائب) أرشفة مستندٍ «يحتاج مراجعة» أو رفضه | — | attention.ts:315,450 تحيل هنا بخطوة «راجعها وأرشفها أو ارفضها» | — | — | — | — | لا واجهة تفعل ذلك | — | — | — | — | — | — | — | BTN-025 | |
| 54 | /upload | منطقة «اسحب الفواتير هنا» وحقل الملفّ | uploader.tsx:528-551 | يقرأ المستند | analyze :339 | POST /api/analyze multipart | analyze / document:upload (حدّ ٤٠) | لا | extractDocument (DeepSeek)، ثمّ matchSupplier، ثمّ runPipeline | لا يكتب شيئاً | «يقرأ المستند ويستخرج حقوله…» | بطاقة | `res.json()` :355، ونصّ `e.message` خام :391 | الملفّ نفسه مرّتين = ندائان للنموذج | — | لا | مرجع OPS-003 | |
| 55 | /upload | حقول «التاريخ» و«رقم الفاتورة» و«الضريبة» و«الإجمالي» | uploader.tsx:653-678 | تعديل قبل الحفظ | editField | — | — | — | — | الصافي لا يُعدَّل، ويُرسَل من القراءة الأولى :438 | — | — | — | — | — | — | مشتبَه (القسم ٨) | |
| 56 | /upload | قائمة المورّد | uploader.tsx:238 | اختيار | onChoose | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 57 | /upload | «مورّد جديد…» ثمّ «أنشئه» أو «إلغاء» | uploader.tsx:290,275,282 | ينشئ مورّداً | create :207 | POST /api/supplier | supplier / supplier:edit، والصفحة لا تتحقّق، فمدير المشتريات يرى الزرّ | لا | supplier/route.ts:70-103: يبحث بالاسم ثمّ insert suppliers وalias | ينشئ أو يعيد القائم | «…» | يُختار المورّد | `res.json()` :218، ونصّ `e.message` | معطَّل | لا | SUPPLIER_CREATED | BTN-008 · مرجع OPS-003 | |
| 58 | /upload | حقل «الاسم الجديد» | uploader.tsx:706 | اسم الملفّ | editField | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 59 | /upload | «أكّد وارفع / أعد المحاولة» | uploader.tsx:753 | يرفع ويؤرشف | archive :405 | POST /api/archive (base64) | archive / document:upload (حدّ ٦٠) | لا | assertNotDuplicate، assertMonthOpen، reviewForArchive (يعيد اشتقاق الضريبة)، archiveToDrive، ثمّ في معاملة: documents وinvoices وlines وstatements وpayments وissues | يرفع ويقيّد | شريط تقدّم و«يرفع…» والزرّ معطَّل، ومهلة ١٢٠ ثانية | ينتقل إلى «رُفع في هذه الجلسة» مع refresh | `json.error`؛ ورسالة عربيّة للمهلة؛ وغير ذلك `e.message` :496؛ و`res.json()` :453 | `archiving` يمنع، و`documents_sha_uniq` في القاعدة | لا ردّ من الواجهة | DOCUMENT_ARCHIVED | سليم في المال · مرجع OPS-003 | |
| 60 | /upload | «مسح» | uploader.tsx:595 | يمسح القائمة | setItems([]) | — | — | — | — | يرمي قراءاتٍ دُفع ثمنها بلا تأكيد | — | — | — | — | — | — | BTN-022 | |
| 61 | /upload | «افتحه» (ما رُفع) | uploader.tsx:575 | الدرايف | a | — | — | — | — | يفتح | — | — | — | — | — | — | سليم | |
| 62 | /upload | «افحص الدرايف عن ملفات جديدة» | drive-sync.tsx:236 | يفحص | call(false) :102 | POST /api/drive-sync `{apply:false}` | drive-sync / document:upload (بلا حدّ) | لا | قراءة الدرايف | يقرأ فقط | «يفحص الدرايف…» | ملخّص | يقرأ الردّ نصّاً :121 ✓ | الأزرار مخفيّة أثناء الانتظار | — | لا | سليم | |
| 63 | /upload | خانة «افحص الأرشيف كله…» | drive-sync.tsx:260 | نطاق الفحص | useState | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 64 | /upload | «سجّل الجديد وسمِّه / أكمل الباقي» | drive-sync.tsx:399 | يسجّل ويسمّي | call(true)، ثمّ applyRenames تلقائياً :219 | POST /api/drive-sync `{apply, readContent}`، ثمّ /api/drive-rename `{apply, fileIds: كلّ المقترَح}` | document:upload | لا | drive-sync/route.ts:446-455 يستدعي renameFile **قبل التقييد**، بلا قيد تدقيق لكلّ ملفّ | يسمّي في الدرايف بلا اختيار ملفٍّ ملفّاً | «يسجّل الجديد ويقرأه ويوحّد اسمه…» | ملخّص مع refresh | يقرأ نصّاً ✓ | مخفيّ أثناء الانتظار | لا | DRIVE_SYNCED بلا أسماء الملفّات | BTN-005 (مرجع SEC-003) | |
| 65 | /upload | «أعد المحاولة» (التسمية) | drive-sync.tsx:342 | يعيد التسمية | applyRenames :77 | POST /api/drive-rename | document:upload | لا | renameFile | يسمّي كلّ المقترَح | «يوحّد…» | رسالة | نصّاً ✓ | معطَّل | لا | DOCUMENT_ARCHIVED/drive | BTN-005 | |
| 66 | /upload | «أعد الفحص» · «إغلاق» | drive-sync.tsx:392,250 | فحص أو إغلاق | call(false) | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 67 | /upload | «افحص تسمية الأرشيف» | drive-rename.tsx:90 | معاينة | scan :56 | POST /api/drive-rename `{}` | drive-rename / document:upload | لا | load() ثمّ canonicalName | يقرأ فقط | «يفحص…» | قائمة | نصّاً ✓ | — | — | لا | سليم | |
| 68 | /upload | خانات اختيار الملفّات | drive-rename.tsx:160 | اختيار ملفٍّ ملفّاً | toggle | — | — | — | — | كلّها مختارة سلفاً :63 | — | — | — | — | — | — | BTN-023 | |
| 69 | /upload | «أعد تسمية المختار (N)» | drive-rename.tsx:197 | يسمّي المختار | apply :72 | POST `{apply, fileIds}` | document:upload | لا | الخادم يعيد اشتقاق الاسم :159، ثمّ renameFile وupdate documents | حتى ٢٥ ملفّاً في الطلب | «يعيد التسمية…» | رسالة، refresh، ثمّ فحص من جديد | نصّاً ✓ | معطَّل | لا | DOCUMENT_ARCHIVED بالاسمين | سليم | |
| 70 | /upload | «أعد الفحص» · «إغلاق» | drive-rename.tsx:206,110 | — | scan | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 71 | /money | بطاقات HubGrid: /bank، /purchases/invoices، /performance، /attention، /close «افتح القائمة»، /money/statement «اعرضها» | money/page.tsx:60-112 | الأقسام | Link | — | bank:view | — | — | ينتقل | — | — | — | — | — | — | سليم (مرجع UX-002) | |
| 72 | /money | الرقم الكبير ← /bank، و«من أين جاء؟» | money/page.tsx:129 | التفصيل | Figure | — | — | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 73 | /bank | بطاقة «مجهولة أو متقاربة المرشّحين» | bank/page.tsx:292 | الطابور | Stat href /review | — | bank:view | — | — | ينتقل | — | — | — | — | — | — | مرجع UX-001 | |
| 74 | /bank | بطاقة «فواتير مفتوحة» ← /payments | bank/page.tsx:299 | الفواتير المفتوحة (١٦) | Stat href | — | — | — | — | /payments يعرض الشهر المنقضي وحده، فالعددان يختلفان | — | — | — | — | — | — | BTN-012 | |
| 75 | /bank | «تخطّها الآن» | reconcile-queue.tsx:260 | يؤجّل المجموعة | next :159 | — | — | — | — | يؤجّلها محلياً ولا يُحفظ | غير معطَّل أثناء الانتظار | — | — | — | — | — | سليم | |
| 76 | /bank | «أظهر الـN كلّها / اطوِ» | reconcile-queue.tsx:306 | يبسط | useState | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 77 | /bank | «هذه هي» | reconcile-queue.tsx:346 | يقبل فاتورة | acceptCandidate :196 | POST /api/match-confirm `{transactionId, invoiceIds}` | match-confirm / payment:approve، وغير مخفيّ | لا | route.ts:250-343 | **لا يظهر أبداً**: `candidates` لا تُملأ في bank/page.tsx:195-211 | — | — | — | — | — | — | BTN-006 (زرّ ميّت) | |
| 78 | /bank | «ليست سداد فاتورة — دفعة مقدَّمة» | reconcile-queue.tsx:357 | يقيّد دفعة مقدَّمة | markNotAPayment :200 | POST `{notAPayment:"ADVANCE"}` | payment:approve | لا | route.ts:108-163 | لا يظهر للسبب نفسه | — | — | — | — | — | — | BTN-006 | |
| 79 | /bank | «سدِّد على حساب المورّد — بالأقدم أوّلاً» | reconcile-queue.tsx:384 | يقيّد المجموعة على حسابه | settleAccount :211 | POST /api/match-confirm `{transactionIds, settleSupplier}` | payment:approve، وغير مخفيّ | لا | settleAccounts :504: معاملةٌ للمجموعة، ثمّ findPaymentTwin وcreatePayment وallocate، و**update بلا شرط `is null`**، ثمّ decision_history | كما يعد، مع نافذة ٧ أيّام لا يذكرها سطر «سيُخصَّص» | «يقيّد…» والزرّ معطَّل | الرسالة، refresh، ثمّ التالي | readBody ✓ مع رمز الحالة | الواجهة تعطّل، والخادم لا يحرس | match-undo لكلّ حركة | INVOICES_MARKED_PAID/supplier | BTN-008 · BTN-017 (مرجع FIN-008) | |
| 80 | /bank | أزرار الأبواب العشرة | reconcile-queue.tsx:425 | اختيار الباب | setKind | — | — | — | — | غير معطَّلة أثناء الانتظار | — | — | — | — | — | — | سليم | |
| 81 | /bank | قائمة «أيّ مورّد؟» وحقل «اسم الجهة (اختياريّ)» | reconcile-queue.tsx:443,459 | إدخال | useState | — | — | — | — | الاسم الافتراضي `beneficiaryRaw` من الوصف المعياري :204 | — | — | — | — | — | — | سليم | |
| 82 | /bank | «أكّد وانتقل / أكّد — وطبّقها على N» | reconcile-queue.tsx:470 | يحفظ الجهة ويطبّقها ويعمّ | confirm :242 | POST /api/counterparty | counterparty / bank:edit | لا | counterparty/route.ts:166-247 وconfirmCounterparty | **يسقط**: جهةٌ جديدة دائماً، والكتابة من اتّصالٍ خارج المعاملة ← انتهاك المفتاح الأجنبيّ | «يحفظ…» | — | «تعذّر الحفظ: insert or update on table…» بالإنجليزية | معطَّل | لا ردّ للتعريف | SUPPLIER_ALIAS_LEARNED يُكتب ولو أُلغيت المعاملة | BTN-001 (مرجع SCN-001/OPS-001) · BTN-002 · BTN-014 | |
| 83 | /bank | «لماذا؟ / أخفِ السبب» | match-explain.tsx:92 | الأدلّة | useState | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 84 | /bank | «تراجع عن المطابقة» ← «أكّد التراجع» / «إلغاء» | match-explain.tsx:145,159,167 | «تُحذف الدفعة» | undo :57 | POST /api/match-undo | match-undo / bank:edit | لا | معاملة: update bank_transactions، ثمّ reversePayment بحالة REVERSED، ثمّ decision_history | **يردّ الدفعة ولا يحذفها** | «يُفكّ…» | الرسالة مع refresh | `res.json()` :66، و«تعذّر الاتصال بالخادم» لكلّ رمية | معطَّل، والثاني يُردّ 409 | — | ✓ قبل وبعد | BTN-013 · مرجع OPS-003 | |
| 85 | /bank | منطقة «اختر ملف كشف الحساب» | bank-import.tsx:312 | معاينة لا تحفظ | send(f,false) :250 | POST /api/bank-import multipart | bank-import / bank:edit (حدّ ١٢) | لا | التحليل ثمّ المزامنة ثمّ المطابقة؛ والمعاينة تعود قبل أيّ كتابة :435 | لا كتابة | «يقرأ الكشف…» | معاينة | `res.json()` :258، ونصّ `e.message` خام :269 | — | — | لا | مرجع OPS-003 · مرجع SCN-014 | |
| 86 | /bank | قائمتا التصنيف والمورّد، وحقل «النصّ المميِّز» | bank-import.tsx:150-179 | إدخال | useState | — | — | — | — | — | — | — | — | — | — | — | سليم | |
| 87 | /bank | «صنّفها» | bank-import.tsx:181 | قاعدة تسري على المشابه | save :111 | POST /api/bank-rule | bank-rule / bank:edit | لا (نمط ≥ ٣ أحرف) | upsert على `bank_rules.normalized`، و**يستبدل القاعدة القائمة بصمت**، ويضيف اسماً بديلاً | لا يُطبَّق على الحركة حتى «أعد المطابقة» | «يحفظ…» | «✓» | `res.json()` :124، ونصّ `e.message` خام | معطَّل | لا حذف للقاعدة في الواجهة | SUPPLIER_ALIAS_LEARNED/bank_rule | BTN-030 · مرجع OPS-003 | |
| 88 | /bank | «أعد المطابقة بالأسماء الجديدة» | bank-import.tsx:532 | معاينة جديدة | send(false) | POST | bank:edit | لا | — | يعيد المعاينة | «يعيد المطابقة…» | — | كما سبق | معطَّل | — | لا | سليم | |
| 89 | /bank | «اعتمد وطابِق» | bank-import.tsx:563 | يكتب الجديد ويطابق | send(f,true) | POST apply=true | bank:edit | لا | bank_imports بـonConflictDoNothing، وقيد الهويّة الفريد، والكتابة من `planned` وحده | يقيّد الجديد | «يطبّق…» والزرّ معطَّل | نصّ الواجهة «طوبقت N…» لا رسالة الخادم، مع refresh | `res.json()` ونصّ `e.message` | معطَّل، وقيد القاعدة | match-undo لكلّ حركة | BANK_IMPORTED | مرجع SCN-014 | |
| 90 | /bank | «أعلن سدادها يدوياً» ← إقرار ← «أعلن سدادها» | bank-import.tsx:595 | يسِم الفواتير المدفوعة نقداً | markPaid :275 | POST /api/mark-paid `{throughMonth: الشهر الجاري}` | payment:approve، وغير مخفيّ | لا | mark-paid/route.ts:59-117 | يسِم **كلّ** المفتوح: ١٦ فاتورة بـ١٨٬٤٤٧٫٦٥ ريالاً، بطريقة BANK_TRANSFER | «يُنفَّذ…» | markResult مع refresh | `res.json()` ونصّ `e.message` | ConfirmAction يعطّل | لا مسار ردّ | INVOICES_MARKED_PAID/payment_run | BTN-003 · BTN-008 | |
| 91 | /review | «أكّد N» (جماعيّ) | review-workspace.tsx:295 | يؤكّد الاقتراحات | confirmAll :199 | POST /api/match-confirm-bulk `{transactionIds ≤50}` | payment:approve، ومخفيّ بـcanApprove | لا | runReconciliation من جديد، ثمّ معاملة لكلّ حركة | يكتب ما بلغ الحسم وحده | «يُعاد الحساب…» | ok = confirmed>0، والمردود بأسبابه، مع refresh | `res.json()` :213، فأيّ 500 يصير «تعذّر الاتصال» | معطَّل، وشرط `is null` دون فحص عدد الصفوف | match-undo | INVOICES_MARKED_PAID bulk | مرجع OPS-003 · BTN-017 | |
| 92 | /review | «أكّد» (صفّ) | review-workspace.tsx:514 | يؤكّد اقتراحاً | confirmOne :181 | POST match-confirm-bulk بمعرّفٍ واحد | payment:approve | لا | كما سبق | كما يعد | «يُعاد الحساب…» | «أُكِّدت» والصفّ يُطوى | يفرّق الشبكة ✓، و`confirmed:0` يُعلَن ✓ | `rowBusy` واحد لكلّ الصفوف | match-undo | ✓ | BTN-018 | |
| 93 | /review | «قيّدها على حسابه» | review-workspace.tsx:504 | سداد على الحساب | settleOne :193 | POST match-confirm `{settleSupplier}` | payment:approve | لا | settleAccounts | كما الصفّ 79 | «يُقيَّد…» | «قُيِّدت على حسابه» | ✓ | لا حارس في الخادم | match-undo | ✓ | BTN-017 (مرجع FIN-008) | |
| 94 | /review | «ليست سداداً» ← «تحويل داخلي» / «تحويل شخصي» / «رسم بنكيّ» | review-workspace.tsx:523,566 | ليست سداداً | rejectOne :184 | POST match-confirm `{notAPayment}` | payment:approve | لا | معاملة: IGNORED وCONFIRMED، ثمّ decision_history | كما يعد | معطَّل | «حُفظت: …» | ✓ | يُكتب ثانيةً بلا ضرر ماليّ | لا ردّ في الواجهة | INVOICES_MARKED_PAID (اسم فعلٍ غير الواقع) | BTN-031 | |
| 95 | /review | «عرِّف هذه الجهة» ← الأبواب ← «أكّد التعريف» | review-workspace.tsx:536,589,602 | تعريف الجهة | defineOne(id, kind, description.slice(0,60)) :196 | POST /api/counterparty | bank:edit، ومخفيّ بـcanEdit | لا | كما الصفّ 82 | يسقط (المفتاح الأجنبيّ)، و«سداد مورّد» بلا مورّد يُردّ 400 | «يُحفظ…» | — | نصّ الخادم | — | — | قيد تدقيق يتيم | BTN-001 · BTN-007 | |
| 96 | /review | «افتحها في البنك ←» | review-workspace.tsx:547 | الحركة نفسها | Link /bank | — | — | — | — | يفتح أعلى الصفحة | — | — | — | — | — | — | BTN-019 | |
| 97 | /review | «أظهر N أخرى» | review-workspace.tsx:414 | الباقي | setShown | — | — | — | — | يوسّع ٤٠ | — | — | — | — | — | — | سليم | |
| 98 | /payments | «نزّل ملف التحويلات» | payments/page.tsx:107 | ملفّ CSV | `a href` | GET /api/payment-run?month | payment-run / payment:approve | الشهر بتعبير نمطي | buildPaymentRun ثمّ CSV | ينزّل | — | تنزيل | الخطأ يُعرض صفحة JSON خام | — | — | لا تدقيق للتصدير | BTN-024 | |
| 99 | /payments | «سجّل أنّها سُدِّدت» ← «أكّد السداد» / «تراجع» | payment-run-actions.tsx:84,98,101 | يسجّل سداد المورّد | markPaid :37 | POST /api/mark-paid `{invoiceIds, note}` | payment:approve | لا | كما الصفّ 30 | كما يعد، لكنّ جملة «ولا يُنشئ سداداً ثانياً» لا تصدق (BTN-003) | «يُسجَّل…» | refresh | `res.json()` :49، فأيّ 500 يصير «تعذّر الاتصال» | معطَّل، والقاعدة | لا | ✓ | مرجع OPS-003 · BTN-009 · BTN-003 | |
| 100 | /payments | «رسالة واتساب جاهزة» | payments/page.tsx:198 | واتساب | a | — | — | — | — | يفتح | — | — | — | — | — | — | سليم | |
| 101 | /money/expenses | أزرار الأشهر | expenses/page.tsx:109 | ترشيح | `a` | GET | — | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 102 | /money/expenses | «اشتقّ من كشف البنك / اشتقّ من كشف M» | derive-expenses.tsx:46 | قيد المصروف | run :18 | POST /api/expense-actual `{derive, month}` | expense-actual / expense:edit | لا | deriveExpensesFromBank مع فهرسٍ فريد | قابل للتكرار بلا ضرر | «يشتقّ…» | الرسالة مع refresh | `res.json()` :28 | معطَّل، والفهرس الفريد | لا (الحذف بلا زرّ) | لم يُتحقَّق | مرجع OPS-003 · BTN-016 | |
| 103 | /money/expenses | «صنّفها سداد مورّد» | expense-reclassify.tsx:121 | يصنّف ويعمّ | fix :45 | POST /api/counterparty `{SUPPLIER, supplierId}` | bank:edit | لا | كما الصفّ 82 | يسقط (المفتاح الأجنبيّ) | «يحفظ…» | «✓» مع refresh | نصّاً ✓ | معطَّل | — | قيد يتيم | BTN-001 | |
| 104 | /money/expenses | «أو افتحها في البنك ←» | expense-reclassify.tsx:130 | الحركة | `a /bank#tx-id` | — | — | — | — | المرساة موجودة لآخر ٢٥ حركة فقط (bank/page.tsx:346) | — | — | — | — | — | — | BTN-019 | |
| 105 | /close | قائمة الشهر | month-close.tsx:122 | يفحص فوراً | call("check") | POST /api/month-close `{check}` | month-close / month:close | الشهر بتعبير نمطي | gatherMonthFacts | يقرأ فقط | «يفحص الشهر…» | التقرير | `res.json()` :99، ونصّ `e.message` خام :108 | سباق بين شهرين | — | لا | مرجع OPS-003 | |
| 106 | /close | «أعد الفحص» | month-close.tsx:135 | فحص | call | POST | month:close | — | — | يقرأ | «يفحص…» | — | كما سبق | معطَّل | — | لا | سليم | |
| 107 | /close | حقل «سبب الإقفال مع التنبيهات» | month-close.tsx:200 | ملاحظة | useState | — | — | — | — | تُحفظ في التدقيق | — | — | — | — | — | — | سليم | |
| 108 | /close | «أقفل M» ← إقرار ← «أقفل M» | month-close.tsx:214 | إقفال الشهر | call("close") | POST `{close, note}` | month:close | لا | insert أو update على month_closes (فهرس فريد) | يمنع الأرشفة وحدها | «يُنفَّذ…» | الرسالة مع refresh | الرسالة، واللوح يُغلق | ConfirmAction، و409 «مقفل بالفعل» | «أعد فتح الشهر» | MONTH_CLOSED | مرجع SCN-015 · BTN-018 | |
| 109 | /close | «أعد فتح الشهر» ← «افتح M» | month-close.tsx:254 | فتح الشهر | call("reopen") | POST | month:close | لا | update إلى OPEN | يفتح | «يُنفَّذ…» | ✓ | 409 إن لم يكن مقفلاً | معطَّل | الإقفال من جديد | ✓ قبل وبعد | سليم | |
| 110 | /close | (زرّ غائب) رابط إصلاح لكلّ مانع | month-close.tsx:173 (نصّ «الخطوة التالية» وحده) | — | — | — | — | — | month-close.ts:24 (`action` نصّ لا `href`) | — | — | — | — | — | — | — | BTN-015 | |
| 111 | /settings | بطاقات «المورّدون» /suppliers، و«قواعد التصنيف» /bank، و«سجل التدقيق» | settings/page.tsx:62-96 | ينتقل | Link | — | supplier:view | — | — | القواعد لا تُرى ولا تُحذف في /bank | — | — | — | — | — | — | سليم | |
| 112 | /settings | بطاقات معطَّلة: «قارئ المستندات» و«المستخدمون» و«هجرات القاعدة»، ورابط «docs/ARCHITECTURE.md» ← /settings | settings/page.tsx:75-101,160 | الوثيقة | Link /settings | — | — | — | — | البطاقات بلا `disabledReason`، والرابط يعيد الصفحة نفسها | — | — | — | — | — | — | BTN-028 | |
| 113 | /settings | حقول «اسم المصروف» و«المبلغ» و«الدورة» و«التصنيف»، وزرّ «أضِف» | recurring-expenses.tsx:103-141 | يضيف مصروفاً متوقَّعاً | send create :39 | POST /api/expense | expense / expense:edit، والصفحة تشترط supplier:view فمدير المشتريات يرى الزرّ | parseRiyals (يقبل الأرقام العربية) | insert على recurring_expenses | يضيف | «…» | «✓» مع refresh | `res.json()` :48، ونصّ `e.message` خام :57 | معطَّل، ولا منع لتكرار الاسم | «عطّله» | EXPENSE_ADDED | BTN-008 · مرجع OPS-003 | |
| 114 | /settings | «عطّله» | recurring-expenses.tsx:84 | يعطّل المصروف | send delete | POST `{delete}` | expense:edit | لا | update is_active=false | يعطّل بلا تأكيد | الكلّ معطَّل | الرسالة | كما سبق | معطَّل | **لا إعادة تفعيل** | EXPENSE_REMOVED | BTN-016 | |
| 115 | /settings/audit | «السابق» · «التالي» | settings/audit/page.tsx:129,134 | الصفحات | `a` | GET | audit:view | — | — | ينتقل | — | — | — | — | — | — | سليم | |
| 116 | /analysis · /money/statement · /audit · /dashboard | لا عنصر تفاعليّ غير القشرة (والأخيرتان تحويلٌ دائم) | — | — | — | — | — | — | — | — | — | — | — | — | — | — | سليم | |

## واجهات لا يستدعيها زرّ

بحثتُ عن مسار كلّ واجهة نصّاً في `src/components` و`src/app` و`scripts`.

| الواجهة أو الفرع | من يستدعيها | الحال | الدليل |
|---|---|---|---|
| `POST /api/supplier-alias` | لا أحد | **ميّتة**. زرّها أُزيل في `5558df9` (٢٠٢٦-٠٩-٠٤) حين صار `/api/bank-rule` يكتب الاسم البديل | `git log -S"/api/supplier-alias" -- src/components` ← `fd74ef4` أضافه و`5558df9` أزاله |
| `GET /api/health` | المراقبة الخارجية (docs/SETUP.md) | مقصودة، وعامّة في middleware.ts:11 | — |
| `GET /api/ops/db-identity` | scripts/check-isolation.ts وscripts/production-gate.ts | مقصودة (نصّ تشغيل) | grep |
| `/api/auth/[...nextauth]` | signIn وsignOut | مقصودة | login/page.tsx:62 · user-menu.tsx:17 |
| `POST /api/match-confirm` بفرع `split` (توزيع يكتبه صاحب العمل) | لا أحد | **فرعٌ ميّت** | route.ts:240 وapplyManualSplit :375؛ لا شاشة ترسل `split` |
| `POST /api/match-confirm` بفرعي `invoiceIds` و`notAPayment:"ADVANCE"` | reconcile-queue فقط، داخل كتلةٍ لا تظهر | **لا يُبلَغ من الواجهة** | BTN-006 |
| `POST /api/expense-actual` بفعلي `record` و`delete` | لا أحد | فعلان ميّتان: لا قيد مصروفٍ يدويّ ولا حذف | route.ts:61-94؛ derive-expenses.tsx يرسل `derive` وحده |
| `POST /api/product` بفعل `unlink` | لا أحد | فعلٌ ميّت | route.ts:49 |
| `POST /api/mark-paid` بنطاق `supplierId` | لا أحد | فرعٌ ميّت | route.ts:52 |
| `POST /api/counterparty` بحقل `counterpartyId` | لا أحد | حقلٌ ميّت، ومنه أنّ الجهة تُنشأ جديدةً دائماً | BTN-001 · BTN-014 |
| `POST /api/drive-rename` | drive-sync.tsx:81 تلقائياً، وdrive-rename.tsx:42 باختيار | موصولة | BTN-005 |

## ملخّص كلّ صفحة

| الصفحة | العناصر | سليم | غير سليم (المعرّفات) |
|---|---|---|---|
| قشرة (٢١ صفحة) | 9 | 7 | BTN-004 · BTN-021 · BTN-012 |
| /login | 1 | 1 | — |
| / | 11 | 9 | BTN-032 ×2 |
| /attention | 4 | 4 | (BTN-025 عبر الوجهة) |
| /analysis · /money/statement · /audit · /dashboard | 0 | — | — |
| /performance | 1 | 1 | — |
| /purchases | 1 | 0 | مرجع UX-002 |
| /purchases/invoices | 8 | 6 | BTN-020 · BTN-009 · BTN-008 · BTN-027 |
| /purchases/products | 5 | 1 | BTN-010 · OPS-003 |
| /suppliers | 2 | 1 | UX-003 |
| /suppliers/[slug] | 4 | 1 | BTN-032 ×2 · UX-003 |
| /statements | 5 | 3 | BTN-011 · BTN-029 |
| /documents | 5 | 4 | BTN-025 (غائب) |
| /upload | 17 | 12 | BTN-005 · BTN-008 · BTN-022 · BTN-023 · مشتبَه |
| /money | 2 | 2 | — |
| /bank | 17 | 6 | BTN-001 · BTN-002 · BTN-003 · BTN-006 · BTN-008 · BTN-012 · BTN-013 · BTN-017 · BTN-030 |
| /review | 7 | 1 | BTN-001 · BTN-007 · BTN-017 · BTN-018 · BTN-019 · BTN-031 |
| /payments | 3 | 1 | BTN-024 · BTN-003 · BTN-009 |
| /money/expenses | 4 | 1 | BTN-001 · BTN-016 · BTN-019 |
| /close | 6 | 3 | BTN-015 · BTN-018 · SCN-015 |
| /settings | 4 | 1 | BTN-008 · BTN-016 · BTN-028 |
| /settings/audit | 1 | 1 | — |
