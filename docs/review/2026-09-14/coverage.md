# مصفوفة التغطية — مراجعة ١٤ سبتمبر ٢٠٢٦

كلّ بندٍ في نطاق المراجعة وحكمه (معرّف ملاحظة أو «سليم» مع سببه). المصدر: ملفّات `coverage-*.md` لكلّ مجال، مجمَّعة هنا.

| المجال | عدد البنود | الملفّ |
|---|---:|---|
| SEC | 46 | [coverage-sec.md](coverage-sec.md) |
| FIN | 102 | [coverage-fin.md](coverage-fin.md) |
| OPS | 84 | [coverage-ops.md](coverage-ops.md) |
| CODE | 278 | [coverage-code.md](coverage-code.md) |
| BTN | 35 | [coverage-btn.md](coverage-btn.md) |
| UX | 62 | [coverage-ux.md](coverage-ux.md) |
| **المجموع** | **607** | |


---

## SEC


**البيئة:**
- بناءٌ إنتاجيّ (`next start`، `NODE_ENV=production`) على `127.0.0.1:3400` فوق `tph_sec`. أثبتت `/api/ops/db-identity` أنّ `systemIdentifier` هو المعرّف المحلّيّ.
- ثلاثة خوادم تجاوز مؤقّتة: 3401 و3402 و3403. أُوقفت كلّها.
- الملاحظات نفسها في ردّ الوكيل، لأنّ كتابة `findings-sec.md` رُفضت للوكيل الفرعيّ.

**التغطية:**
- **‏١٠٠٪ من البنود المطلوبة (٤٤ بنداً):** ٢٥ ملفّ `route.ts`، و١٩ ملفّاً وبنداً آخر.
- **‏٢٤ واجهة × ٦ هويّات ضُربت فعلاً** (المصفوفة في الملاحظات)، ومعها `auth/*`.
- **ما لم يُشغَّل:**
  - إعادة التوجيه الخارجيّ بعد الدخول: الجدار يحجب اكتشاف جوجل، فكلّ `signin/google` يعود بـ`Configuration`. **مُتتبَّع لا مُثبَت.**
  - تعطيل المؤثِّر بدور `neondb_owner` نفسه: الدور المحلّيّ superuser.

| البند | قُرئ | شُغِّل | الحكم |
|---|---|---|---|
| `api/ai-analysis` | كاملاً | مصفوفة | SEC-101 (مرّ للمعطَّل) · وإلّا سليم |
| `api/ai-findings` | كاملاً | مصفوفة | سليم: `payment:approve` لما يكتب مالاً |
| `api/analyze` | كاملاً | مصفوفة · ٦ م.ب ← 400 · حقن | SEC-107 · الحدّ والنوع سليمان |
| `api/archive` | كاملاً | مصفوفة · مشتريات ١٠٠٬٠٠٠ ر.س · إجماليّ صفر | SEC-102 · SEC-106 · البايتات السحرية و`SAFE_NAME` سليمة |
| `api/auth/[...nextauth]` | كاملاً | csrf · خروج · خروج بلا رمز | سليم: الخروج يحذف الصفّ، والرمز القديم ← 401، وبلا csrf ← `MissingCSRF` |
| `api/bank-import` | `:20-140` و`:880-912` | مصفوفة | سليم: `bank:edit` وحدّ ٤ م.ب |
| `api/bank-rule` | كاملاً | مصفوفة | SEC-109 (بلا حدّ طول) |
| `api/counterparty` | كاملاً | مصفوفة | سليم (SEC-008 أُصلحت) |
| `api/document-status` | كاملاً | مصفوفة | سليم: التأكيد يحتاج `amounts:view` |
| `api/drive-rename` | كاملاً | مصفوفة · معرّفات مجهولة و`../` ← ٠ تسمية وصفر نداء كتابة | SEC-104 · اشتقاق الاسم في الخادم سليم |
| `api/drive-sync` | `:1-140` | مصفوفة · 3403 | SEC-103 |
| `api/expense-actual` | كاملاً | مصفوفة | سليم |
| `api/expense` | كاملاً | مصفوفة · SEC-101 · مبالغ حدّية · CSRF | SEC-108 · SEC-109 |
| `api/health` | كاملاً | مصفوفة | سليم: غير المخوَّل يرى `healthy` وحده |
| `api/mark-paid` | كاملاً | مصفوفة · معرّفات غير نصّية ← 200 بلا كتابة | سليم |
| `api/match-confirm-bulk` | كاملاً | مصفوفة · معرّفات غير نصّية | سليم |
| `api/match-confirm` | `:60-280` | مصفوفة | سليم: `payment:approve` |
| `api/match-undo` | كاملاً | مصفوفة | سليم (SEC-015 أُصلحت) |
| `api/month-close` | كاملاً | مصفوفة | سليم: إعادة الفتح للمالك |
| `api/ops/db-identity` | كاملاً | مصفوفة · ٣٣ طلباً ← 429 | سليم |
| `api/payment-run` | كاملاً | مصفوفة · ظهرت فاتورة SEC-102 | SEC-102 |
| `api/product` | كاملاً | مصفوفة | سليم |
| `api/search` | كاملاً | ٤ استعلامات للمشتريات | SEC-105 (SEC-005 أُصلحت) |
| `api/statement-reconcile` | `:1-140` | مصفوفة | SEC-103 (مُتتبَّع) |
| `api/supplier` | كاملاً | مصفوفة | سليم |
| `src/proxy.ts` | كاملاً | مصفوفة · 3401 و3402 | سليم |
| `src/auth.ts` | كاملاً | SEC-101 · خروج | SEC-101 · النطاق `drive` كامل (SEC-011) |
| `src/instrumentation.ts` | كاملاً | سجلّ 500 | SEC-110 |
| `src/lib/session.ts` | كاملاً | SEC-101 | SEC-101 |
| `src/lib/permissions.ts` | كاملاً | مصفوفة | سليم: الردود تطابق الجدول |
| `src/lib/preview-mode.ts` | كاملاً | 3401 (prod) ← 401 · 3402 (`VERCEL_ENV=preview`) ← 401 · 3403 (`NODE_ENV=development`) ← مفتوح | سليم في البناء الإنتاجيّ · SEC-103 |
| `src/lib/token-crypto.ts` | كاملاً | tsx: ذهاب وإياب، وIV عشوائيّ، ورفض العبث، ورفض المفتاح الخطأ | سليم · والتفعيل مشروط بمفتاح (SEC-011 جزئيّة) |
| `src/lib/http-client.ts` | كاملاً | — | سليم |
| `src/lib/code-guards.test.ts` | كاملاً | — | سليم |
| `src/services/guard.ts` | كاملاً | مصفوفة | سليم |
| `src/services/rate-limit.service.ts` + `src/lib/rate-limit.ts` | كاملاً | 429 مع `retry-after: 821` | سليم (العدّ قبل التحقّق من الجسم) |
| `src/lib/audit.ts` | كاملاً | — | SEC-007 جزئيّة |
| `next.config.ts` | كاملاً | `curl -I` على صفحة وواجهة | سليم: الستّ كلّها. وبقي `X-Powered-By: Next.js` (P3 تلميع) |
| `drizzle/sql/001` | كاملاً | UPDATE/DELETE/TRUNCATE مرفوضة · `DISABLE TRIGGER USER` ثمّ DELETE ← **مقبول** (أُلغي) | SEC-001 قائمة. أُثبت بـsuperuser، والمالك في الإنتاج يملك الأمر نفسه (مُتتبَّع) |
| `drizzle/sql/004` | كاملاً | — | سليم |
| `src/app/login/page.tsx` | كاملاً | — | `redirectTo: from` يمرّ بدالّة إعادة التوجيه الافتراضيّة في Auth.js (نفس الأصل). **لم يُشغَّل** |
| `src/components/user-menu.tsx` | كاملاً | خروج عبر `/api/auth/signout` | سليم |
| `SECURITY.md` | كاملاً | — | §٤ يطابق الواقع · §٣·١ مشروطٌ بمفتاحٍ لا يُعرَف أضُبط |
| SQL الخامّ | فحصٌ متعدّد الأسطر لكلّ `sql\`` | — | سليم: `sql.raw` بثابتٍ واحد (`purchases/invoices:75`)، والاستعلامات المرتبطة تكتب `${issues}.entity_id` أو قيماً. لا مصيدة |
| `.next/static` (١٫٦ م.ب) و`NEXT_PUBLIC_` | grep | — | سليم: صفر |
| `.claude/launch.json` | كاملاً | — | SEC-002: صار `-H 127.0.0.1` |


