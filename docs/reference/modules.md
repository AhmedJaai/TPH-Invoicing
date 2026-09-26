# الوحدات التي يجب معرفتها

أين يقع كلُّ عمل. ابحث هنا قبل أن تكتب دالّةً قد تكون موجودة.

| الملف | مسؤوليّته |
|---|---|
| `src/lib/confirm.ts` | `reviewConfirmed()` — **الخادم** يعيد اشتقاق حال الضريبة. لا يُصدَّق المتصفّح في رقم مالي. |
| `src/lib/line-pricing.ts` | `resolveLinePricing()` / `reconcileInvoiceLines()` — قلب صحّة الأسعار |
| `src/lib/allocation.ts` | `planAllocations()` يمنع تخصيص أكثر من الدفعة · `settleSupplierAccount()` سياسة الأقدم أوّلاً |
| `src/lib/bank/identity.ts` | بصمةُ الملفّ (اختصارٌ لا هويّة) ومراجعُ العمليّة — لا خوارزميّةَ هويّةٍ هنا |
| `src/lib/bank/pattern.ts` | هويّات الحركة مرتَّبةً، والنمط آخرها — وبها يُجمَع المتشابه |
| `src/lib/bank/sync.ts` | **أهي عندنا؟** مرجعُ العمليّة ثمّ الوقائع — قبل أن يُسأل ما معناها |
| `src/lib/bank/rules.ts` | تصنيف الحركات. **GOVERNMENT قبل ZAKAT** وإلّا قُرئت «زاتكا» صدقةً |
| `src/lib/bank/canonical.ts` | نموذج الحركة المعياريّ — المرجع يُنسب إلى نوعه بدليل |
| `src/lib/bank/classification.ts` | تصنيف بطبقات: البنية ← المتعلَّم ← الكلمات ← المجهول يُعلَن |
| `src/lib/bank/entities.ts` | تعريف المستفيد بأدلّة قاطعة وظنّية — والظنّيّ وحده لا يكفي |
| `src/lib/bank/candidates.ts` | توليد المرشّحين وتسجيلهم · مجموع الجزئيات بلا سقف ثلاث |
| `src/lib/bank/optimizer.ts` | تفريعٌ وتحديد: أعلى **مجموع** لا أعلى درجة. وميزانيّة عقد، فإن نفدت رجع للجشع وأعلن `exact: false` |
| `src/lib/bank/coverage.ts` | فجوات التغطية — الغائب لا يُرى فيجب أن يُحسَب |
| `src/lib/bank/balance-equation.ts` | **افتتاحي + وارد − صادر = ختامي.** وهذه التسوية؛ وعدُّ المطابقات ليس تسوية |
| `src/lib/bank/lifecycle.ts` | طبقات الحركة: خام ← مُستنتَجة ← مقترَحة ← مُقَرَّة ← مُقيَّدة · و`detectAnomalies` موصولةٌ ببندٍ في «يحتاج انتباهك» |
| `src/lib/bank/review-queue.ts` | ثلاثة أعمالٍ لا عملٌ واحد: يُقَرّ · يُراجَع · يُحسَم |
| `src/lib/bank/evidence-uniqueness.ts` | القاطع يُحتكَر ويُعلَن تضاربه، والظنّيّ يُشترَك — والاسم ليس هويّة |
| `src/lib/bank/supplier-profile.ts` | عادةُ سداد المورّد — ترجّح ولا تحسم، ولا تُبنى على أقلّ من خمس سابقات |
| `src/lib/bank/vision-statement.ts` | الكشف المصوَّر: كلّ مبلغٍ يُفحَص، والمعادلةُ تردّ الكشف كلّه إن اختلّت |
| `src/lib/bank/metrics.ts` | أنتحسّن أم نسوء — ويُحسَب على ما فعله الإنسان وحده |
| `src/lib/bank/parsers/adapters.ts` | محوِّل لكل بنك، و`verified` يُعرَض للمستخدم لا يُدفَن في تعليق |
| `src/lib/payment-state.ts` | سبعُ حالاتٍ للدفعة — والمردودة لا تُحسَب مدفوعة |
| `src/services/payment.service.ts` | `createPayment` يسأل التوأم ويرمي ما لم يُقَرّ · `recordBankPayment` يتبنّى المقيَّد بلا حركة · `claimBankTransaction` يربط بشرط ألّا تكون مربوطة ويرمي |
| `src/lib/unit-conversion.ts` | لا جسر بين وزنٍ وحجم، والمجهول لا يُحوَّل · و`StoredUnit` جسرُ عمود القاعدة (`G`/`L`) إلى `BaseUnit` (`GRAM`/`LITER`) — في موضعٍ واحد |
| `src/lib/bank/fees.ts` | الرسم البنكيّ داخل الدفعة — والنقص سدادٌ جزئيّ لا رسم |
| `src/lib/bank/reversal.ts` | ما خرج ثمّ عاد — لا إيراد ولا تحويل داخليّ · موصولةٌ ببند «حوالةٌ لمورّد خرجت ثمّ عادت» في `attention-facts.ts` (سداد مورّد فوق الريال وحده) |
| `src/lib/credit-notes.ts` | الإشعار الدائن يخفض المستحقّ ولا يُعدّ سداداً · **موصولةٌ نصفَ وصل** — لا يُمرَّر لها إشعار |
| `src/services/adjudicator.service.ts` | استدعاء الحَكَم — وحكمه اقتراحٌ لا مطابقة |
| `src/lib/bank/adjudicate.ts` | متى يُستدعى الذكاء: عند العجز وحده، وعلى مرشّحين مولَّدين لا بيانات خام |
| `src/lib/bank/parsers/detect.ts` | كشف البنك من الملفّ — و`\b` لا تفصل عند `_` وأسماء الملفّات مليئة بها |
| `src/lib/bank/parsers/pdf-text.ts` | نصّ PDF ومواضعه — ولا يُرمى ملفٌّ كامل إلى نموذج |
| `src/lib/ai/models.ts` | النموذج يتبع المهمّة — وموضعٌ واحد لأسمائها، فلا سلسلةٌ حرفيّة تُكتب مرّةً ولا يُسأل عنها |
| `src/lib/ai/deadline.ts` | `withDeadline` — المسار يعلن عمره، وكلّ محاولة نداءٍ تأخذ ما بقي منه. **مسارٌ جديد يستدعي الذكاء يُلفّ بها** |
| `src/lib/ai/deepseek.ts` | النداء: مهلةٌ معلَنة، وإعادةٌ على العابر وحده، و**عطبٌ مصنَّف** — الرصيد الناضب غير انقطاع الشبكة |
| `src/lib/ai/document-input.ts` | كيف يبلغ المستندُ النموذج: نصّاً يُقرأ حسابياً، أو صورةً تُنتزَع، أو **لا يُقرأ فيُعلَن** |
| `src/lib/ai/pdf-images.ts` | ينتزع JPEG المضمَّن — الماسح وضعه في الملفّ كما هو، فلا يُرسَم ولا تُضاف حزمة |
| `src/lib/extraction/provider-deepseek.ts` | قراءة المستند على مرحلتين، والمخطّط في الموجِّه لأنّ المزوّد لا يفرضه |
| `src/lib/extraction/validate-extraction.ts` | أقرأ النموذجُ صحيحاً؟ — سؤالٌ غير «أهذه الفاتورة سليمة؟»، وجوابُه يُعيد السؤال موجَّهاً |
| `src/lib/extraction/schemas-by-kind.ts` | مخطّط لكل نوع مستند — لا ثلاثون حقلاً لفاتورةٍ فيها ستّة |
| `src/lib/extraction/statement-extras.ts` | أسطر الكشف ورصيداه من مخرَج النموذج الخام — والرصيد المجهول `null` لا صفر |
| `src/lib/extraction/benchmark.ts` | مقياس النماذج — **الخطأ الواثق** يسبق الدقّة · **لا تصل إليها شاشة** |
| `src/lib/extraction/versions.ts` | نسخ الموجِّه والمخطّط، والنماذج مثبَّتة لا عائمة |
| `src/services/counterparty.service.ts` | تأكيدٌ واحد يعمّ على أمثاله |
| `src/lib/bank/decision.ts` | تلقائيّ/اقتراح/مراجعة بقاعدة الهامش |
| `src/services/reconcile.service.ts` | الجسر: صفوف الكشف ← قرارٌ لكل حركة مع أدلّته |
| `src/lib/bank/match.ts` | ربط الحركة بمورّد — حدود الكلمات، لا احتواء نصّي |
| `src/lib/statement-match.ts` | مطابقة كشوف المورّدين |
| `src/lib/month-close.ts` | الإقفال: `BLOCK` يمنع، `WARN` لا يمنع |
| `src/lib/attention.ts` | كل تنبيه يحمل `href` (مكان الإصلاح) و`evidence` (لِمَ ظهر) |
| `src/lib/data-health.ts` | التغطية لا تُختلق؛ فيها حال `NOT_CONNECTED` |
| `src/lib/expenses.ts` | المصروف الفعلي. **سداد المورّد ليس مصروفاً** — محسوبٌ في المشتريات. وازدواجُ الحدث يُكشَف ولا يُحذَف |
| `src/lib/provenance.ts` | «من أين جاء هذا الرقم» — التغطية بالعدد لا بالمبلغ |
| `src/lib/arabic.ts` | تمييز العدد — القاعدة تدور عند المئة فلا تُكتب بالحدس. **ثلاثة عشر جدولاً، وكلُّ عددٍ في الواجهة يمرّ بها** |
| `src/components/ui.tsx` | **نظامُ التصميم الثاني**: بطاقة · قسم · زرّ · شارة · رقم · `Delta` · `Meter` · `Sparkline` · `BarList` · `Monogram` · `Callout` · `KeyValue` · `Timeline` · `Stepper` · `LinkTabs` · `DataTable` (بطاقاتٌ على الجوّال، رأسٌ ثابت فوق ١٥ صفّاً، بحثٌ داخله بـ`searchOf`، وJ/K). وأصنافُ الأزرار في `ui-tokens.ts` |
| `src/components/scroll-x.tsx` | يقيس الفيض ويرسم الحافّة على الجهة التي وراءها شيء — فالعلامة إن ظهرت صدقت |
| `src/lib/bank/pending.ts` | سؤالان لا سؤال: **من الجهة؟** و**أيّ فاتورة؟** — والثاني لا يُطوى بجواب الأوّل |
| `src/lib/bank/double-paid.ts` | مالٌ خرج مرّتين في اليوم لجهةٍ واحدة — يُطالَب به ولا يُصلَح في قيدنا |
| `src/components/review-workspace.tsx` | ثلاثة أبواب، ولكلّ بندٍ فعلُه: يُؤكَّد · ليس سداداً · تُعرَّف جهته |
| `src/components/ui-client.tsx` | `ConfirmAction` (الإقرارُ لما لا رجعة فيه أو يمسّ المال وحده) · `ActionButton` (ينتظر بعرضه ويقول «تمّ»، ولا ضغطةَ ثانية) · `Reveal` (الكشفُ في المكان، CSS وحده) · `Popover` (قرارٌ صغير بجانب ما يخصّه) · `LinkPending` · `toast({ undo })` والعارضُ الواحد في القشرة، يقف عدُّه تحت الفأرة · `Sheet` (حوارٌ أصليّ، ورقةٌ على الجوّال تُسحب لتُغلق) · `TableFilter` |
| `src/components/inspector.tsx` · `detail-frame.tsx` · `src/lib/inspector.ts` | **لوحُ الفحص**: ملفُّ المورّد والفاتورة والصنف وحركة البنك لوحاً فوق القائمة (`(app)/@drawer` مساراتٌ معترِضة)، وصفحةً كاملةً عند التحميل المباشر. الملفُّ واحد (`*-view.tsx`) بإطارين. `InspectorLauncher` يرسم الهيكلَ في إطار النقرة، و`useShellPath` مسارُ القائمة تحت اللوح للقشرة |
| `src/services/document-profile.service.ts` · `document-record.service.ts` · `/documents/file/[id]` | **ملفُّ المستند**: ما ينقصه وكيف قرّر النظام، و«أكمِل الناقص وقيّدها» بمعاينةٍ ثمّ قيد (`/api/document-record`) بالمسار نفسه — ويُعرف النسخةُ من فاتورةٍ مقيَّدة |
| `src/components/live-money.tsx` | المبلغُ الذي تغيّر بعد فعلٍ ينتقل إليه ويومض — لا في أوّل رسم |
| `src/lib/supplier-suggest.ts` · `src/components/supplier-picker.tsx` | «لعلّه هذا المورّد» من نصّ البنك: اقتراحٌ لا قرار، ومنتقٍ واحد لطابور البنك ومراجعة الحركات |
| `src/lib/preview-mode.ts` | وضع المعاينة — لا يعمل في الإنتاج مهما فُعِّل المتغيّر |
| `src/lib/canonical-name.ts` | الاسم القياسيّ من المقيَّد — ولا يُمَسّ اسمٌ يُقرأ |
| `src/lib/nav.ts` | **ثماني مساحاتٍ في ثلاث مجموعات** (اليوم · المال · التشغيل)، ولكلٍّ أيقونتُها وحرفُ `G` وسؤالُها. `entryHref` يفتح أوّلَ لسانٍ يملكه الدور، و`chordsFor` اختصاراتُ لوحة المفاتيح. الإعدادات في `ACCOUNT_LINKS` |
| `src/components/page-shell.tsx` · `nav.tsx` · `topbar.tsx` | القشرة: إطارٌ داكن، وشريطٌ علويّ (موضعك · بحث · إشعارات · رفع)، وشريطُ جوّالٍ بزرّ التقاطٍ في الوسط، و`DropAnywhere` للإفلات في أيّ صفحة |
| `src/lib/capture-queue.ts` | يحمل الملفّ من زرّ الكاميرا أو الإفلات في أيّ صفحة إلى القارئ في `/upload` |
| `src/components/keyboard.tsx` · `src/lib/ui-events.ts` | ⌘K · `G` ثمّ حرف · J/K/Enter · U · ? — وأحداثُ فتح اللوحة والقائمة بلا استيرادٍ دائريّ |
| `src/services/notifications.service.ts` · `/api/notifications` | **مركز الإشعارات والملخّص اليوميّ يُشتقّان ولا يُخزَّنان**؛ المخزَّن حدُّ القراءة (`users.notifications_seen_at`، 045) |
| `src/services/briefing.service.ts` | إحاطةُ الصباح: آخرُ رصيدٍ معروف (`null` مجهول)، وتقدّمُ الإقفال، والتحيّةُ بساعة الرياض |
| `src/services/payment-run.service.ts` | **دفعةُ الشهر من القاعدة في موضعٍ واحد** — للصفحة والملفّ والرئيسية والنقد القادم؛ ويقبل رصيداً ممرَّراً كي لا يُخصم مرّتين |
| `src/lib/cash-outlook.ts` · `cash-outlook.service.ts` | **النقد القادم** (`/cash`): الدفعتان والمتكرّرُ بيومه إن عُرف، والواردُ غير محسوب فالرصيدُ بعده حدٌّ أدنى |
| `src/services/mark-paid-undo.service.ts` · `/api/mark-paid/undo` | التراجعُ عن إقرار السداد من الإشعار: إلغاءٌ (`VOID`) لا حذف، خلال ثلاثين دقيقة، بلا حركة بنك، في شهرٍ مفتوح |
| `src/components/pay-run-planner.tsx` | مخطِّطُ الدفعة: اختيارٌ مورّداً مورّداً يغيّر المجموع والملفّ (`/api/payment-run?suppliers=`)، وما يبقى لكلٍّ بعده |
| `src/lib/accountant-pack.ts` · `/api/export/accountant` · `/close/pack` | **حزمةُ المحاسب**: Excel بستّ أوراق لشهرٍ واحد، وورقةٌ تُطبَع PDF بالأرقام نفسها (`summarize` · `vatByStatus` · `outflowByCategory` · `expensesByCategory`)، والمجهولُ «غير معروف» لا صفر. و«صادرٌ بلا تفسير» (`unexplained`) لا «لم يُطابَق»: رسومُ الشبكة مفسَّرةٌ ببابها |
| `src/lib/audit-kinds.ts` | أبوابُ سجلّ التدقيق بنمطٍ يقرؤه JavaScript وPostgres معاً، والتعلّمُ الآليّ مخفيٌّ افتراضاً |
| `src/lib/attention-triage.ts` | فرزُ «يحتاج قرارك»: الإشاراتُ في المال، وما يُحسم في موضعه، والمعلَّقُ بنوعه لا مجموعاً |
| `src/lib/layout-guards.test.ts` | الشبكةُ المتجاوبة لها عمودٌ أساسيّ صريح — العمودُ الضمنيّ `auto` يفيض على الجوّال |
| `scripts/ui-crawl.ts` | `npm run ui:crawl` — زاحفٌ يقرأ كلَّ صفحةٍ بأربعة أوجه ويُسقط على طريقٍ مسدود أو خطأ أو فيض |
| `src/lib/commands.ts` | **لوحةُ الأوامر تُشتقّ من `nav.ts` ولا تُنسَخ** — الأفعالُ (ارفع · استورد الكشف · أقفل الشهر · ابدأ الجرد…) والصفحات، مرشَّحةً بالصلاحية، ولا أمرَ إلى مسارٍ غير موجود (يحرسه اختباره) |
| `src/components/command-palette.tsx` | ⌘K · Ctrl+K · «/» — الأفعالُ والصفحاتُ فوراً والسجلّاتُ من `/api/search`، في `<dialog>` أصليّ يحبس التركيز ويُغلَق بـEscape. **لوحةٌ واحدة في القشرة ومداخلُ كثيرة** (`openCommandPalette`) |
| `src/services/payee-account.service.ts` | **حسابُ المستفيد في ملفّ التحويلات** من أدلّة الكشف القاطعة لجهةٍ أكّدها إنسان (`resolvePayeeAccount`): آيبانٌ واحد يُكتَب، واثنان سؤالٌ لا يُحسَم، والمجهولُ فارغٌ بتنبيه — والصفحةُ والملفّ من موضعٍ واحد |
| `src/lib/start.ts` · `src/services/start.service.ts` | **أيعرف النظامُ شيئاً بعد؟** — بلا مستندٍ ولا كشف لا تُعرض أصفارٌ ولا «سليم»: الرئيسيةُ «ابدأ من هنا» بخطواتها، والطابورُ والمالُ والبنكُ والإقفالُ يقولون ما ينقص |
| `src/lib/extraction/auto-archive.ts` | **متى يدخل ما قرأه النموذج وحده**: مورّدٌ معروف · فاتورةٌ مقيَّدة · حسابٌ مستقيم · قراءةٌ موثوقة (نصٌّ، أو صورةٌ يصدّقها شاهد). **يقرّر في المزامنة ويشرح في لوح المراجعة** |
| `src/lib/document-date.ts` | **التاريخُ كما كُتب** إلى `YYYY-MM-DD` — «13/09/2026» مقروءٌ لا غائب |
| `src/services/document-backlog.service.ts` | يقيّد فاتورةَ ما رُمي تاريخُه أو كشفَه **من قراءته المحفوظة** واسمِ ملفّه، ويقول ما نقص بعينه |
| `src/lib/extraction/filename-facts.ts` | **ما يقوله اسمُ الملفّ** حين يسكت النموذج: رقمُ الفاتورة والتاريخُ والمبلغ |
| `src/services/document-reread.service.ts` | **إعادةُ القراءة للزرّ وللاستدراك**: ما يستقيم يُكتَب، وما لا يستقيم يُقال بأرقامه ولا يُكتَب |
| `src/components/auto-process.tsx` | **الاستدراكُ والمزامنةُ يقعان وحدهما** — لا زرٌّ يُنتظَر |
| `src/services/drive-rename.service.ts` | **التسمية في موضعٍ واحد** — يدويّةً وآليّة، والآليّةُ لما أُرشِف وحده، وبالاسمين في السجلّ |
| `src/services/drive-status.service.ts` | حالُ الدرايف لصفحة `/documents/drive` وشارة «المستندات» والإشعارات: `loadDriveHeartbeat` · `loadDriveStatus` · `markDriveChecked/Failed` (046) · و`loadNamedDocuments` مصدرُ معاينة التسمية |
| `src/lib/drive-state.ts` | `driveState` — الحالُ بكلمة (تجربة · غير موصول · متوقّف · لم يُفحص · يعمل)، ولا «يعمل» بلا فحصٍ نجح |
| `src/services/document-review.service.ts` | ما ينتظر المراجعة وحكمُ الشروط عليه — مصدرُ اللوح وصفحة المستندات · و`processDocumentBacklog` الاستدراكُ في كلّ مزامنة |
| `src/lib/work.ts` | **عددٌ واحد للعمل الباقي** — هو عددُ بنود `/attention` نفسِها، بـ`cache()` فلا تُستعلَم القاعدة مرّتين في الطلب |
| `src/lib/invoice-findings.ts` | **لماذا ناقصةُ ركن** — يُشتقّ ولا يُخزَّن، ولكلّ سببٍ فعلُه ومن يُطالَب به |
| `src/lib/drive-readonly.ts` | الكتابة على الدرايف في الإنتاج وحده — فالقاعدة تتفرّع والأرشيف لا يتفرّع |
| `src/components/view-controls.tsx` | الوضع الداكن وإخفاء المبالغ — على `<html>` بنصٍّ يسبق الرسم، ولا حالةَ في الترميز |
| `src/components/task-list.tsx` | **صفُّ مهمّة** في الرئيسية — سطران وفعلٌ واحد (~٨٠ بكسلاً)، لا بطاقةُ تنبيه (٢٤٩) |
| `src/components/attention-workspaces.tsx` | **العملُ يقع في الطابور** — طلبُ الفواتير، واعتمادُ المستندات، وسياسةُ المورّد، وطلبُ الكشوف: كلٌّ لوحٌ داخل بنده |
| `src/lib/supplier-policy-rules.ts` | **«من يحتاج عقد توريد» قاعدةٌ واحدة بصيغتين** — تُقرأ في TypeScript وتُحقَن في SQL، ولا تُنسَخ في شاشة |
| `src/components/double-paid-section.tsx` | «سُدّد مرّتين» في موضعٍ واحد — كان معروضاً كاملاً في شاشتين |
| `src/components/review-section.tsx` | ورشةُ قرار حركات البنك — لوحٌ داخل بندها لا صفحةٌ تُفتَح فارغة |
| `src/lib/supplier-balances.ts` | **«كم أدين؟» بالمورّد لا بالفاتورة**: المفتوح ناقص رصيدنا عنده، ولا يُخصم رصيدُ مورّدٍ من دين آخر · المصدر `supplier-balance.service.ts` لكلّ شاشة تقول «عليك» |
| `src/services/invoice-profile.service.ts` · `src/lib/invoice-profile.ts` | **ملفّ الفاتورة** (`/purchases/invoices/[id]`): البنود مقابل آخر سعرٍ من المورّد نفسه (`priceMove`) · التخصيصات وحركتها · أسطر كشف المورّد · فاتورةٌ بالمبلغ نفسه في يوم · سجلّ التدقيق · والجارتان. و`invoiceHref` موضعُ الرابط الوحيد |
| `src/services/orphan-payment.service.ts` · `src/lib/orphan-payment.ts` | **دفعةٌ بلا مورّد ولا حركة** تُنسَب أو يُلغى قيدُها بسببه، في معاملةٍ بقفل، والطلبُ بـzod بلا مبلغ |
| `src/services/account-review.service.ts` · `src/lib/payment-echo.ts` · `src/lib/invoice-twin.ts` | **«راجِع الحسابات»** (`/api/account-review`، معاينةٌ ثمّ تنفيذ): يقيّد ما أُرشف بلا قيد، ويدمج الدفعةَ التي قُيِّدت مرّتين بإقرار، وينسب الأرصدة |
| `src/services/supplier-credit.service.ts` | `applySupplierCredit` يخصم ما دُفع من فواتير وصلت بعده (٧ أيّام آلياً) · `markPaidByOwner` يقيّد السداد من حساب المالك **وينقل حوالات المقهى عن تلك الفاتورة** · ومعاينته قبله |
| `src/lib/ai/supplier-analysis.ts` | تحليل حساب المورّد: الإشارات تُحسب قبل النموذج، والمراجع قصيرة من قوائم حُسبت، **والمبلغ يحسبه الخادم** · الأنواع قائمة مغلقة |
| `src/services/supplier-analysis.service.ts` | الوقائع ← النداء (بمهلةٍ تحت عمر المسار) ← `ai_findings` · والإقرار يمرّ بالخدمات نفسها، والرفض يقرؤه التحليل القادم |
| `src/lib/http-client.ts` | **قراءة الردّ في المتصفّح**: نصّاً قبل JSON، و«تعذّر الاتصال» حين لا يصل الطلب وحده. ويمنع `code-guards.test.ts` ‏`await res.json()` في الشاشات |
| `src/lib/code-guards.test.ts` | حرّاسٌ نصّيّة: لا `db.` داخل معاملة · لا `renameFile` خارج `/api/drive-rename` · لا `res.json()` خامّ |
| `src/services/month-guard.ts` | `assertMonthsOpen(tx, months)` — في `createPayment` و`allocate` و`createInvoice`، ومؤثِّرات ٠٢٨ خلفه |
| `src/lib/bank/statement-balances.ts` | رصيدا كلّ شهرٍ من عمود الرصيد، إن استقامت السلسلة — وإلّا مجهول |
| `src/lib/riyadh-time.ts` | «اليوم» و«الشهر الجاري» بتوقيت الرياض — لا `toISOString().slice(0, 7)` |
| `src/lib/token-crypto.ts` | رمز الدرايف مشفَّراً (`sealToken`/`openToken`) — يُفعَّل بـ`TOKEN_ENCRYPTION_KEY`، وبلا مفتاحٍ لا يتغيّر شيء. **كلّ `setCredentials` يمرّ بـ`openToken`** |
| `src/services/guard.ts` | `guard(route, capability)` + `respondTo(e)` → 401/403/429. **مدخل كل واجهة** |
| `src/lib/inventory/units.ts` | **الكمّيّة عددٌ صحيح بالمِلّي** — كما أنّ المال هللات. ولا جسر بين وزنٍ وحجم، ولا بين حبّةٍ وعبوة |
| `src/lib/inventory/week.ts` | **الأسبوع من الأحد إلى السبت** — والمقترَح آخرُ ما اكتمل، فالجاري فرقُه أيّامٌ لم تمضِ |
| `src/lib/inventory/foodics-catalog.ts` | الكتالوج بملفّاته الثلاثة — **نطاقا الرمز منفصلان**، والكلفةُ تُشتقّ ولا تُنسَخ |
| `src/lib/inventory/recipe-cost.ts` | كلفةُ الوصفة من عبوات مكوّناتها — والمجهولُ يُنشر ولا يُبتَلع، والمعلَنةُ تُقارَن فتكشف الناقص |
| `src/lib/inventory/ready-made.ts` | **الجاهزُ يُشترى ويُباع كما هو** — اقترانٌ تسنده الكلفةُ المعلَنة، ولا يدخله خيارُ إضافةٍ جرعتُه مجهولة |
| `src/services/catalog-import.service.ts` | الأصنافُ ثمّ المباعةُ ثمّ الوصفات — ومعاينةٌ في معاملةٍ تُلغى، وما كتبه إنسانٌ لا يُكتَب فوقه |
| `src/lib/inventory/recipe.ts` | النسخةُ السارية **في تاريخ البيعة** — لا الأحدث. وبها وحدها يبقى تقريرُ ما مضى صادقاً |
| `src/lib/inventory/consumption.ts` | الاستهلاك المتوقَّع — والملغى يُستبعَد، والمرتجَع يُنقص، والمجانيّ يُستهلَك ويُعرَض على حدة |
| `src/lib/inventory/purchases.ts` | كمّيّةُ الشراء من مواصفة العبوة — **ولا تُخمَّن كمّيّةٌ من ريال** |
| `src/lib/inventory/equation.ts` | افتتاحيّ + مشتريات − استهلاك − هدر = المتوقَّع · و`null` تنتشر ولا تُبتَلع |
| `src/lib/inventory/coverage.ts` | ما دخل الحساب وما خرج ولماذا — والحكم `READY`/`PARTIAL`/`BLOCKED` |
| `src/lib/inventory/engine.ts` | المحرّك النقيّ، ونسختُه تُحفَظ مع كلّ جردٍ مقفَل |
| `src/components/inventory-count-steps.tsx` | الجردُ خمسُ خطوات: **ما نعدّه؟** ← **ما دخل وما خرج؟** ← **كم وجدنا؟** ← **ماذا اختلف؟** ← **أقفِل** — والنطاقُ يُحفَظ بطلبٍ واحد |
| `src/components/inventory-flow-step.tsx` | المعادلةُ لكلّ صنفٍ قبل العدّ، **وبجانب كلّ مجهولٍ فعلُه**: أدخل الرصيد · أدخل الكمّيّة المستلَمة · اربطهما |
| `src/components/inventory-receipt-form.tsx` | الكمّيّةُ أوّلاً والباقي اختياريّ — **والتكرارُ يُسأل عنه قبل الحفظ** لا بعده |
| `src/components/inventory-opening-grid.tsx` | الأرصدةُ الافتتاحيّة دفعةً — والفراغُ يبقى «غير معروف» ولا يُرسَل |
| `src/lib/inventory/receipts.ts` | الاستلامُ الواحد لا يُحسَب مرّتين: متى يُعدّ بندُ الفاتورة «شبيهاً» (الصنف · سبعة أيّام · كمّيّةٌ مساوية أو مجهولة) |
| `src/lib/inventory/variance-summary.ts` | **النقصُ والزيادةُ لا يتقاصّان** — والنسبةُ مقامُها كلفةُ الاستهلاك، وتعريفٌ واحد للنقص في النظام كلِّه |
| `src/lib/inventory/count-request.ts` | طلبُ الجرد يُفحَص بـzod وقتَ التشغيل — والكمّيّةُ نصٌّ يُقرأ مِلّياً لا عددٌ يمرّ بالعائمة |
| `src/lib/inventory/receipt-request.ts` | طلبُ الاستلام كذلك — والكلفةُ ريالاتٌ نصّاً تصير هللات، ولا تُشتقّ منها كمّيّة |
| `src/services/inventory-receipt.service.ts` | الكمّيّةُ المستلَمة: تُقيَّد · تُعدَّل · تُلغى ولا تُحذَف · يُحسَم تكرارُها — **وليست فاتورةً ولا ديناً** |
| `src/services/inventory-workspace.service.ts` | ما تحتاجه ورشةُ الجرد فوق التقرير — لصفحتيها معاً فلا تفترقان |
| `src/lib/sales/columns.ts` | ترويسةُ ملفّ فودكس تُفهَم بالاسم لا بالموضع — وما لم يُفهَم يُعلَن |
| `src/lib/sales/foodics-excel.ts` | محوِّلُ فودكس بصيغتيه، والهويّةُ من البيانات لا من الملفّ |
| `src/services/sales-import.service.ts` | ثلاثُ طبقاتٍ تمنع التكرار، **ولا صفَّ يُرمى صامتاً** |
| `src/services/inventory.service.ts` | جمعُ الوقائع ودورةُ الجرد — والمقفَلُ يُقرأ ولا يُعاد حسابُه |
| `src/services/recipe.service.ts` | النسخةُ تُغلَق سابقتُها ثمّ تُفتَح — ومؤثِّرُ `036` يمنع التداخل في القاعدة |
| `src/components/recipe-rows.tsx` | الوصفةُ تتمدّد في صفّها — **والتصحيحُ غيرُ التغيير**: زرّان لا زرّ، ولكلٍّ أثرُه في الزمن |
| `src/components/retire-item.tsx` | الصنفُ **يُخرَج ولا يُحذَف** — بنودُ فواتيره وأسطرُ جرده المقفَل تبقى |

