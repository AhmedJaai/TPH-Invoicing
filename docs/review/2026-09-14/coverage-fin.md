# تغطية وكيل المال — ٢٠٢٦-٠٩-١٤

> التقرير الكامل: `findings-fin.md`. رفضت أداة الكتابة إنشاءه في هذا المجلّد، فحُفظ في مجلّد عمل الوكيل `scratchpad/fin/findings-fin.md` لينقله المنسّق.
> «سليم — سبب» يعني أنّ الملفّ رُوجع بالقراءة أو بالبحث عن أنماط العدد العشريّ والصفر المجهول (`float-grep.txt`، ٤٠٩ نتيجة) أو بمطابقة أرقامه على SQL.
> حدّ البحث بالأنماط مكتوب في كلّ بند: بحثٌ بلا قراءة كاملة يُقال إنّه بحث.

## src/lib (الماليّة)
| البند | رُوجع؟ |
|---|---|
| `money.ts` | سليم: `parseRiyals` نصّيّ بالهللات، و`TOTAL_ROUNDING_TOLERANCE_MINOR=100` يساوي `007:84` |
| `confirm.ts` | سليم بالبحث: لا عشريّ، والخادم يعيد الاشتقاق (أُثبت في مراجعة ١٣) |
| `line-pricing.ts` | FIN-015 أُصلحت: قسمة صحيحة وردّ الفرق. بقيّة `Math.round` تحليل سعر وحدة |
| `allocation.ts` | سليم: `planAllocations` صحيح، والأقدم أوّلاً بنافذة ٧ أيّام موثّقة، و`db:verify` يثبت الحدود |
| `allocation-sql.test.ts` | سليم: حارس `${table}.id` |
| `payment-state.ts` | سليم: SQL `status_consistency` بلا خلاف في 63 دفعة |
| `payment-run.ts` | سليم: خصم الرصيد `:128-129`، ومبلغ `/payments` 956 يطابق SQL |
| `credit-notes.ts` | سليم، وموصول نصف وصل كما في CLAUDE.md (لا إشعارات في البيانات) |
| `expenses.ts` | سليم منطقاً (`NOT_AN_EXPENSE`، `looksLikeGoodsPurchase`). الأثر في البيانات FIN-103 وFIN-105 |
| `provenance.ts` `provenance-facts.ts` | سليم: الأرقام الأربعة طابقت SQL |
| `changes.ts` `changes-facts.ts` | UI-001/UI-002 (Ø¹ÙØ¯ Ø§ÙÙÙØ³ÙÙ) |
| `month-close.ts` | FIN-007 أُصلحت |
| `month-close-facts.ts` | سليم، و`/close` أغسطس يطابق SQL (4 · 956). حدود `Z` في FIN-107 |
| `supplier-balances.ts` | سليم: طابق SQL (685,134) |
| `supplier-account.ts` | سليم: الكوب الذهبي وغاناش وأفال تطابق SQL في زمن الكشف |
| `statement-match.ts` | سليم بالبحث: `/100` في نصوص عرض فقط |
| `riyadh-time.ts` | سليم |
| `unit-conversion.ts` | سليم بالبحث: `Math.round(pack/total)` سعر وحدة تحليليّ |
| `arabic.ts` | خارج أرقام المال (مجال UX). بالبحث: لا مال فيه |
| `attention.ts` `attention-facts.ts` | سليم: كلّ المبالغ طابقت SQL (2,350.77 · 35,644.90 · 1,796 · 1,498.18). `detectAnomalies` موصولة (FIN-012) |
| `data-health.ts` `data-health-facts.ts` | سليم: نسب عرض، و`NOT_CONNECTED` للمبيعات |
| `canonical-name.ts` | خارج المال. سليم بالبحث |
| `validation.ts` | FIN-014 أُصلحت، والرقم الضريبيّ 15 خانة يبدأ وينتهي بـ3 (`:80-84`). مشتبَه: ضريبة أقلّ بـ18 ريالاً |
| `cashflow.ts` | سليم في الجمع. العرض في FIN-104 |
| `analytics.ts` | سليم: «الشهر الجاري بمثله» يطابق SQL (−68.8٪) |
| `invoice-filter.ts` `items.ts` `products.ts` `supplier-health.ts` `search.ts` | سليم بالبحث: `Math.round` نسب عرض، و`search.ts:121` تحويل نصّيّ إلى هللات |
| `issue-codes.ts` `filing.ts` `naming.ts` | سليم بالبحث: getUTC متّسق مع اصطلاح 00:00Z |
| `ai/supplier-analysis.ts` | سليم بالبحث: `:192` تنسيق نصّيّ بالهللات، والمبلغ يُعاد حسابه في الخادم |
| `extraction/validate-extraction.ts` `statement-extras.ts` `schema.ts` | سليم: FIN-010 أُصلحت. `schema.ts:51` نسبة ثقة لا مال |
| `http-client.ts` `nav.ts` `preview-mode.ts` `session.ts` `permissions*` | خارج المال |