---

## FIN


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


---

## OPS


> «رُوجع» لا يُملأ إلّا بدليل: رقم ملاحظة، أو «سليم» مع سببه. المعرّفات OPS-1xx في تقرير الوكيل (يكتبه المنسّق في `findings-ops.md`).

## الإعداد والبنية

| الملفّ | رُوجع؟ |
|---|---|
| `src/db/index.ts` | نعم — `max: isServerless?1:10`، مهلات 10s اتصالاً و30s استعلاماً؛ الـpooler يُفرض بالوثيقة لا بالشيفرة (OPS-108) |
| `src/instrumentation.ts` | نعم — `console.error` وحده، لا تنبيه (OPS-105)؛ تسجيل params ⟵ SEC-110 |
| `next.config.ts` | سليم — `serverExternalPackages` وترويسات أمان؛ لا `cacheComponents` |
| `package.json` | نعم — ٩ أوامر غير مذكورة في CLAUDE.md (OPS-110)؛ كلّها `--env-file=.env` (OPS-106) |
| `drizzle.config.ts` | سليم — لا يُستعمَل للدفع؛ يقرأ `.env` |
| `vitest.config.mts` | سليم في ذاته — `src/**/*.test.ts` بيئة node، لا اختبار يلمس قاعدة (مذكور في CLAUDE.md) |
| `.claude/launch.json` | نعم — OPS-106 |
| `ops-attestation.example.json` | نعم — لا `ops-attestation.json` حقيقيّ (OPS-107) |
| `docs/SETUP.md` | نعم — لا إجراء نسخٍ ولا استعادة (OPS-103)؛ يقرّ النشر اليدويّ وHobby |
| `src/config/drive.ts` | سليم — ثوابت معرّفات المجلّدات والشركة من البيئة |
| `.github/workflows/ci.yml` | سليم — typecheck/lint/test/build؛ النشر لا ينتظره (OPS-106) |

## الذكاء والاستخراج

| الملفّ | رُوجع؟ |
|---|---|
| `src/lib/ai/deepseek.ts` | نعم — OPS-101 (إشارة تنقضي مرّة ثمّ محاولتان بلا إلغاء)؛ OPS-109 (السبب الحقيقيّ يضيع) |
| `src/lib/ai/deadline.ts` | سليم — مُثبَت على المسار: analyze وstatement-reconcile يقفان عند 52s |
| `src/lib/ai/models.ts` | نعم — لا `-exp`؛ ٤٠٤ يُعلَن «غير متاح لهذا المفتاح» (مُثبَت)؛ الصحّة لا تفحص الاسم (OPS-105) |
| `src/lib/ai/document-input.ts` | سليم — نصّ أوّلاً (مُثبَت: PDF بلا `raw_text` قُرئ نصّاً)، ثمّ صورة |
| `src/lib/ai/pdf-images.ts` | سليم — كشف AVAL الممسوح أُرسل صورةً 164KB |
| `src/lib/ai/supplier-analysis.ts` | سليم تشغيليّاً — الحساب قبل النموذج |
| `src/lib/ai/finding-labels.ts` | سليم — تسميات عرض |
| `src/lib/extraction/provider-deepseek.ts` | نعم — مرحلتان؛ على 503 ستّة نداءات للمستند (مُثبَت)؛ OPS-109 |
| `src/lib/extraction/index.ts` · `extract.ts` · `provider.ts` · `schema.ts` · `schemas-by-kind.ts` · `validate-extraction.ts` · `statement-extras.ts` · `pipeline.ts` · `versions.ts` | سليم تشغيليّاً — لا نداء شبكة خارج `callDeepseek` |
| `src/lib/extraction/provider-gemini.ts` · `provider-ollama.ts` | سليم — خاملان خلف `EXTRACTION_ALLOW_ALT_PROVIDER` |
| `src/lib/extraction/benchmark.ts` | سليم — لا تصل إليه شاشة (موثَّق) |
| `src/services/supplier-analysis.service.ts` | نعم — OPS-101 (144s مُثبَتة)؛ لا اتّصال قاعدة محتجز أثناء النداء (مُثبَت) |
| `src/services/adjudicator.service.ts` | نعم — حتى 25 نداءً متسلسلاً تحت `withDeadline`؛ الكتابة بعدها بلا ميزانيّة (OPS-104) |

## الدرايف والعمليّات

| الملفّ | رُوجع؟ |
|---|---|
| `src/lib/drive.ts` | نعم — `googleapis` بلا مهلة صريحة؛ `renameFile` مستدعٍ واحد (حارس نصّيّ) |
| `src/lib/drive-sync.ts` | سليم — `deadline` يُفحَص عند رأس كلّ شهر |
| `src/app/api/drive-sync/route.ts` | نعم — ميزانيّات 20s/28s + 55s؛ لا تسمية (OPS-007 أُصلحت) |
| `src/app/api/drive-rename/route.ts` | مشتبَه S-2 — 25 تسمية بلا ميزانيّة |
| `src/services/drive.service.ts` | نعم — الرفع قبل القيد ⟵ SEC-106 |
| `src/lib/ops/production-gate.ts` | سليم — `buildGate` يُسقط الغائب إلى `UNKNOWN` |
| `src/lib/ops/db-identity.ts` | سليم |
| `src/lib/ops/truth-audit.ts` | سليم — دوالّ خالصة |
| `src/app/api/health/route.ts` | نعم — OPS-105 (HTTP 200 مع `healthy:false`، مُثبَت) |

## النصوص (`scripts/`، ٤١ ملفّاً + `lib/guard-write.ts`)

