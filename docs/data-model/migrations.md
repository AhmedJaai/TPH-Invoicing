# المخطّط والهجرات

الحَكَم هو `src/db/schema.ts` ومجلّد `drizzle/sql/`. **اقرأ هذا** قبل أن تكتب هجرة.

## الجداول — ٥٤

`users` `accounts` `sessions` `verification_tokens` · `documents` `invoices` `invoice_lines` `issues`
`suppliers` `supplier_aliases` `supplier_products` · `payments` `payment_allocations`
`bank_imports` `bank_transactions` `bank_rules` · `statements` `statement_lines` · `month_closes`
`products` `recurring_expenses` · `sales` `sale_lines` `sales_sources` `pos_products`
`audit_logs` `rate_limits` `expenses`
`counterparties` `counterparty_evidence` · `branches` `bank_accounts` `reconciliation_periods`
`sale_payments` `refunds` `refund_lines` `settlement_batches`
`adjudications` `decision_history` · `ai_findings` · `extraction_cache` · `alert_resolutions`
`recipes` `recipe_versions` `recipe_ingredients` · `sales_imports` `sales_import_rows`
`inventory_counts` `inventory_count_lines` `inventory_count_snapshots` `inventory_movements` `waste_records`
`inventory_count_openings` `inventory_receipts`

التعريف في `src/db/schema.ts`.

## الهجرات: SQL صريح، لا `drizzle-kit push`

الملفات في `drizzle/sql/` ويشغّلها `npm run db:migrate` (`scripts/migrate.ts`).

**السبب:** `drizzle-kit push` يطلب طرفيّة تفاعلية — فيتعذّر في CI — ولا يترك أثراً يُراجَع.

**وتُطبَّق مع النشر**: `vercel-build` هو `migrate && next build`، بـ`&&` لا
بـ`;` — فالهجرةُ الساقطة توقف النشر، ونشرٌ لم يقع خيرٌ من نشرٍ يقرأ عموداً
غير موجود. ويحرسه `deploy-guards.test.ts`.

> **وكان الادّعاء قائماً والفعل غائباً.** قالت هذه الوثيقة «تُطبَّق مع كلّ
> نشر» ولم يكن ثمّة `vercel-build` ولا `postbuild` ولا خطوةٌ في CI، فبقيت
> قاعدةُ الإنتاج عند ٣٤ والمستودعُ عند ٣٥. ولم يظهر إلّا عند نشرٍ يقرأ
> عمودين جديدين — **ونشرُه قبل الهجرة كان يكسر كلّ استعلامِ مورّد**.
> والوثيقةُ التي تصف ما لا يقع أسوأ من ألّا تُكتب.

**ولذلك: الهجرةُ تسبق الكودَ الذي يحتاجها بنشرةٍ كاملة.** لأنّها تجري في
**البناء**، أي قبل أن يُرفَع الكودُ الجديد — فبين الاثنين نافذةٌ يعمل فيها
**الكودُ القديم على المخطّط الجديد**. فالإضافةُ آمنة (عمودٌ بقيمةٍ
افتراضيّة، جدولٌ جديد)، و**الحذفُ وإعادةُ التسمية ليسا كذلك**: يُقسَّمان
على نشرتين — تُضاف الأولى ويُقرأ الاثنان، ثمّ يُحذف القديم.