## src/lib/bank/**
| البند | رُوجع؟ |
|---|---|
| `balance-equation.ts` | سليم: المجهول `null`، والتسامح هللة |
| `statement-balances.ts` | سليم: يُرجع `[]` إن لم تستقم السلسلة. وموصول بـ`bank-import:836` |
| `fees.ts` | سليم: الرسم فائضٌ لا نقص، وسقفه مقرَّب إلى هللة صحيحة |
| `double-paid.ts` | سليم: 2,350.77 يطابق |
| `reversal.ts` | سليم بالبحث: `Math.round` أيّام |
| `coverage.ts` | سليم: أيّام صحيحة |
| `lifecycle.ts` | سليم: موصول |
| `pending.ts` `review-queue.ts` | سليم بالبحث: عدّ لا مال |
| `candidates.ts` `optimizer.ts` `decision.ts` `adjudicate.ts` `verdict-policy.ts` `match.ts` `metrics.ts` `supplier-profile.ts` `adjudicator-prompt.ts` `adjudicator-provider.ts` | سليم بالبحث: `Math.round(score*100)` درجات. `/100` في نصوص أدلّة وموجِّه، ولا تُكتب مالاً |
| `sync.ts` `identity.ts` `pattern.ts` `canonical.ts` `classification.ts` `entities.ts` `entity-candidates.ts` `evidence-uniqueness.ts` `rules.ts` `apply.ts` `taxonomy.ts` `reason-codes.ts` `strength.ts` `pos.ts` | سليم بالبحث: `db:identity` بلا مكرَّر، و`canonical.ts:226` تاريخ Date.UTC. لا حساب ماليّ |
| `parse.ts` `vision-statement.ts` `parsers/adapters.ts` `detect.ts` `pdf-text.ts` `safe-xlsx.ts` | سليم بالبحث: المبالغ نصّاً إلى هللات (`vision-statement.ts:49`)، والتواريخ UTC (`parse.ts:108`) |

## src/services (الماليّة)
| البند | رُوجع؟ |
|---|---|
| `payment.service.ts` | FIN-101 (مفتاح التوأمة يوم واحد)، وFIN-002 وFIN-008 أُصلحتا في الشيفرة |
| `supplier-credit.service.ts` | سليم بالبحث: `markPaidByOwner` بـ`acknowledgeTwin` وتاريخ الفاتورة. أثره مشتبَه به في الكوب الذهبي |
| `supplier-balance.service.ts` | سليم: طابق SQL |
| `month-guard.ts` | سليم: `db:verify` ثلاثة فحوص للشهر المقفل |
| `expense.service.ts` | FIN-103 وFIN-105 (`resyncBankExpenses` لم يُشغَّل على القائم) |
| `reconcile.service.ts` | سليم بالبحث: `fee?.feeMinor ?? 0` صحيح (لا رسم ⇒ صفر معلوم) |
| `counterparty.service.ts` | سليم بالبحث: يستدعي `resyncBankExpenses` |
| `validation.service.ts` | سليم: أخطاء مسمّاة |
| `invoice.service.ts` | سليم بالبحث: `period_month` من UTC متّسق. `:89` كمّية بند لا مال |
| `supplier-analysis.service.ts` | سليم بالبحث: المبالغ `Number` من bigint. `:146` `today` بـUTC (P3، ضمن FIN-107) |
| `supplier-profile.service.ts` `product.service.ts` `statement-file.service.ts` `statement-vision.service.ts` `supplier.service.ts` `bank-account.service.ts` `adjudicator.service.ts` `document.service.ts` `drive.service.ts` `search.service.ts` `rate-limit.service.ts` `guard.ts` `types.ts` | سليم بالبحث: لا عشريّ في مال. `adjudicator.service.ts:316` `toFixed` نصّ موجِّه |

## الصفحات
| البند | رُوجع؟ |
|---|---|
| `/` | UI-001/UI-002 (Ø¹ÙØ¯ Ø§ÙÙÙØ³ÙÙ). البقيّة طابقت |
| `/money` | FIN-103. البقيّة طابقت |
| `/money/statement` | FIN-104. الأرقام طابقت |
| `/money/expenses` | FIN-103 وFIN-105 |
| `/payments` | سليم: 956 |
| `/close` | سليم: FIN-007 أُصلحت |
| `/attention` | سليم: طابقت |
| `/purchases` | سليم: طابقت |
| `/suppliers` | FIN-001 جزئيّة (0.02) |
| صفحات ١٥ مورّداً (الكوب الذهبي، غاناش، لوريفا، لافا، أوراق الزيتون، أفال، الغربية، بيكوف، سرد كو، زاكوباك، أطلس، كوهي، مريم، هنقري مان، أوسكا) | طابقت SQL. FIN-102 (لافا وأطلس)، ومشتبَه (الكوب الذهبي) |
| `/purchases/invoices` `/bank` `/review` | جُلبت ولم تُطابَق بنداً بنداً، فلم تُفحص |