| النصّ | النوع | الحارس | package.json | شُغّل؟ |
|---|---|---|---|---|
| `audit-data.ts` | يقرأ | — | db:audit | نعم ✓ (1s) |
| `backfill-content.ts` | يكتب القاعدة، يقرأ الدرايف | `--commit` بلا guard-write | drive:backfill | لا (يكتب) — OPS-102 |
| `backfill-missing-invoices.ts` | يكتب | `--apply` بلا guard-write | db:backfill-invoices | لا — OPS-102 |
| `benchmark-providers.ts` | يقرأ + ذكاء | — | bench:extraction | لا (ذكاء) |
| `bootstrap-schema.ts` | يكتب المخطّط | يرفض قاعدةً فيها جداول | db:bootstrap | لا |
| `build-products.ts` | يكتب | guard-write ✓ | db:products | لا |
| `certify-flow.ts` | يكتب ثمّ يحذف + يكتب `certify-result.json` | — | ops:certify | لا ⟵ مثبَت عند غيري |
| `certify-real-bank.ts` | يقرأ | — | ops:real-bank | لا |
| `check-isolation.ts` | يقرأ | — | ops:isolation | نعم ✓ |
| `dedupe-bank.ts` | يحذف | `apply` بلا guard-write | db:dedupe | لا — OPS-102 |
| `derive-expenses.ts` | يكتب | guard-write ✓ | db:expenses | لا |
| `diagnose-drive.ts` | يقرأ الدرايف | — | drive:diagnose | لا |
| `diagnose-unpaid.ts` | يقرأ | — | db:unpaid | نعم ✓ (1s) |
| `drive-auth.ts` | OAuth محلّيّ | — | drive:auth | لا |
| `drive-inventory.ts` | يقرأ الدرايف | — | drive:inventory | لا |
| `find-split-suppliers.ts` | يقرأ | — | db:split-check | نعم ✓ |
| `identity-report.ts` | يقرأ؛ `apply` يكتب | بلا guard-write | db:identity | رُفض التشغيل من المصنِّف |
| `learn-counterparties.ts` | يكتب/يحذف | `apply` بلا guard-write | db:learn | لا — OPS-102 |
| `link-counterparties.ts` | يقرأ (لا كتابة ظاهرة) | — | db:link | رُفض التشغيل |
| `measure-system.ts` | يقرأ | — | db:measure | نعم ✓ |
| `merge-suppliers.ts` | يكتب | `--commit` بلا guard-write | db:merge | لا — OPS-102 |
| `migrate-archive.ts` | يكتب | `--commit` بلا guard-write | drive:migrate | لا — OPS-102 |
| `migrate.ts` | يكتب المخطّط | قفل استشاريّ + `--reapply` | db:migrate | رُفض التشغيل؛ مُتتبَّع (OPS-011 أُصلحت) |
| `missing-invoices.ts` | يقرأ | — | db:missing-invoices | رُفض التشغيل |
| `production-gate.ts` | يقرأ | — | ops:gate | نعم ✓ |
| `reclassify-bank.ts` | يكتب | `apply` بلا guard-write | db:reclassify | لا — OPS-102 |
| `recompute-line-pricing.ts` | يكتب | `--commit` بلا guard-write | db:reprice | لا — OPS-102 |
| `rematch-bank.ts` | يكتب | `apply` بلا guard-write | db:rematch | لا — OPS-102 |
| `remove-duplicate-transaction.ts` | يحذف | `--apply` بلا guard-write | db:remove-dupe | لا — OPS-102 |
| `repair-bank-rules.ts` | يحذف | `--commit` بلا guard-write | db:repair-rules | لا — OPS-102 |
| `repair-import-scope.ts` | يحذف | `apply` بلا guard-write | db:repair-scope | لا — OPS-102 |
| `repair-integrity.ts` | يكتب/يحذف | `--commit` بلا guard-write | db:repair | لا — OPS-102 |
| `repair-period-month.ts` | يكتب | `--apply` بلا guard-write | db:repair-months | لا — OPS-102 |
| `seed-demo.ts` | يكتب | guard-write ✓ | db:demo | لا |
| `seed-suppliers.ts` | يكتب | guard-write ✓ | db:seed | لا |
| `truth-audit.ts` | يقرأ الدرايف + يكتب `truth-audit.json` | — | ops:truth | لا |
| `try-archive.ts` | يكتب الدرايف بـ`--upload` | guard-write ✓ | try:archive | لا |
| `try-bank.ts` · `try-extract.ts` · `try-statement.ts` | يقرأ + ذكاء | — | try:* | لا |
| `verify-invariants.ts` | يكتب داخل معاملة تُلغى | — | db:verify | رُفض التشغيل؛ مُتتبَّع |
| `lib/guard-write.ts` | الحارس | — | — | نعم — مستعمَل في ٥ نصوص من ~١٩ كاتبة |

## التجارب الحيّة

| البند | النتيجة |
|---|---|
| مهلات analyze / statement-reconcile / ai-analysis بذكاءٍ متأخّر 70s | 52.08s / 52.07s / **144.2s** |
| `pg_stat_activity` أثناء الانتظار | لا `idle in transaction`، ولا اتّصال محجوز |
| استيراد كشف الأهلي الحقيقيّ ثانيةً | 0.22s، 20 استعلاماً، 0 نداء ذكاء، 0 إضافة |
| استيراد 1436 صفّاً جديداً (تواريخ مُزاحة) | 0.59s محلّياً، **2775 استعلاماً** في معاملة واحدة، 1318 أُدرجت و118 ردّها قيد المرجع؛ الإعادة 139 استعلاماً و0 تكرار |
| استعادة النسخة `full/` في `tph_restore` | 51/51 جدولاً تطابق البصمة؛ مؤثِّرات 7، قيود 691، فهارس 164، دوالّ 44 = `tph_ops` — **بشرط** `set check_function_bodies = off` |
| الصفحات الثقيلة (١٢) | 4–23 استعلاماً، 12–40ms محلّياً |
| ٥ مستندات إلى `/api/analyze` | 6 نداءات للمستند على 503؛ 409 بلا نداء للمرفوع؛ 404 ← نداءان ورسالة واضحة |

## ما لم يُفحَص
- مسار الذكاء الناجح بكلفته الفعليّة (المزيَّف لم يُطابق نصّ الملفّات بعد إلحاق بايت، فردّ 503).
- `/api/drive-sync` حيّاً على نسخة الأرشيف (لا ملفّ PDF خارج القاعدة؛ الجديد ٩٧ ملفّاً نصّيّاً).
- زمن الرحلة إلى Neon من Vercel، وإعداد Fluid/المنطقة/الخطّة (يحتاج لوحة Vercel).
- `migrate.ts` و`verify-invariants.ts` و`identity-report.ts` تشغيلاً (رفضها مصنِّف الأدوات).


---

## CODE


> مولَّدة من `$SP/code-probe/scan.cjs` ثمّ `coverage.cjs`. الأعمدة آليّة: الأسطر، والصادرات الميّتة، والصادرات التي لا يستوردها إلّا اختبارها، وعدد `as` و`!`. والحكم: رقم ملاحظةٍ، أو «سليم آليّاً» حين لا صادرَ ميّتاً ولا ملفّاً فوق ٤٠٠ سطر ولا ملاحظة.
> «سليم آليّاً» معناه: مرّ على المسح الآليّ وعلى حرّاس التحويل والمعاملة (`tx.cjs`: ٢٢ معاملة، صفر كتابة بـ`db` داخلها، صفر استدعاءٍ لدالّةٍ تكتب بـ`db` بلا مقبض). ولا يعني أنّ منطقه الماليّ رُوجع سطراً سطراً — ذلك عند FIN.

## src/lib (113)