## مبنيٌّ ولا يصل إليه أحد

هذه ليست «لم تُبنَ»؛ هي بُنيت واختُبرت ووُثّقت، ثمّ لم تُوصَل بشاشة.
والفرق مهمّ: ما لم يُبنَ يُعرَف أنّه ناقص، وما بُني ولم يُوصَل **يُظنّ
عاملاً** — في الوثيقة وفي الذهن — فيُبنى عليه.

| الوحدة | ماذا يضيع بغيابها |
|---|---|
| `src/lib/credit-notes.ts` | موصولةٌ نصفَ وصل: `supplier-account.ts` تستدعيها ولا يُمرَّر لها إشعارٌ واحد — لا إشعارات في البيانات اليوم |
| `src/lib/extraction/benchmark.ts` | لا يُقاس أيّ نموذجٍ أدقّ |
| `branches` | مخطَّطٌ بلا شيفرة: `branchId` لا يرد في استعلامٍ واحد. (أمّا `bank_accounts` فممتلئٌ في كلّ حركة، و`reconciliation_periods` يكتبه الاستيراد ونموذج الإقفال.) |

وما كان ميّتاً بلا شاشةٍ ولا مستدعٍ **حُذف بدل أن يُسرَد** (مراجعة سبتمبر): `insights.ts` و`bank/parsers/types.ts` و`matchBankTransactions` ونصُّ تجربته، و`/api/supplier-alias`.

**قبل أن تُضيف وحدةً جديدة: أوصِل واحدةً من هذه.**