## الهجرات (31)
| البند | رُوجع؟ |
|---|---|
| 001 | خارج المال (مجال الأمن) |
| 002 | سليم بالبحث: حالات الضريبة ومفاتيح التكرار |
| 003 004 | خارج المال |
| 005 | سليم: `pack_size numeric(12,3)` كمّية لا مال |
| 006 | سليم: قيد شهر المصروف، و`db:verify` ✓ |
| 007 | قُرئت كاملة، وأُثبتت بـ`db:verify` (خمسة قيود) |
| 008–011 | سليم بالبحث: أبواب وتصنيف وحسابات. لا DEFAULT 0 على مبلغ مجهول |
| 012 | سليم: جداول المبيعات فارغة. `settlement_batches` و`sales` DEFAULT 0 على جداول فارغة عمداً (P3 إن مُلئت) |
| 013 | سليم: `model_confidence numeric(4,3)` نسبة |
| 014–017 019–025 | سليم بالبحث: هويّة ومراجع. `db:verify` يثبت 023/024/025 |
| 018 | سليم: الرصيدان يقبلان NULL (`money_col_types`) |
| 026 | قُرئت، و`db:verify` (سباق دفعتين) ✓، والشهادة ٨ ✓ |
| 027 | سليم بالبحث: `OWNER_ACCOUNT` و`ai_findings.amount_minor integer` |
| 028 | قُرئت. FIN-107 (`payment_month` IMMUTABLE)، و`db:verify` ✓ |
| 029 030 031 | خارج المال (فهارس وذاكرة قراءة) |

## الجداول (41)
| البند | رُوجع؟ |
|---|---|
| `invoices` | طابقت. قيود 007 مُثبتة. 3 فواتير بتقريب مورّد ≤ ريال (`rounding_diff`) |
| `invoice_lines` | `discount_minor DEFAULT 0` صفر معلوم عند القراءة، لا ملاحظة |
| `payments` | FIN-101، FIN-102. `fee_minor DEFAULT 0` صحيح |
| `payment_allocations` | 0 يتيمة، 0 على مردودة، 0 تجاوز |
| `bank_transactions` | 5 بلا `classification_source`، 0 بلا `bank_account_id`، 0 «أُقرّت ولم تُقيَّد» |
| `bank_imports` `bank_rules` `bank_accounts` | عدّ، لا مال |
| `statements` `statement_lines` | الرصيد يقبل NULL. الكوب الذهبي بلا أسطر. `debit/credit DEFAULT 0` مقبول بعد FIN-010 |
| `reconciliation_periods` | 0 صفوف، وله كاتبان الآن |
| `month_closes` | 0 صفوف، ولا شهر مقفل |
| `expenses` | FIN-103، FIN-105 |
| `recurring_expenses` | فارغ (المتوقَّع «لم يُسجَّل») |
| `suppliers` `supplier_aliases` `supplier_products` | لا مكرَّر (`db:split-check`). «سبعة جرة — عميل» ما زال مورّداً |
| `issues` `documents` `extraction_cache` | خارج المال |
| `audit_logs` | قُرئ لتتبّع FIN-101 وFIN-102 |
| `decision_history` `adjudications` `ai_findings` | قُرئ `ai_findings` عبر التدقيق (FIN-102) |
| `counterparties` `counterparty_evidence` | خارج المال |
| `products` `pos_products` `sales` `sale_lines` `sales_sources` `sale_payments` `refunds` `refund_lines` `settlement_batches` `branches` | فارغة عمداً. أنواع المال integer، ولا بيانات مخترَعة |
| `users` `accounts` `sessions` `verification_tokens` `rate_limits` | خارج المال |

## النصوص المالية
| البند | رُوجع؟ |
|---|---|
| `verify-invariants.ts` | شُغّل: 14/14 |
| `certify-flow.ts` | شُغّل: 11/11. يكتب ويحذف (قائمة P2 في الوثيقة) |
| `identity-report.ts` | شُغّل عرضاً. `apply` يكتب بلا `guard-write`، ولم يُشغَّل |
| `find-split-suppliers.ts` | شُغّل: لا شيء |
| `diagnose-unpaid.ts` | شُغّل: FIN-106 |
| بقيّة `scripts/` | بالبحث عن الأنماط فقط (`float-grep.txt`)، ولم تُقرأ كاملة |

**النسبة:** كلّ بنود النطاق لها سطر. مُطابَقٌ برقمٍ أو مشغَّل ≈ ٤٠٪. مقروءٌ كاملاً ≈ ٢٥٪. والبقيّة بحثُ أنماط معلَن. غير المفحوص: `/purchases/invoices` و`/bank` و`/review` رقماً رقماً، وبقيّة النصوص قراءةً كاملة.