| الملفّ | أسطر | ميّت | للاختبار وحده | as | ! | الحكم |
|---|---:|---:|---:|---:|---:|---|
| `src/lib/ai/deadline.ts` | 34 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/ai/deepseek.ts` | 412 | 1 | 0 | 3 | 0 | OPS-101 (عند غيري) · `contentHash` ميّت · CODE-105 (ميّت: `contentHash`) |
| `src/lib/ai/document-input.ts` | 250 | 0 | 1 | 1 | 2 | سليم آليّاً |
| `src/lib/ai/finding-labels.ts` | 47 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/ai/models.ts` | 124 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/lib/ai/pdf-images.ts` | 142 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/ai/supplier-analysis.ts` | 406 | 2 | 1 | 2 | 2 | CODE-105 (ميّت: `FINDING_LABEL`، `SEVERITY_LABEL`) |
| `src/lib/allocation.ts` | 203 | 0 | 0 | 0 | 0 | سليم — مختبَر نقيّاً (`planAllocations`) |
| `src/lib/analytics.ts` | 375 | 1 | 4 | 0 | 4 | CODE-105 (ميّت: `AGE_LABEL`) |
| `src/lib/arabic.ts` | 221 | 1 | 1 | 0 | 0 | CODE-105 (ميّت: `TRANSFER`) |
| `src/lib/archive-import.ts` | 74 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/attention-facts.ts` | 385 | 0 | 0 | 3 | 0 | CODE-104 · CODE-107 |
| `src/lib/attention.ts` | 558 | 0 | 0 | 0 | 2 | CODE-110 · CODE-107 |
| `src/lib/audit.ts` | 104 | 0 | 0 | 3 | 0 | سليم آليّاً |
| `src/lib/bank/adjudicate.ts` | 149 | 1 | 3 | 0 | 0 | CODE-105 (ميّت: `HIGH_VALUE_MINOR`) |
| `src/lib/bank/adjudicator-prompt.ts` | 154 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/adjudicator-provider.ts` | 271 | 0 | 6 | 5 | 0 | CODE-106 (أربعة مزوّدين للاختبار وحده) |
| `src/lib/bank/apply.ts` | 73 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/balance-equation.ts` | 196 | 0 | 3 | 0 | 0 | CODE-106 (`reconcileAccount` للاختبار) |
| `src/lib/bank/candidates.ts` | 420 | 0 | 8 | 0 | 0 | CODE-110 |
| `src/lib/bank/canonical.ts` | 278 | 0 | 4 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/classification.ts` | 319 | 1 | 1 | 0 | 0 | CODE-105 (ميّت: `LAYER_SOURCE`) |
| `src/lib/bank/coverage.ts` | 135 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/decision.ts` | 112 | 0 | 4 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/double-paid.ts` | 146 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/entities.ts` | 209 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/entity-candidates.ts` | 162 | 0 | 5 | 0 | 0 | CODE-106 (`proposeEntities` للاختبار) |
| `src/lib/bank/evidence-uniqueness.ts` | 50 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/fees.ts` | 78 | 0 | 3 | 0 | 0 | CODE-106 (`splitGroupFee` للاختبار) |
| `src/lib/bank/identity.ts` | 88 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/lifecycle.ts` | 109 | 1 | 3 | 0 | 0 | CODE-105 (ميّت: `LIFECYCLE_LABEL`) |
| `src/lib/bank/match.ts` | 252 | 1 | 2 | 0 | 0 | CODE-105 (ميّت: `BankMatch`) |
| `src/lib/bank/metrics.ts` | 164 | 0 | 1 | 0 | 0 | نصٌّ وحده (`db:measure`) — مقصود |
| `src/lib/bank/optimizer.ts` | 252 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/parse.ts` | 335 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/parsers/adapters.ts` | 122 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/parsers/detect.ts` | 134 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/parsers/pdf-text.ts` | 158 | 0 | 0 | 1 | 2 | سليم آليّاً |
| `src/lib/bank/parsers/safe-xlsx.ts` | 142 | 0 | 5 | 5 | 0 | `as unknown as` ×٢ مبرَّر (نزع مفاتيح النموذج الأوّل) |
| `src/lib/bank/pattern.ts` | 213 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/pending.ts` | 86 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/pos.ts` | 179 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/reason-codes.ts` | 128 | 0 | 1 | 2 | 0 | سليم آليّاً |
| `src/lib/bank/reversal.ts` | 102 | 0 | 4 | 0 | 0 | CODE-106 (اختبارٌ وحده) |
| `src/lib/bank/review-queue.ts` | 133 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/rules.ts` | 135 | 1 | 1 | 0 | 0 | CODE-105 (ميّت: `NON_SUPPLIER_CATEGORIES`) |
| `src/lib/bank/statement-balances.ts` | 84 | 0 | 1 | 3 | 0 | سليم آليّاً |
| `src/lib/bank/strength.ts` | 15 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/supplier-profile.ts` | 163 | 0 | 1 | 0 | 1 | سليم آليّاً |
| `src/lib/bank/sync.ts` | 396 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/taxonomy.ts` | 102 | 5 | 1 | 0 | 0 | CODE-105 (ميّت: `REVENUE_KINDS`، `POS_COST_KINDS`، `NON_OPERATIONAL`، `OUTCOME_LABEL`، `DISPOSITION_LABEL`) |
| `src/lib/bank/verdict-policy.ts` | 164 | 0 | 4 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/vision-statement.ts` | 233 | 1 | 1 | 0 | 0 | CODE-105 (ميّت: `VISION_PROMPT_VERSION`) |
| `src/lib/canonical-name.ts` | 96 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/cashflow.ts` | 265 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/changes-facts.ts` | 91 | 0 | 0 | 0 | 0 | UI-001 (عند غيري) |
| `src/lib/changes.ts` | 201 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/confirm.ts` | 162 | 0 | 0 | 0 | 1 | سليم آليّاً |
| `src/lib/credit-notes.ts` | 87 | 0 | 2 | 0 | 0 | CODE-106 (نصف وصل) |
| `src/lib/data-health-facts.ts` | 44 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/data-health.ts` | 191 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/drive-sync.ts` | 135 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/drive.ts` | 332 | 0 | 0 | 3 | 0 | سليم — `renameFile` يستدعيها `drive-rename` وحده |
| `src/lib/expenses.ts` | 415 | 0 | 3 | 1 | 0 | CODE-110 |
| `src/lib/extraction/benchmark.ts` | 200 | 0 | 5 | 2 | 0 | CODE-106 · CODE-003 قائمة |
| `src/lib/extraction/extract.ts` | 174 | 0 | 0 | 4 | 0 | سليم آليّاً |
| `src/lib/extraction/index.ts` | 58 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/extraction/pipeline.ts` | 285 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/extraction/provider-deepseek.ts` | 310 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/lib/extraction/provider-gemini.ts` | 296 | 0 | 1 | 2 | 0 | سليم آليّاً |
| `src/lib/extraction/provider-ollama.ts` | 138 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/lib/extraction/provider.ts` | 90 | 0 | 0 | 2 | 0 | سليم آليّاً |
| `src/lib/extraction/schema.ts` | 115 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/extraction/schemas-by-kind.ts` | 231 | 1 | 6 | 2 | 0 | CODE-105 (ميّت: `utilityExtractionSchema`) |
| `src/lib/extraction/statement-extras.ts` | 95 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/lib/extraction/validate-extraction.ts` | 242 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/extraction/versions.ts` | 68 | 1 | 0 | 0 | 0 | CODE-105 (ميّت: `provenance`) |
| `src/lib/filing.ts` | 97 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/http-client.ts` | 103 | 0 | 0 | 5 | 0 | سليم آليّاً |
| `src/lib/id.ts` | 5 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/invoice-filter.ts` | 108 | 0 | 0 | 2 | 0 | سليم آليّاً |
| `src/lib/issue-codes.ts` | 53 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/items.ts` | 117 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/line-pricing.ts` | 195 | 0 | 0 | 1 | 14 | سليم آليّاً |
| `src/lib/money.ts` | 98 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/month-close-facts.ts` | 177 | 0 | 0 | 0 | 0 | CODE-104 |
| `src/lib/month-close.ts` | 283 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/naming.ts` | 295 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/nav.ts` | 201 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/ops/db-identity.ts` | 134 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/ops/production-gate.ts` | 124 | 0 | 1 | 0 | 0 | CODE-108 (١٦ بنداً والوثيقة ١٥) |
| `src/lib/ops/truth-audit.ts` | 235 | 0 | 1 | 0 | 0 | نصٌّ وحده — مقصود |
| `src/lib/payment-run.ts` | 181 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/payment-state.ts` | 162 | 1 | 5 | 0 | 0 | CODE-105 (ميّت: `OPEN_STATUSES`) |
| `src/lib/permissions.ts` | 113 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/preview-mode.ts` | 37 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/products.ts` | 147 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/provenance-facts.ts` | 250 | 0 | 0 | 0 | 9 | سليم آليّاً |
| `src/lib/provenance.ts` | 96 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/rate-limit.ts` | 121 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/riyadh-time.ts` | 34 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/sales/connector.ts` | 121 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/search.ts` | 175 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/session.ts` | 93 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/statement-match.ts` | 384 | 0 | 1 | 0 | 5 | سليم آليّاً |
| `src/lib/supplier-account.ts` | 138 | 0 | 0 | 0 | 1 | سليم آليّاً |
| `src/lib/supplier-balances.ts` | 86 | 0 | 0 | 0 | 0 | سليم — نقيّ ومختبَر |
| `src/lib/supplier-health.ts` | 157 | 0 | 5 | 0 | 0 | سليم آليّاً |
| `src/lib/supplier-match.ts` | 223 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/suppliers-seed.ts` | 135 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/token-crypto.ts` | 58 | 0 | 2 | 0 | 0 | سليم — كلّ `setCredentials` يمرّ بـ`openToken` (٤ من ٤) |
| `src/lib/unit-conversion.ts` | 146 | 0 | 6 | 0 | 0 | CODE-106 (اختبارٌ وحده) |
| `src/lib/validation.ts` | 217 | 0 | 2 | 0 | 0 | سليم آليّاً |

## src/services (23)

| الملفّ | أسطر | ميّت | للاختبار وحده | as | ! | الحكم |
|---|---:|---:|---:|---:|---:|---|
| `src/services/adjudicator.service.ts` | 329 | 0 | 1 | 3 | 0 | سليم آليّاً |
| `src/services/bank-account.service.ts` | 91 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/services/counterparty.service.ts` | 317 | 0 | 0 | 2 | 0 | CODE-109 (`as EvidenceKind`/`as IdentityKind` — مبرَّران اليوم) |
| `src/services/document.service.ts` | 109 | 0 | 0 | 3 | 0 | سليم آليّاً |
| `src/services/drive.service.ts` | 112 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/services/expense.service.ts` | 358 | 1 | 0 | 4 | 0 | CODE-105 (ميّت: `expensesOfMonth`) |
| `src/services/guard.ts` | 46 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/invoice.service.ts` | 191 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/month-guard.ts` | 31 | 0 | 0 | 0 | 0 | CODE-102 (بلا اختبار قاعدة) |
| `src/services/payment.service.ts` | 403 | 0 | 0 | 0 | 0 | CODE-102 (بلا اختبار قاعدة) |
| `src/services/product.service.ts` | 225 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/rate-limit.service.ts` | 73 | 1 | 0 | 0 | 0 | CODE-105 (ميّت: `currentCount`) |
| `src/services/reconcile.service.ts` | 429 | 0 | 0 | 0 | 4 | CODE-110 |
| `src/services/search.service.ts` | 253 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/statement-file.service.ts` | 192 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/statement-vision.service.ts` | 239 | 0 | 0 | 2 | 0 | CODE-106 (claude/gemini محلّيّان) |
| `src/services/supplier-analysis.service.ts` | 456 | 0 | 0 | 6 | 4 | CODE-110 |
| `src/services/supplier-balance.service.ts` | 95 | 0 | 0 | 0 | 0 | سليم — المصدر الواحد لـ«عليك» |
| `src/services/supplier-credit.service.ts` | 315 | 1 | 0 | 0 | 2 | CODE-102 (بلا اختبار قاعدة) · CODE-105 (`invoiceSupplier` ميّت) |
| `src/services/supplier-profile.service.ts` | 56 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/supplier.service.ts` | 165 | 2 | 0 | 0 | 0 | CODE-105 (`learnAlias` و`loadActiveSuppliers` ميّتان) |
| `src/services/types.ts` | 20 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/validation.service.ts` | 95 | 0 | 0 | 0 | 2 | سليم آليّاً |