| الملف | ماذا يفعل |
|---|---|
| `001_audit_log_immutable.sql` | مؤثِّرات تمنع تعديل سجلّ التدقيق أو حذفه أو تفريغه |
| `002_tax_status_and_idempotency.sql` | حالات الضريبة، ومفاتيح منع التكرار الثلاثة |
| `003_transaction_type.sql` | `bank_transactions.transaction_type` |
| `004_rate_limits.sql` | جدول حدّ الطلبات |
| `005_products_and_sales_domain.sql` | الأصناف والمصروفات المتكرّرة ومجال المبيعات |
| `006_expenses.sql` | المصروف الفعلي، وقيدٌ يمنع تكراره عن حركة أو فاتورة |
| `007_financial_invariants.sql` | قيود المال في القاعدة: التخصيص والفاتورة والمصروف |
| `008_bank_kinds.sql` | أبواب حركة البنك: تسوية الشبكة ورسومها وضريبتها |
| `009_match_evidence.sql` | أدلّة المطابقة وقرارها ودرجتها — كي يُعرَض «لماذا؟» ويُتراجَع |
| `010_counterparties.sql` | ذاكرة المستفيدين: هويّة الجهة وأدلّتها |
| `011_branches_and_accounts.sql` | الفروع والحسابات وفترات التسوية |
| `012_sales_domain.sql` | طرق دفع البيعة والمرتجعات ودفعات التسوية |
| `013_decision_provenance.sql` | أثر القرار: من صنّف، وأيّ نموذجٍ حكَم، وكيف تطوّر |
| `014_identity_scoping.sql` | فرادة الحركة مقيَّدة بحسابها، وفرادة الدليل بحسب نوعه |
| `015_payment_lifecycle.sql` | سبعُ حالاتٍ للدفعة، ورسمُ التحويل، والردّ لا يحذف |
| `016_lifecycle_and_expense_events.sql` | طبقات الحركة، وبصمةُ حدث المصروف |
| `017_sales_identity_and_units.sql` | فرعُ البيعة وهويّتها، ومحتوى عبوة الصنف |
| `018_statement_balances_nullable.sql` | رصيدا الكشف يقبلان المجهول — والصفر كان يقول «لا يطالبنا بشيء» |
| `019_pattern_identity.sql` | النمط دليلٌ على الجهة — ظنّيٌّ كالاسم، وبه تُعرَف الحركة التي لا اسم لها ولا حساب |
| `020_natural_transaction_key.sql` | المنع على المفتاح الطبيعيّ لا على بصمةٍ تُحسَب — و`occurrence` جزءٌ منه |
| `021_amount_classification.sql` | `AMOUNT` مصدرَ تصنيف — المقدار دلّ حين صمت الوصف |
| `022_bank_vat_category.sql` | `BANK_VAT` — ضريبةُ الرسم بابٌ غير باب الرسم |
| `023_operation_reference.sql` | مرجع العمليّة فريد — من تطابق مرجعُه تطابقت عمليّته |
| `024_identity_key.sql` | الهويّة تُخزَّن وتُقيَّد: `REF` بالمرجع أو `FACT` بالوقائع |
| `025_identity_supersedes_natural.sql` | قيدٌ واحد للهويّة — لا قيدان بتوحيدين مختلفين |
| `026_allocation_bounds_serialize.sql` | مؤثِّر التخصيص يقفل الفاتورة والدفعة قبل الجمع — فلا يُخدَع بالتزاحم |
| `027_owner_account_and_ai_findings.sql` | `OWNER_ACCOUNT` طريقةَ سداد، وجدول `ai_findings` لاقتراحات تحليل الذكاء وقرار الإنسان فيها |
| `028_month_lock.sql` | الشهر المقفل لا يُكتب فيه: مؤثِّرات على الفواتير والدفعات والتخصيصات — وتحديث الحال مقبول |
| `029_ops_indexes.sql` | فهارس ناقصة: `payment_allocations.invoice_id` و`matched_payment_id` و`bank_import_id` و`user_id` |
| `030_extraction_cache.sql` | `extraction_cache` — ما قرأه النموذج بيد الخادم ببصمة الملفّ، لا من المتصفّح |
| `031_extraction_text_source.sql` | مصدرُ القراءة (نصّ · صورة مضمَّنة · صورة) يُحفَظ مع ما قُرئ ويُنقل إلى `documents.text_source` |
| `032_payment_month_stable.sql` | `payment_month` تُوسَم `STABLE` لا `IMMUTABLE` — `to_char(timestamptz)` يتبع منطقة الجلسة |
| `033_document_drive_md5.sql` | `documents.drive_md5` — بصمةُ الدرايف لما قيّدته المزامنةُ بالاسم، يقابلها `/api/analyze` قبل القراءة |
| `034_alert_resolutions.sql` | قرارُ الإنسان في تنبيه «سُدّد مرّتين»: طالبتُ · استُردّ · ليس ازدواجاً — بمفتاحٍ يُشتقّ من الحركات |
| `035_supplier_document_policy.sql` | سياسةُ مستندات المورّد: `contract_required` و`paper_invoices` — يكتبهما الإنسان ولا يُشتقّان، وقيدٌ يمنع «ورقيّة» مع «لا يصدر فواتير» |
| `036_inventory_reconciliation.sql` | الجرد: الوصفةُ بنسخها المؤرَّخة، واستيرادُ المبيعات بصفوفه الخام، وجلسةُ الجرد وأسطرُها ولقطتُها، والحركاتُ اليدويّة وسجلُّ الهدر — ومؤثِّران: لا نسختا وصفةٍ ساريتان معاً، ولا كتابةَ في جردٍ مقفَل |
| `037_foodics_real_semantics.sql` | ما أثبته تصديرُ فودكس الحقيقيّ: حالُ البند خاماً، والخيارُ صفٌّ مرتبطٌ بأصله، وبصمةُ المحتوى، و`REVISED`، ونسبةُ الفرق إلى الاستهلاك، وأساسُ التقييم، و`received_on`، ومؤثِّرٌ يمنع تداخلَ فترتَي جرد |
| `038_foodics_catalog.sql` | كتالوج فودكس: **نطاقا الرمز منفصلان** (‏٣٩ من ٦٠ تحمل معنيين)، والعبوةُ بمعامِلها وكلفتِها تُحفَظ ولا تُحفَظ قسمتُها، وتقييمٌ بكلفة الكتالوج، ومصدرُ نسخة الوصفة |
| `039_first_recipe_version_covers_history.sql` | أوّلُ نسخةٍ لأيّ وصفة تسري **منذ البداية** — كانت تبدأ يوم رفعها، فخرج كلُّ بيعٍ قبلها بلا وصفة |
| `040_count_scope.sql` | نطاقُ الجرد: `in_scope` على سطر الصنف — الخارجُ تُحسَب وقائعُه ولا فرقَ له، ولا يُقرأ صفراً على الرفّ |
| `041_inventory_manual_inputs.sql` | ما يُدخله الإنسان حين لا تعرفه الوثائق: `scope_source` (موروث · صريح)، والافتتاحيُّ اليدويّ بتاريخه لا يُكتَب فوقه، والكمّيّةُ المستلَمة وعلاقتُها ببند الفاتورة، ومصدرُ الافتتاحيّ على السطر — ومؤثِّراتٌ ترفض الكتابةَ في أسبوعٍ جردُه مقفَل |
| `042_posted_supplier_category.sql` | الحوالةُ المقيَّدة آلياً لمورّد بابُها `SUPPLIER` لا `UNKNOWN` — كان الاستيراد يكتب الدفعة ويترك الباب، فتُعرَض «غير مصنّفة» بجانب «طُوبقت» |
| `043_human_confirmed_source.sql` | ما أقرّه إنسانٌ مصدرُه `HUMAN` لا `UNKNOWN` — كان في 042 أُضيف بعد تطبيقها، فسقط كلُّ نشرٍ عند `migrate` |
| `044_supplier_issues_statements.sql` | `suppliers.issues_statements` — «كشوف الحساب مو كلّهم يصدرونها»: يكتبه الإنسان، ومن لا يصدره لا يُطلَب منه كشف |
| `045_notifications_seen.sql` | `users.notifications_seen_at` — حدُّ ما قرأه المستخدم من مركز الإشعارات. الإشعاراتُ تُشتقّ ولا تُخزَّن؛ الحدُّ وحده لا يُشتقّ |

والمشغّل لا يعيد هجرةً مطبَّقة تغيّر ملفّها إلّا بـ`--reapply <الاسم>`، وبقفلٍ استشاريّ ضدّ تشغيلين.

**والهجرةُ المطبَّقة لا تُعدَّل — الإضافةُ هجرةٌ جديدة.** عُدّلت 042 بعد أن طبّقها نشرُ معاينة، فرفضها المشغّلُ في كلّ نشرٍ بعدها وسقط `vercel-build` قبل البناء. ويحرسه الآن `drizzle/migration-hashes.json` في `deploy-guards.test.ts`: هجرةٌ جديدة تُضاف إليه، وتعديلُ قائمةٍ يُسقط CI قبل أن يُسقط النشر.