## src/components (33)

| الملفّ | أسطر | ميّت | للاختبار وحده | as | ! | الحكم |
|---|---:|---:|---:|---:|---:|---|
| `src/components/ai-analysis.tsx` | 313 | 0 | 0 | 4 | 0 | سليم آليّاً |
| `src/components/attention-list.tsx` | 149 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/bank-import.tsx` | 572 | 0 | 0 | 1 | 0 | CODE-110 |
| `src/components/changes.tsx` | 91 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/confirm-document.tsx` | 38 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/derive-expenses.tsx` | 53 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/drive-rename.tsx` | 227 | 0 | 0 | 3 | 0 | سليم آليّاً |
| `src/components/drive-sync.tsx` | 425 | 0 | 0 | 3 | 0 | CODE-110 |
| `src/components/expense-reclassify.tsx` | 146 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/components/figure.tsx` | 139 | 0 | 0 | 0 | 1 | سليم آليّاً |
| `src/components/hub.tsx` | 81 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/manual-expense.tsx` | 92 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/components/mark-invoice-paid.tsx` | 211 | 0 | 0 | 2 | 0 | سليم آليّاً |
| `src/components/match-explain.tsx` | 191 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/money.tsx` | 29 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/month-close.tsx` | 328 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/components/nav.tsx` | 244 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/page-shell.tsx` | 112 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/page-skeleton.tsx` | 40 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/payment-run-actions.tsx` | 111 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/product-mapping.tsx` | 432 | 0 | 0 | 1 | 1 | CODE-110 |
| `src/components/reconcile-queue.tsx` | 426 | 0 | 0 | 0 | 4 | CODE-110 |
| `src/components/recurring-expenses.tsx` | 205 | 0 | 0 | 3 | 0 | سليم آليّاً |
| `src/components/reject-document.tsx` | 47 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/review-workspace.tsx` | 647 | 0 | 0 | 0 | 0 | CODE-110 |
| `src/components/scroll-x.tsx` | 81 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/search-box.tsx` | 195 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/components/statement-reconcile.tsx` | 344 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/trial-banner.tsx` | 19 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/ui-client.tsx` | 171 | 2 | 0 | 2 | 0 | CODE-105 (ميّت: `StickyActions`، `Progress`) |
| `src/components/ui.tsx` | 392 | 1 | 0 | 0 | 0 | CODE-105 (ميّت: `ErrorState`) |
| `src/components/uploader.tsx` | 800 | 0 | 0 | 3 | 0 | CODE-110 |
| `src/components/user-menu.tsx` | 31 | 0 | 0 | 0 | 0 | سليم آليّاً |

## src/db (2)

| الملفّ | أسطر | ميّت | للاختبار وحده | as | ! | الحكم |
|---|---:|---:|---:|---:|---:|---|
| `src/db/index.ts` | 38 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/db/schema.ts` | 1304 | 0 | 0 | 0 | 0 | CODE-106 (`branches`) · CODE-111 |

## ملفّات الاختبار (102) — تصنيف

التصنيف: **نقيّ** (دوالّ بلا إدخال/إخراج) · **محاكاة** (`vi.fn`/`vi.stubGlobal` على حدّ الشبكة) · **حارس نصّيّ** (يقرأ الشيفرة أو الوثيقة) · **يلمس قاعدة**. عدد ما يلمس قاعدة: **صفر**.

| الاختبار | الحالات | التصنيف | يُخدَع؟ / ملاحظة |
|---|---:|---|---|
| `src/lib/ai/deadline.test.ts` | 4 | نقيّ | — |
| `src/lib/ai/deepseek.test.ts` | 18 | محاكاة | حدّ الشبكة مشروع — لا يحاكي المختبَر |
| `src/lib/ai/document-input.test.ts` | 9 | نقيّ | — |
| `src/lib/ai/supplier-analysis.test.ts` | 10 | نقيّ | — |
| `src/lib/allocation-sql.test.ts` | 5 | حارس نصّيّ | جزئيّاً — نافذة ٢٠٠/١٢٠ حرفاً، ويُمسك `${table.col}` بعد `where` وحده |
| `src/lib/allocation.test.ts` | 19 | نقيّ | نقيّ — `planAllocations` لا `allocate` ولا مؤثِّر ٠٢٦ |
| `src/lib/analytics.test.ts` | 35 | نقيّ | — |
| `src/lib/arabic.test.ts` | 10 | نقيّ | — |
| `src/lib/archive-import.test.ts` | 9 | نقيّ | — |
| `src/lib/attention.test.ts` | 35 | نقيّ | — |
| `src/lib/audit.test.ts` | 5 | نقيّ | — |
| `src/lib/bank/adjudicate.test.ts` | 11 | نقيّ | — |
| `src/lib/bank/adjudicator-prompt.test.ts` | 12 | نقيّ | — |
| `src/lib/bank/adjudicator-provider.test.ts` | 13 | محاكاة | حدّ الشبكة — ويختبر ثلاثة مزوّدين لا يُستدعَون (CODE-106) |
| `src/lib/bank/apply.test.ts` | 6 | نقيّ | — |
| `src/lib/bank/balance-equation.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/candidates.test.ts` | 35 | نقيّ | — |
| `src/lib/bank/canonical.test.ts` | 22 | نقيّ | — |
| `src/lib/bank/classification.test.ts` | 36 | نقيّ | — |
| `src/lib/bank/coverage.test.ts` | 12 | نقيّ | — |
| `src/lib/bank/double-paid.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/entities.test.ts` | 14 | نقيّ | — |
| `src/lib/bank/entity-candidates.test.ts` | 13 | نقيّ | — |
| `src/lib/bank/evidence-uniqueness.test.ts` | 5 | نقيّ | — |
| `src/lib/bank/fees.test.ts` | 9 | نقيّ | — |
| `src/lib/bank/identity.test.ts` | 3 | نقيّ | — |
| `src/lib/bank/lifecycle.test.ts` | 11 | نقيّ | — |
| `src/lib/bank/match.test.ts` | 22 | نقيّ | — |
| `src/lib/bank/metrics.test.ts` | 11 | نقيّ | — |
| `src/lib/bank/optimizer.test.ts` | 26 | نقيّ | — |
| `src/lib/bank/parse.test.ts` | 15 | نقيّ | — |
| `src/lib/bank/parsers/adapters.test.ts` | 6 | نقيّ | — |
| `src/lib/bank/parsers/detect.test.ts` | 8 | نقيّ | — |
| `src/lib/bank/parsers/pdf-text.test.ts` | 7 | نقيّ | — |
| `src/lib/bank/parsers/safe-xlsx.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/pattern.test.ts` | 15 | نقيّ | — |
| `src/lib/bank/pos.test.ts` | 14 | نقيّ | — |
| `src/lib/bank/reason-codes.test.ts` | 12 | نقيّ | — |
| `src/lib/bank/reversal.test.ts` | 10 | نقيّ | يختبر وحدةً لا يصل إليها شيء (CODE-106) |
| `src/lib/bank/review-queue.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/rules.test.ts` | 15 | نقيّ | — |
| `src/lib/bank/statement-balances.test.ts` | 4 | نقيّ | — |
| `src/lib/bank/supplier-profile.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/sync.test.ts` | 31 | نقيّ | — |
| `src/lib/bank/verdict-policy.test.ts` | 12 | نقيّ | — |
| `src/lib/bank/vision-statement.test.ts` | 16 | نقيّ | — |
| `src/lib/canonical-name.test.ts` | 8 | نقيّ | — |
| `src/lib/cashflow.test.ts` | 18 | نقيّ | — |
| `src/lib/changes.test.ts` | 15 | نقيّ | — |
| `src/lib/code-guards.test.ts` | 7 | حارس نصّيّ | نعم — CODE-101: الانتظام يرى `async (x) => {` وحده |
| `src/lib/confirm.test.ts` | 13 | نقيّ | — |
| `src/lib/credit-notes.test.ts` | 11 | نقيّ | — |
| `src/lib/data-health.test.ts` | 8 | نقيّ | — |
| `src/lib/docs-claims.test.ts` | 4 | حارس نصّيّ | جزئيّاً — CODE-108: لا يفحص الأعداد (بنود البوّابة، السيناريوهات، الجداول) |
| `src/lib/drive-sync.test.ts` | 4 | نقيّ | نقيّ بعميلٍ مصنوع (`as unknown as`) — مشروع |
| `src/lib/expenses.test.ts` | 53 | نقيّ | — |
| `src/lib/extraction/benchmark.test.ts` | 13 | نقيّ | يختبر وحدةً لا يستعملها نصّ القياس (CODE-003) |
| `src/lib/extraction/calendar-date.test.ts` | 2 | نقيّ | — |
| `src/lib/extraction/pipeline.test.ts` | 21 | نقيّ | — |
| `src/lib/extraction/provider-parity.test.ts` | 4 | نقيّ | — |
| `src/lib/extraction/provider.test.ts` | 20 | محاكاة | حدّ الشبكة مشروع |
| `src/lib/extraction/schemas-by-kind.test.ts` | 17 | نقيّ | — |
| `src/lib/extraction/statement-extras.test.ts` | 6 | نقيّ | — |
| `src/lib/extraction/validate-extraction.test.ts` | 18 | نقيّ | — |
| `src/lib/filing.test.ts` | 10 | نقيّ | — |
| `src/lib/invoice-filter.test.ts` | 11 | نقيّ | — |
| `src/lib/items.test.ts` | 17 | نقيّ | — |
| `src/lib/line-pricing.test.ts` | 19 | نقيّ | — |
| `src/lib/money.rounding.test.ts` | 5 | نقيّ | — |
| `src/lib/money.test.ts` | 8 | نقيّ | — |
| `src/lib/month-close.test.ts` | 24 | نقيّ | نقيّ — الموانع لا `month-guard` ولا مؤثِّرات ٠٢٨ |
| `src/lib/naming.test.ts` | 27 | نقيّ | — |
| `src/lib/nav.test.ts` | 21 | نقيّ | — |
| `src/lib/ops/db-identity.test.ts` | 13 | نقيّ | — |
| `src/lib/ops/production-gate.test.ts` | 7 | نقيّ | — |
| `src/lib/ops/truth-audit.test.ts` | 15 | نقيّ | — |
| `src/lib/payment-run.test.ts` | 17 | نقيّ | — |
| `src/lib/payment-state.test.ts` | 21 | نقيّ | — |
| `src/lib/permissions.test.ts` | 9 | نقيّ | — |
| `src/lib/permissions.writes.test.ts` | 4 | نقيّ | — |
| `src/lib/preview-mode.test.ts` | 10 | نقيّ | — |
| `src/lib/products.test.ts` | 12 | نقيّ | — |
| `src/lib/provenance.test.ts` | 11 | نقيّ | — |
| `src/lib/rate-limit.test.ts` | 10 | نقيّ | — |
| `src/lib/riyadh-time.test.ts` | 2 | نقيّ | — |
| `src/lib/sales/connector.test.ts` | 5 | نقيّ | — |
| `src/lib/search.test.ts` | 26 | نقيّ | — |
| `src/lib/statement-match.test.ts` | 26 | نقيّ | — |
| `src/lib/supplier-account.test.ts` | 13 | نقيّ | — |
| `src/lib/supplier-balances.test.ts` | 4 | نقيّ | نقيّ — الدالّة لا الاستعلام في `supplier-balance.service.ts` |
| `src/lib/supplier-health.test.ts` | 21 | نقيّ | — |
| `src/lib/supplier-match.test.ts` | 21 | نقيّ | — |
| `src/lib/suppliers-seed.test.ts` | 9 | نقيّ | — |
| `src/lib/token-crypto.test.ts` | 5 | نقيّ | — |
| `src/lib/ui-terms.test.ts` | 2 | حارس نصّيّ | نعم — CODE-107: `.tsx` وحده وثمانية أسماء، و٢٥ عدداً في `.ts` خارجه |
| `src/lib/unit-conversion.test.ts` | 13 | نقيّ | يختبر وحدةً لا يصل إليها شيء (CODE-106) |
| `src/lib/validation.test.ts` | 20 | نقيّ | — |
| `src/services/adjudicator.service.test.ts` | 12 | محاكاة | مزوّدٌ محقون بـ`vi.fn` — يختبر السياسة لا النداء |
| `src/services/bank-account.service.test.ts` | 5 | نقيّ | نقيّ — التوحيد وحده |
| `src/services/counterparty.service.test.ts` | 9 | نقيّ | نقيّ على دوالّ الخدمة الصرفة — لا `confirmCounterparty` بقاعدة |
| `src/services/reconcile-matrix.test.ts` | 22 | نقيّ | نقيّ — مصفوفة حالات |
| `src/services/reconcile.service.test.ts` | 24 | نقيّ | نقيّ — المحرّك بمدخلاتٍ مصنوعة، لا الجسر مع القاعدة |

**المجموع:** 273 بنداً، المحكوم عليه 273 (١٠٠٪).


---

## BTN


الطريقة: قراءة الملفّ + زحف HTML بخمس جلسات (مالك · محاسب · مشتريات · منتهية · بلا جلسة) لكلّ صفحة + طلب كلّ `href` داخليّ (١٢٨ رابطاً فريداً، كلّها 200 ولا 404 ولا «تعذّر العرض») + إرسال الطلبات الكاتبة بـcurl على `tph_btn` مع عدّ الصفوف قبل وبعد.
الرموز: **ش** قُرئت الشيفرة · **ز** زُحفت بالأدوار · **ط** أُرسل طلبها الكاتب · **—** لا تنطبق.

## الصفحات (`src/app`، غير api)

| الملف | ش | ز | ط | الحكم / المعرّف |
|---|---|---|---|---|
| `page.tsx` (/) | ✓ | ✓ | — | المشتريات → `/upload` · روابط الأرقام: UI-001/002 (غيري) |
| `layout.tsx` · `loading.tsx` · `error.tsx` · `global-error.tsx` · `not-found.tsx` | ✓ | — | — | سليم (زرّ «أعد المحاولة» لم يُفحَص في متصفّح) |
| `login/page.tsx` | ✓ | ✓ | ✗ | زرّ جوجل لم يُضغط (خدمة خارجية) |
| `attention/page.tsx` | ✓ | ✓ | — | BTN-110 · BTN-111 · BTN-112 |
| `audit/page.tsx` · `dashboard/page.tsx` | ✓ | ✓ | — | تحويل دائم يعمل |
| `bank/page.tsx` | ✓ | ✓ | ✓ | BTN-101 · 102 · 103 · 104 · 106 · 113 |
| `review/page.tsx` | ✓ | ✓ | ✓ | الطابور فارغ في اللقطة؛ الأزرار فُحصت بطلباتها |
| `close/page.tsx` | ✓ | ✓ | ✓ | سليم (المنع والإعادة للمالك وحده مُثبَتان) |
| `documents/page.tsx` | ✓ | ✓ | ✓ | **BTN-108** · BTN-109 |
| `money/page.tsx` | ✓ | ✓ | — | FIN-103 (غيري) |
| `money/expenses/page.tsx` | ✓ | ✓ | ✓ | BTN-111 · BTN-114 |
| `money/statement/page.tsx` | ✓ | ✓ | — | لا عنصر تفاعليّ غير القشرة |
| `payments/page.tsx` | ✓ | ✓ | ✓ | **BTN-108** (يظهر فيها) · FIN-101 (غيري) |
| `performance/page.tsx` | ✓ | ✓ | — | سليم |
| `purchases/page.tsx` · `insights/page.tsx` · `invoices/page.tsx` · `products/page.tsx` | ✓ | ✓ | جزئيّ | ai-findings بدور المحاسب ✓ · product لم يُرسَل |
| `analysis/page.tsx` | ✓ | ✓ | — | سليم |
| `review` · `settings/page.tsx` · `settings/audit/page.tsx` | ✓ | ✓ | ✓ | BTN-113 |
| `statements/page.tsx` | ✓ | ✓ | ✗ | «طابِق» يستدعي النموذج — لم يُرسَل |
| `suppliers/page.tsx` · `suppliers/[slug]/page.tsx` | ✓ | ✓ | — | BTN-110 · BTN-032 جزئيّة |
| `upload/page.tsx` | ✓ | ✓ | ✗ | الرفع والمزامنة لم تُرسَل (SEC-102/104/106 عند غيري) |
| كلّ `loading.tsx` (١٤) | ✓ | — | — | هيكلٌ بلا عناصر تفاعليّة |

## المكوّنات (`src/components`، ٣٢) و`lib`

| الملف | ش | ط | ملاحظة |
|---|---|---|---|
| page-shell · nav · user-menu · trial-banner · search-box · hub · figure · changes · scroll-x · page-skeleton · money · ui · ui-client | ✓ | search ✓ | BTN-021 جزئيّة · «خروج» لم يُضغط |
| attention-list | ✓ | — | BTN-110/111/112 |
| bank-import | ✓ | ✗ (bank-rule ✓) | الاستيراد لم يُرسَل بملفّ |
| reconcile-queue · review-workspace · match-explain | ✓ | ✓ | BTN-102/103/104/106 |
| mark-invoice-paid · payment-run-actions | ✓ | ✓ | BTN-105 · FIN-101 |
| month-close | ✓ | ✓ | سليم |
| statement-reconcile | ✓ | ✗ | BTN-029 أُصلحت |
| recurring-expenses · manual-expense · derive-expenses · expense-reclassify | ✓ | record ✓ · counterparty ✓ | BTN-114 · BTN-019 جزئيّة |
| confirm-document · reject-document | ✓ | ✓ | **BTN-108** · BTN-109 |
| uploader · drive-sync · drive-rename | grep للأزرار | supplier ✓ | لم تُقرأ سطراً سطراً |
| product-mapping · ai-analysis | grep للأزرار | ai-findings ✓ | لم تُقرأ سطراً سطراً |
| `lib/nav.ts` · `lib/http-client.ts` · `lib/attention.ts` | ✓ | روابط attention قُورنت أعدادها | BTN-110/111/112 |

## الواجهات (٢٥)

كلّها مجرودة في التقرير (جدول الواجهات). أُرسل طلبٌ حقيقيّ إلى: match-confirm (٤ فروع) · match-confirm-bulk (بالقراءة) · match-undo · mark-paid · counterparty · document-status · month-close · expense-actual · supplier · bank-rule · ai-findings · payment-run · search · health. لم يُرسَل: analyze · archive · bank-import · drive-sync · drive-rename · statement-reconcile · product · expense · ai-analysis · ops/db-identity · auth.

## النسبة
- صفحات: ٢٥/٢٥ قراءةً وزحفاً (١٠٠٪) · روابط داخليّة: ١٢٨/١٢٨ طُلبت.
- مكوّنات: ٣٢/٣٢ جُردت أزرارها؛ ٢٥ قُرئت كاملةً و٧ بـgrep (≈٧٨٪ قراءةً كاملة).
- واجهات: ٢٥/٢٥ جُردت؛ ١٤ أُرسل طلبها (٥٦٪).


---

## UX


المرجع: `main` عند `375f0d7`. الخادم: `next start` على `127.0.0.1:3800` بقاعدة `tph_code` (قراءة فقط)، جلستا المالك والمشتريات.
الأدوات (في `$SP/ux-probe/`): `colors.mjs` (رموز globals.css + أصناف الألوان في كلّ `.tsx`)، `html-audit.mjs` (تباينٌ بالتعشيش الفعليّ في HTML المُصيَّر + الأرقام + التواريخ + تمييز العدد + الحقول)، `acts.mjs` (جرد الأزرار والروابط)، ومسحٌ للحقول (`label`/`aria-label`/`inputMode`).
HTML المُصيَّر: ٢٦ مساراً للمالك (`html/`) و١٩ للمشتريات (`html-p/`).

**نسبة التغطية: ١٠٠٪ من الملفّات المطلوبة (٤٥ صفحة/تخطيط/حالة + ٣٢ مكوّناً + ٤ ملفّات مكتبة/نمط).**
«رُوجع» تعني: مُسح آليّاً بالأدوات الأربع (الألوان والأرقام والحقول والأصناف الفيزيائيّة والأسهم) **و**قُرئ الموضع الذي ظهر فيه أثر. الحكم «سليم» يعني أنّ الأدوات لم تجد فيه شيئاً في نطاق «ط»، لا أنّه قُرئ سطراً سطراً.

## الصفحات (`src/app/**/page.tsx` و`layout.tsx` وحالاتها)
| الملفّ | HTML مُصيَّر؟ | الحكم |
|---|---|---|
| `layout.tsx` | نعم (كلّ الصفحات) | سليم — `lang="ar" dir="rtl"` |
| `page.tsx` (`/`) | نعم | UX-104، UX-106، UX-109؛ وعند المنسّق UI-001..004 |
| `attention/page.tsx` | نعم | UX-104، UX-105 |
| `audit/page.tsx` و`dashboard/page.tsx` | نعم (تحويل) | سليم — تحويلٌ دائم |
| `bank/page.tsx` | نعم | UX-107، UX-108، UX-110 |
| `close/page.tsx` | نعم | UX-103 (عبر `month-close.tsx`)، UX-110 |
| `documents/page.tsx` | نعم | UX-110؛ عند المنسّق UI-006 |
| `error.tsx` · `global-error.tsx` · `not-found.tsx` | نعم (404) | سليم — UX-013 القديمة أُصلحت |
| `loading.tsx` (١٦ ملفّاً) | نعم (مضمَّنة في البثّ) | UX-112 (`money/loading` يسمّي «كشف الحساب» «المال») |
| `login/page.tsx` | نعم | سليم |
| `money/page.tsx` | نعم | UX-101 (الخريطة) |
| `money/expenses/page.tsx` | نعم | UX-110 |
| `money/statement/page.tsx` | نعم | UX-112 |
| `payments/page.tsx` | نعم | UX-110 (UX-031 القديمة) |
| `performance/page.tsx` | نعم | UX-101 |
| `purchases/page.tsx` | نعم | UX-105 (`toLocaleString`) |
| `purchases/insights/page.tsx` | نعم | UX-101، UX-102 |
| `purchases/invoices/page.tsx` | نعم | UX-110 |
| `purchases/products/page.tsx` | نعم | UX-103 |
| `analysis/page.tsx` | نعم | UX-101 |
| `review/page.tsx` | نعم (المحتوى في مكوّن عميل) | سليم في «ط» عدا ما في مكوّناته |
| `settings/page.tsx` | نعم | سليم (UX-017 القديمة أُصلحت) |
| `settings/audit/page.tsx` | نعم | UX-108، UX-111 |
| `statements/page.tsx` | نعم | UX-103 (عبر `statement-reconcile.tsx`) |
| `suppliers/page.tsx` | نعم | SCN-105 عند غيري |
| `suppliers/[slug]/page.tsx` | نعم (`GoldenCup`) | UX-110 |
| `upload/page.tsx` | نعم | BTN-116 عند غيري |

## المكوّنات (`src/components/**`)
| الملفّ | الحكم |
|---|---|
| `ai-analysis.tsx` | UX-105 (`${count} اقتراح`)، UX-109 |
| `attention-list.tsx` | سليم (التباين ≥ ٨٫٣٦ مع `opacity-70`) |
| `bank-import.tsx` | UX-103 (حقلان وقائمتان بلا اسم)، UX-105 |
| `changes.tsx` | عند المنسّق UI-002/003 |
| `confirm-document.tsx` · `reject-document.tsx` | سليم |
| `derive-expenses.tsx` | UX-113 (هدف لمس) |
| `drive-rename.tsx` | سليم |
| `drive-sync.tsx` | UX-105 (`عرض سعر`) |
| `expense-reclassify.tsx` | UX-113 |
| `figure.tsx` | سليم |
| `hub.tsx` | سليم (UX-017 أُصلحت: حدٌّ متقطّع بلا شفافيّة) |
| `manual-expense.tsx` | سليم (`aria-label` و`inputMode`) |
| `mark-invoice-paid.tsx` | UX-109؛ BTN-027 عند غيري |
| `match-explain.tsx` | UX-107؛ UI-005 عند المنسّق |
| `money.tsx` | سليم |
| `month-close.tsx` | UX-103 (قائمة الشهر وحقل السبب) |
| `nav.tsx` | UX-101، UX-112 |
| `page-shell.tsx` · `page-skeleton.tsx` · `trial-banner.tsx` · `user-menu.tsx` | سليم |
| `payment-run-actions.tsx` | سليم |
| `product-mapping.tsx` | UX-103 |
| `reconcile-queue.tsx` | سليم في «ط» (الحقول ملفوفة بـ`label`) |
| `recurring-expenses.tsx` | سليم (UX-030 أُصلحت) |
| `review-workspace.tsx` | UX-109 |
| `scroll-x.tsx` | سليم |
| `search-box.tsx` | سليم (UX-029 أُصلحت: `combobox`/`listbox`) |
| `statement-reconcile.tsx` | UX-103، UX-113 |
| `ui-client.tsx` · `ui.tsx` | UX-114 (حدود الحقول ١٫٢٧:١)؛ الجدول يصير بطاقات ✓ |
| `uploader.tsx` | UX-103، UX-115 |

## الأنماط والمكتبات
| الملفّ | الحكم |
|---|---|
| `src/app/globals.css` | التباين محسوباً لكلّ الرموز (الجدول ١ في findings-ux.md)؛ UX-114؛ `--ring` ≥ ٣:١ ✓ |
| `src/app/fonts.ts` | سليم |
| `src/lib/arabic.ts` | سليم في ذاته؛ المخالفات في مستدعيه (UX-104، UX-105) |
| `src/lib/nav.ts` | UX-101، UX-112 |

## ما لم يُغطَّ من «ط» ولماذا
- **حالات العميل بعد التفاعل** (معاينة الرفع، نتيجة الاستيراد، أخطاء الطلب) لا تظهر في HTML المُصيَّر؛ فُحصت من الشيفرة وحدها.
- **أهداف اللمس بالبكسل** والتمرير الأفقيّ: قاسها المنسّق (`findings-browser.md`)؛ هنا الموضع في الشيفرة وحده (UX-113).
- **قارئ شاشة حقيقيّ** (VoiceOver/TalkBack): لم يُشغَّل.

