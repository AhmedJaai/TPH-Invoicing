# مصفوفة التغطية — مراجعة ٢٠٢٦-٠٩-١٣ عند `8d36f4e`

يملكها وكيل الجودة (CODE). **كلّ** ملفّ غير اختبار تحت `src/` و`scripts/`، وكلّ هجرة، وكلّ جدول — 325 بنداً، لا عيّنات.

- **المجال المسؤول**: FIN مال وبنك ماليّ · SEC صلاحيات وذكاء واستخراج · OPS قاعدة ومهلات وبوّابة · BTN/UX صفحات ومكوّنات · CODE ما تبقّى وكلّ النصوص والهجرات والجداول.
- **رُوجع؟**: يملؤه صاحب المجال — رقمُ ملاحظة أو «سليم — سبب». الفارغ = لم يملأه صاحبه بعد، وهذا **ليس سليماً**.
- **ملاحظة الجودة** آليّة من `SCRATCH/dead-exports.cjs` (مسحٌ نصّيّ للاستيراد، يُعيد تشغيله أيّ أحد) لكلّ الملفّات أيّاً كان مالكها.
- مولَّدة بـ`SCRATCH/gen-coverage.cjs` من `verdicts.json` — تُحدَّث بإعادة التوليد.

## صفحات وتخطيطات (`src/app`)
| البند | النوع | الأسطر | المجال المسؤول | رُوجع؟ | ملاحظة الجودة (CODE، آليّة) |
|---|---|---:|---|---|---|
| `src/app/analysis/loading.tsx` | حالة صفحة | 5 | BTN+UX | UX-006، UX-028، UX-005 |  |
| `src/app/analysis/page.tsx` | صفحة | 239 | BTN+UX | UX-005، UX-006، UX-020، UX-028 |  |
| `src/app/attention/loading.tsx` | حالة صفحة | 5 | BTN+UX | SCN-004، BRW-009 |  |
| `src/app/attention/page.tsx` | صفحة | 66 | BTN+UX | SCN-004، BRW-009 · §٧ (سليم عدا الفعل الثابت) |  |
| `src/app/audit/page.tsx` | صفحة | 13 | BTN+UX | UX-009، UX-013، UX-014، UX-019، UX-006، UX-017 · سليم — تحويل دائم |  |
| `src/app/bank/loading.tsx` | حالة صفحة | 5 | BTN+UX | UX-001، UX-002، UX-003، UX-004، UX-022، SCN-004 |  |
| `src/app/bank/page.tsx` | صفحة | 377 | BTN+UX | UX-001، UX-002، UX-003، UX-004، UX-009، UX-013 |  |
| `src/app/close/page.tsx` | صفحة | 85 | BTN+UX | FIN-007، FIN-009، UX-013، UX-019، UX-004، UX-031 |  |
| `src/app/dashboard/page.tsx` | صفحة | 12 | BTN+UX | UX-006، BRW-009 · سليم — تحويل دائم |  |
| `src/app/documents/loading.tsx` | حالة صفحة | 5 | BTN+UX | UX-002، UX-006، UX-008، UX-003، UX-026، BRW-007 |  |
| `src/app/documents/page.tsx` | صفحة | 372 | BTN+UX | UX-002، UX-003، UX-006، UX-008، UX-012، UX-026 |  |
| `src/app/fonts.ts` | مكتبة | 24 | BTN+UX | سليم — `display: swap` |  |
| `src/app/layout.tsx` | تخطيط | 30 | BTN+UX | سليم — `lang="ar" dir="rtl"`، ولون الموضوع |  |
| `src/app/login/page.tsx` | صفحة | 82 | BTN+UX | SCN-016، SCN-005، BRW-009 · سليم |  |
| `src/app/money/expenses/loading.tsx` | حالة صفحة | 5 | BTN+UX | FIN-006، UX-007، UX-006 |  |
| `src/app/money/expenses/page.tsx` | صفحة | 284 | BTN+UX | FIN-006، UX-006، UX-007، UX-020 |  |
| `src/app/money/loading.tsx` | حالة صفحة | 5 | BTN+UX | FIN-006، UX-005، UX-007، UX-006، UX-010، BRW-002 |  |
| `src/app/money/page.tsx` | صفحة | 167 | BTN+UX | FIN-005، FIN-006، FIN-001، UX-002، UX-005، UX-007 |  |
| `src/app/money/statement/page.tsx` | صفحة | 241 | BTN+UX | FIN-005، FIN-006، UX-006، UX-010، BRW-002، BRW-003 |  |
| `src/app/page.tsx` | صفحة | 249 | BTN+UX | FIN-003، FIN-004، FIN-005، FIN-001، FIN-009، FIN-013 · §٧ (سليم عدا الفعل الثابت) |  |
| `src/app/payments/loading.tsx` | حالة صفحة | 5 | BTN+UX | FIN-009، UX-002، UX-013، UX-009، UX-031 |  |
| `src/app/payments/page.tsx` | صفحة | 213 | BTN+UX | FIN-009، UX-002، UX-009، UX-031 |  |
| `src/app/performance/loading.tsx` | حالة صفحة | 5 | BTN+UX | UX-005، UX-006، UX-028، UX-002 |  |
| `src/app/performance/page.tsx` | صفحة | 197 | BTN+UX | UX-005، UX-006، UX-028، UX-002 |  |
| `src/app/purchases/invoices/page.tsx` | صفحة | 334 | BTN+UX | CODE-006 (سليم اليوم بفضل leftJoin — مُثبَت بالتصيير) |  |
| `src/app/purchases/loading.tsx` | حالة صفحة | 5 | BTN+UX | FIN-004، UX-002، UX-003، UX-015، UX-010، UX-005 |  |
| `src/app/purchases/page.tsx` | صفحة | 108 | BTN+UX | FIN-004، FIN-001، UX-002، UX-003، UX-005، UX-015 |  |
| `src/app/purchases/products/page.tsx` | صفحة | 76 | BTN+UX | UX-019، UX-005، UX-004، BRW-007 |  |
| `src/app/review/page.tsx` | صفحة | 96 | BTN+UX | OPS-001، UX-001، UX-013، UX-028، UX-004، UX-016 · SCN-003 · الصفّ الفرديّ سليم (نصٌّ ثمّ JSON، والرفض الصامت مُعالَج) |  |
| `src/app/settings/audit/page.tsx` | صفحة | 142 | BTN+UX | UX-009، UX-013، UX-014، UX-019، UX-017، UX-003 |  |
| `src/app/settings/page.tsx` | صفحة | 165 | BTN+UX | UX-003، UX-005، UX-013، UX-017، UX-014، UX-019 |  |
| `src/app/statements/loading.tsx` | حالة صفحة | 5 | BTN+UX | UX-003، UX-004، UX-005، SCN-002، BRW-007 |  |
| `src/app/statements/page.tsx` | صفحة | 68 | BTN+UX | UX-003، UX-004، UX-005، SCN-002، BRW-007 |  |
| `src/app/suppliers/[slug]/page.tsx` | صفحة | 370 | BTN+UX | FIN-003، FIN-004، UX-003، UX-013، UX-020، UX-023 |  |
| `src/app/suppliers/loading.tsx` | حالة صفحة | 5 | BTN+UX | FIN-004، UX-003، UX-023، UX-005، UX-020، BRW-004 |  |
| `src/app/suppliers/page.tsx` | صفحة | 194 | BTN+UX | FIN-003، FIN-004، FIN-013، UX-003، UX-005، UX-023 |  |
| `src/app/upload/page.tsx` | صفحة | 136 | BTN+UX | OPS-015، UX-003، UX-013، UX-004، UX-012، UX-021 |  |

## واجهات (`src/app/api`)
| البند | النوع | الأسطر | المجال المسؤول | رُوجع؟ | ملاحظة الجودة (CODE، آليّة) |
|---|---|---:|---|---|---|
| `src/app/api/analyze/route.ts` | واجهة | 159 | SEC | SEC-004، OPS-002، OPS-003، OPS-010، OPS-015، SCN-012 · سليمة: ٠٫٠٦٤ دولار لـ١٢٦ مستنداً؛ ٢–٤ نداءات للمستند؛ `drive-sync` يتخطّى المعروف بمعرّف ا |  |
| `src/app/api/archive/route.ts` | واجهة | 334 | SEC+FIN | FIN-002، SEC-004، SEC-014، OPS-014، OPS-003، OPS-010 |  |
| `src/app/api/auth/[...nextauth]/route.ts` | واجهة | 3 | SEC | سليم: ٣ أسطر؛ المحوّل على `db` المجمَّع |  |
| `src/app/api/bank-import/route.ts` | واجهة | 878 | SEC+FIN | CODE-010 | طويل (878) |
| `src/app/api/bank-rule/route.ts` | واجهة | 136 | SEC | CODE-004 · سليم: قاعدة فقط وقصير، بمهلة الخطّة الافتراضية (S-4) |  |
| `src/app/api/counterparty/route.ts` | واجهة | 294 | SEC | FIN-006، SEC-008، OPS-001، OPS-008، SCN-003، SCN-001 |  |
| `src/app/api/drive-rename/route.ts` | واجهة | 217 | SEC | SEC-012، SEC-003، OPS-007 · سليم غالباً: تسمية ثمّ تحديث لكلّ ملفّ خارج معاملة، والتدقيق بـ`من ← إلى` حين ينجح شيء |  |
| `src/app/api/drive-sync/route.ts` | واجهة | 626 | SEC | CODE-010 | طويل (626) |
| `src/app/api/expense-actual/route.ts` | واجهة | 95 | SEC+FIN | FIN-006 · سليم: قاعدة فقط وقصير |  |
| `src/app/api/expense/route.ts` | واجهة | 105 | SEC | FIN-006 · سليم: قاعدة فقط وقصير |  |
| `src/app/api/health/route.ts` | واجهة | 97 | SEC | OPS-004، OPS-012 |  |
| `src/app/api/mark-paid/route.ts` | واجهة | 141 | SEC+FIN | FIN-002، FIN-001، SEC-002، SCN-015، SCN-008، CODE-006 · سليم: معاملة صغيرة بـ`tx` |  |
| `src/app/api/match-confirm-bulk/route.ts` | واجهة | 336 | SEC+FIN | FIN-002، FIN-008، SEC-012، SCN-015، CODE-013 · سليم من جهة الاتصال؛ تناقض وثيقة (§٤) |  |
| `src/app/api/match-confirm/route.ts` | واجهة | 665 | SEC+FIN | CODE-010 · CODE-011 | طويل (665) |
| `src/app/api/match-undo/route.ts` | واجهة | 170 | SEC+FIN | SEC-015، SCN-007 · سليم: `reversePayment(tx)` |  |
| `src/app/api/month-close/route.ts` | واجهة | 136 | SEC+FIN | SCN-019، SCN-009 · سليم: استعلامات حقائق ثمّ كتابة واحدة |  |
| `src/app/api/ops/db-identity/route.ts` | واجهة | 56 | SEC | سليم: محروس بـ`audit:view` ولا يكشف سرّاً |  |
| `src/app/api/payment-run/route.ts` | واجهة | 66 | SEC+FIN | SEC-009، SEC-012 · سليم: قاعدة فقط وقصير |  |
| `src/app/api/product/route.ts` | واجهة | 92 | SEC | سليم: قاعدة فقط وقصير |  |
| `src/app/api/search/route.ts` | واجهة | 29 | SEC | SEC-005 · سليم: ٥ استعلامات `limit`، مسحٌ متسلسل على ١٤٤٠ صفّاً (EXPLAIN)؛ على Vercel تتسلسل (S-1) |  |
| `src/app/api/statement-reconcile/route.ts` | واجهة | 364 | SEC+FIN | FIN-010، OPS-002، SCN-015 |  |
| `src/app/api/supplier-alias/route.ts` | واجهة | 99 | SEC | CODE-004 (SEC) |  |
| `src/app/api/supplier/route.ts` | واجهة | 117 | SEC | CODE-004 (نسخة إنشاء المورّد) |  |

## مكوّنات (`src/components`)
| البند | النوع | الأسطر | المجال المسؤول | رُوجع؟ | ملاحظة الجودة (CODE، آليّة) |
|---|---|---:|---|---|---|
| `src/components/attention-list.tsx` | مكوّن | 148 | BTN+UX | SCN-003 · سليم — لكلّ بطاقة `href`، والشدّة بشريط وبنصّ |  |
| `src/components/bank-import.tsx` | مكوّن | 610 | BTN+UX | CODE-010 | طويل (610) |
| `src/components/changes.tsx` | مكوّن | 90 | BTN+UX | سليم |  |
| `src/components/derive-expenses.tsx` | مكوّن | 59 | BTN+UX | OPS-003، UX-004، SCN-005 |  |
| `src/components/drive-rename.tsx` | مكوّن | 225 | BTN+UX | OPS-003، UX-004، UX-005 |  |
| `src/components/drive-sync.tsx` | مكوّن | 410 | BTN+UX | SEC-003، OPS-003، UX-004، UX-005، UX-024، UX-028 | طويل (410) |
| `src/components/expense-reclassify.tsx` | مكوّن | 145 | BTN+UX | OPS-003، UX-004، UX-022 · سليم — يقرأ الردّ نصّاً، والاقتراح قبل الضغط |  |
| `src/components/figure.tsx` | مكوّن | 137 | BTN+UX | UX-011، UX-020 |  |
| `src/components/hub.tsx` | مكوّن | 75 | BTN+UX | UX-017، BRW-005 |  |
| `src/components/mark-invoice-paid.tsx` | مكوّن | 139 | BTN+UX | OPS-003، UX-004، UX-009، UX-011، SCN-005 |  |
| `src/components/match-explain.tsx` | مكوّن | 196 | BTN+UX | OPS-003، UX-004، UX-009، UX-016، SCN-005 |  |
| `src/components/money.tsx` | مكوّن | 28 | BTN+UX | BRW-008، CODE-011 · سليم — عدد صحيح، و`dir="ltr"`، و`.nums` |  |
| `src/components/month-close.tsx` | مكوّن | 272 | BTN+UX | OPS-003، UX-004، UX-012، SCN-015، SCN-005، SCN-009 |  |
| `src/components/nav.tsx` | مكوّن | 236 | BTN+UX | UX-011، UX-026، UX-029 |  |
| `src/components/page-shell.tsx` | مكوّن | 111 | BTN+UX | UX-013، SCN-003 · SCN-003 · الصفّ الفرديّ سليم (نصٌّ ثمّ JSON، والرفض الصامت مُعالَج) |  |
| `src/components/page-skeleton.tsx` | مكوّن | 39 | BTN+UX | UX-013 |  |
| `src/components/payment-run-actions.tsx` | مكوّن | 115 | BTN+UX | OPS-003، UX-004، UX-009، SCN-005 |  |
| `src/components/product-mapping.tsx` | مكوّن | 436 | BTN+UX | OPS-003، UX-004، UX-005، UX-009، UX-012، UX-028 | طويل (436) |
| `src/components/reconcile-queue.tsx` | مكوّن | 495 | BTN+UX | OPS-003، UX-004، UX-005، UX-009، UX-025، SCN-005 | طويل (495) |
| `src/components/recurring-expenses.tsx` | مكوّن | 151 | BTN+UX | OPS-003، UX-004، UX-011، UX-012، UX-021، UX-024 |  |
| `src/components/review-workspace.tsx` | مكوّن | 624 | BTN+UX | CODE-010 | طويل (624) |
| `src/components/scroll-x.tsx` | مكوّن | 80 | BTN+UX | سليم — يقيس الفيض في RTL بالقيمة المطلقة |  |
| `src/components/search-box.tsx` | مكوّن | 168 | BTN+UX | OPS-003، UX-029 |  |
| `src/components/statement-reconcile.tsx` | مكوّن | 320 | BTN+UX | OPS-003، UX-003، UX-004، UX-005، UX-012، UX-020 |  |
| `src/components/trial-banner.tsx` | مكوّن | 18 | BTN+UX | سليم |  |
| `src/components/ui-client.tsx` | مكوّن | 163 | BTN+UX | UX-009، UX-021، CODE-007 | صادر ميّت: `StickyActions` `Progress` |
| `src/components/ui.tsx` | مكوّن | 376 | BTN+UX | UX-011، UX-019، UX-020، UX-023، UX-007، CODE-007 | صادر ميّت: `ErrorState` |
| `src/components/uploader.tsx` | مكوّن | 770 | BTN+UX | CODE-010 | طويل (770) |
| `src/components/user-menu.tsx` | مكوّن | 30 | BTN+UX | UX-011، UX-025 |  |

## مكتبات (`src/lib` وجذر `src`)
| البند | النوع | الأسطر | المجال المسؤول | رُوجع؟ | ملاحظة الجودة (CODE، آليّة) |
|---|---|---:|---|---|---|
| `src/auth.ts` | مكتبة | 103 | SEC | SEC-006، SEC-011، SCN-016 · SCN-016، ٠١٨ · رسالة `AccessDenied` سليمة |  |
| `src/config/drive.ts` | مكتبة | 44 | CODE | سليم — إعداد، يُستورد |  |
| `src/lib/ai/deepseek.ts` | مكتبة | 397 | SEC | SEC-009، OPS-002، OPS-012، CODE-007 | صادر ميّت: `contentHash` |
| `src/lib/ai/document-input.ts` | مكتبة | 249 | SEC | OPS-012 · سليم من جهة التشغيل: نصّ أوّلاً ثمّ صورة؛ `text_source` لا يُحفَظ (OPS-012) | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/ai/models.ts` | مكتبة | 126 | SEC | OPS-012، CODE-007 · OPS-012؛ التسعير تقدير معلَن، سليم | صادر ميّت: `DEEPSEEK_MODELS` |
| `src/lib/ai/pdf-images.ts` | مكتبة | 141 | SEC | سليم: `MAX_IMAGES = 4` وحدّ أدنى للمقاس |  |
| `src/lib/allocation.ts` | مكتبة | 114 | FIN | FIN-004، SCN-002 · سليم ذاتاً؛ الأثر FIN-004 |  |
| `src/lib/analytics.ts` | مكتبة | 372 | FIN | FIN-009، CODE-007 | صادر ميّت: `AGE_LABEL` · 4 صادر لا يستعمله إلّا الاختبار |
| `src/lib/arabic.ts` | مكتبة | 147 | CODE | سليم — 13 جدولاً كما يقول CLAUDE.md؛ `TRANSACTION` غير مستعمل في changes.ts (lint) | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/archive-import.ts` | مكتبة | 73 | CODE | سليم — يستعمله drive-sync |  |
| `src/lib/attention-facts.ts` | مكتبة | 335 | CODE | سليم هيكلياً — يقرأ reconciliation_periods الفارغ (CODE-003) |  |
| `src/lib/attention.ts` | مكتبة | 525 | CODE | CODE-010 (طويل 525، منسِّق مال محلّي :178) | طويل (525) |
| `src/lib/audit.ts` | مكتبة | 64 | SEC | SEC-001، OPS-008 · سليم: قراءة، يكتب `truth-audit.json` وحده؛ عمره ٧ أيّام (OPS-008) |  |
| `src/lib/bank/adjudicate.ts` | مكتبة | 147 | FIN | CODE-007 | صادر ميّت: `HIGH_VALUE_MINOR` · 3 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/adjudicator-prompt.ts` | مكتبة | 153 | FIN | CODE-011 |  |
| `src/lib/bank/adjudicator-provider.ts` | مكتبة | 270 | FIN | OPS-002 | 6 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/apply.ts` | مكتبة | 72 | FIN | سليم — الترجمتان كاملتان في الاتّجاهين بـ`Record` مكتمل، ولا `as` |  |
| `src/lib/bank/balance-equation.ts` | مكتبة | 196 | FIN | CODE-007 (reconcileAccount للاختبار وحده) | 3 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/candidates.ts` | مكتبة | 418 | FIN | CODE-007 | 8 صادر لا يستعمله إلّا الاختبار · طويل (418) |
| `src/lib/bank/canonical.ts` | مكتبة | 277 | FIN | GAP-018 — تلوّث المستفيد قيس فكان صفراً؛ بقيت نافذة التاريخ المنطوق | 4 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/classification.ts` | مكتبة | 318 | FIN | CODE-007 | صادر ميّت: `LAYER_SOURCE` · 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/coverage.ts` | مكتبة | 134 | FIN | سليم | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/decision.ts` | مكتبة | 111 | FIN | سليم | 4 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/double-paid.ts` | مكتبة | 145 | FIN | SCN-004 · سليم | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/entities.ts` | مكتبة | 200 | FIN | GAP-013 — اسمٌ بديل قاطع بالاحتواء، وحساسيّة لحالة الحروف |  |
| `src/lib/bank/entity-candidates.ts` | مكتبة | 161 | FIN | CODE-007 | 5 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/evidence-uniqueness.ts` | مكتبة | 49 | FIN | سليم — القاطع يُحتكَر والظنّيّ يُشترَك، كما في القرار | 2 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/fees.ts` | مكتبة | 76 | FIN | CODE-007 · سليم | 3 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/identity.ts` | مكتبة | 87 | FIN | سليم — الخوارزميّة الثانية حُذفت فعلاً (87 سطراً، الأسماء في التعليق وحده) |  |
| `src/lib/bank/lifecycle.ts` | مكتبة | 108 | FIN | CODE-007 (detectAnomalies) | صادر ميّت: `LIFECYCLE_LABEL` · 4 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/match.ts` | مكتبة | 369 | FIN | CODE-005 (FIN) | 2 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/metrics.ts` | مكتبة | 163 | FIN | سليم — النسبة `null` تحت العيّنة، ويُحسب على حكم الإنسان وحده | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/optimizer.ts` | مكتبة | 239 | FIN | GAP-005 — يُعلن `exact: false` لكنّه يرمي أفضل ما وجد |  |
| `src/lib/bank/parse.ts` | مكتبة | 333 | FIN | FIN-007 | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/parsers/adapters.ts` | مكتبة | 177 | FIN | GAP-007 — `directionStyle` و`calendar` و`headersFor` لا يقرؤها شيء | 3 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/parsers/detect.ts` | مكتبة | 133 | FIN | GAP-006 — `_` معالَجة؛ لكنّ الاحتياط إلى الأهليّ، والكشف يقرأ بنوك المستفيدين | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/parsers/pdf-text.ts` | مكتبة | 137 | FIN | GAP-012 — بلا سقف صفحات ولا تحرير للمستند |  |
| `src/lib/bank/parsers/safe-xlsx.ts` | مكتبة | 135 | FIN | GAP-011 — تعليقٌ قديم، وقصّ خليّةٍ صامت، ولا حدّ لفكّ الضغط | 5 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/parsers/types.ts` | مكتبة | 41 | FIN | CODE-007 | **لا يستورده أحد** · صادر ميّت: `BankAdapter` `MIN_CONFIDENCE` |
| `src/lib/bank/pattern.ts` | مكتبة | 212 | FIN | سليم — النمط من الوصف وحده، والاسم من المؤيَّد، والتلوّث صفر | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/pending.ts` | مكتبة | 85 | FIN | سليم — مصدر واحد: countPendingWork يستعمل pendingDecision، ولا عدّادٌ آخر بالشرط نفسه في src |  |
| `src/lib/bank/pos.ts` | مكتبة | 178 | FIN | CODE-007 | 3 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/reason-codes.ts` | مكتبة | 123 | FIN | GAP-003 — لا يزيل السبب المكرَّر | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/reversal.ts` | مكتبة | 100 | FIN | CODE-007 (FIN) | **لا يستورده إلّا اختباره** |
| `src/lib/bank/review-queue.ts` | مكتبة | 125 | FIN | SCN-003، CODE-007 · SCN-003 · الصفّ الفرديّ سليم (نصٌّ ثمّ JSON، والرفض الصامت مُعالَج) | 2 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/rules.ts` | مكتبة | 134 | FIN | BRW-002، CODE-007 | صادر ميّت: `NON_SUPPLIER_CATEGORIES` · 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/supplier-profile.ts` | مكتبة | 162 | FIN | GAP-016 — المنطق سليم وحدّ الخمس مطبَّق؛ التعليق يخالف المئين | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/sync.ts` | مكتبة | 395 | FIN | SEC-003، OPS-003، UX-004، UX-005، UX-024، UX-028 | 2 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/taxonomy.ts` | مكتبة | 101 | FIN | CODE-007 | صادر ميّت: `REVENUE_KINDS` `POS_COST_KINDS` `NON_OPERATIONAL` `OUTCOME_LABEL` `DISPOSITION_LABEL` · 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/verdict-policy.ts` | مكتبة | 153 | FIN | GAP-003 — الجودة المجهولة تمرّ إلى `SUGGEST` | 4 صادر لا يستعمله إلّا الاختبار |
| `src/lib/bank/vision-statement.ts` | مكتبة | 231 | FIN | CODE-007 | صادر ميّت: `VISION_PROMPT_VERSION` · 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/canonical-name.ts` | مكتبة | 95 | CODE | سليم — موجود ويُستورد كما في جدول CLAUDE.md |  |
| `src/lib/cashflow.ts` | مكتبة | 263 | CODE | سليم — يُستورد |  |
| `src/lib/changes-facts.ts` | مكتبة | 89 | CODE | سليم — يُستورد |  |
| `src/lib/changes.ts` | مكتبة | 200 | FIN | CODE-011 (استيراد TRANSACTION غير مستعمل) | 3 صادر لا يستعمله إلّا الاختبار |
| `src/lib/confirm.ts` | مكتبة | 160 | FIN | سليم |  |
| `src/lib/credit-notes.ts` | مكتبة | 86 | FIN | CODE-007 (FIN) | 2 صادر لا يستعمله إلّا الاختبار |
| `src/lib/data-health-facts.ts` | مكتبة | 43 | CODE | سليم — يُستورد |  |
| `src/lib/data-health.ts` | مكتبة | 190 | CODE | سليم — NOT_CONNECTED موجود كما يدّعي CLAUDE.md |  |
| `src/lib/drive-sync.ts` | مكتبة | 129 | CODE | سليم — يُستورد |  |
| `src/lib/drive.ts` | مكتبة | 270 | SEC | CODE-009 |  |
| `src/lib/expenses.ts` | مكتبة | 414 | FIN | FIN-005، FIN-006، OPS-003، UX-004، UX-011، UX-012 · سليم؛ FIN-006 في الخدمة | 4 صادر لا يستعمله إلّا الاختبار · طويل (414) |
| `src/lib/extraction/benchmark.ts` | مكتبة | 199 | SEC | CODE-003 (SEC للمحتوى) | **لا يستورده إلّا اختباره** |
| `src/lib/extraction/extract.ts` | مكتبة | 173 | SEC | CODE-009 |  |
| `src/lib/extraction/index.ts` | مكتبة | 38 | SEC | GAP-001 · GAP-010 — يعدّل المخرَج قبل حفظه «خاماً»، ويستورد المزوّدَين الخاملين |  |
| `src/lib/extraction/pipeline.ts` | مكتبة | 272 | SEC | GAP-002 · GAP-015 — يمنع الكشف بلا إجمالي، ويفحص التاريخ بالشكل |  |
| `src/lib/extraction/provider-deepseek.ts` | مكتبة | 308 | SEC | SEC-009، OPS-002 |  |
| `src/lib/extraction/provider-gemini.ts` | مكتبة | 295 | SEC | GAP-010 — خامل؛ يقبل `MAX_TOKENS`، ويرسل الملفّ كاملاً، وبلا مهلة | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/extraction/provider-ollama.ts` | مكتبة | 137 | SEC | GAP-010 — خامل؛ `isConfigured` بلا مضيف ولا يُستدعى |  |
| `src/lib/extraction/provider.ts` | مكتبة | 84 | SEC | سليم — الاحتياط إلى deepseek، والموجِّه يعلن المستند بيانات لا تعليمات |  |
| `src/lib/extraction/schema.ts` | مكتبة | 102 | SEC | GAP-016 — الثقة بلا حدود، وتعليقٌ عن Claude |  |
| `src/lib/extraction/schemas-by-kind.ts` | مكتبة | 230 | SEC | CODE-007 | صادر ميّت: `utilityExtractionSchema` · 6 صادر لا يستعمله إلّا الاختبار |
| `src/lib/extraction/statement-extras.ts` | مكتبة | 76 | SEC | FIN-010 |  |
| `src/lib/extraction/validate-extraction.ts` | مكتبة | 228 | SEC | GAP-015 — لا يصحّح ولا يصفّر، والاشتقاق في اتّجاهٍ واحد؛ التاريخ بالشكل وحده |  |
| `src/lib/extraction/versions.ts` | مكتبة | 67 | SEC | CODE-007 | صادر ميّت: `provenance` |
| `src/lib/filing.ts` | مكتبة | 96 | CODE | سليم — `resolveInvoiceFiling` للاختبار وحده (dead.txt) | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/id.ts` | مكتبة | 4 | CODE | سليم |  |
| `src/lib/insights.ts` | مكتبة | 311 | CODE | CODE-007 | **لا يستورده إلّا اختباره** · صادر ميّت: `SEVERITY_LABEL` |
| `src/lib/invoice-filter.ts` | مكتبة | 101 | CODE | سليم — `as TaxFilter` بعد includes (:39-40) آمن |  |
| `src/lib/issue-codes.ts` | مكتبة | 52 | CODE | سليم |  |
| `src/lib/items.ts` | مكتبة | 107 | FIN | GAP-009 — يحذف «٫»، والنسبة المجهولة صفر | 2 صادر لا يستعمله إلّا الاختبار |
| `src/lib/line-pricing.ts` | مكتبة | 182 | FIN | FIN-015 |  |
| `src/lib/money.ts` | مكتبة | 97 | FIN | CODE-011 (FIN) |  |
| `src/lib/month-close-facts.ts` | مكتبة | 166 | FIN | FIN-007، FIN-001، FIN-013، SCN-010، SCN-011، SCN-009 |  |
| `src/lib/month-close.ts` | مكتبة | 256 | FIN | FIN-007، OPS-003، UX-004، UX-012، SCN-015، SCN-005 |  |
| `src/lib/naming.ts` | مكتبة | 290 | CODE | سليم — صادر واحد للاختبار | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/nav.ts` | مكتبة | 199 | CODE | سليم — AREAS/MOBILE_TABS تُستعمل داخله | 2 صادر لا يستعمله إلّا الاختبار |
| `src/lib/ops/db-identity.ts` | مكتبة | 133 | OPS | سليم |  |
| `src/lib/ops/production-gate.ts` | مكتبة | 121 | OPS | FIN-007، OPS-005، OPS-008 · سليم: `buildGate` يُسقط الغائب إلى `UNKNOWN` | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/ops/truth-audit.ts` | مكتبة | 233 | OPS | OPS-008 · سليم: قراءة، يكتب `truth-audit.json` وحده؛ عمره ٧ أيّام (OPS-008) | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/payment-run.ts` | مكتبة | 147 | FIN | FIN-001، FIN-003، CODE-011 |  |
| `src/lib/payment-state.ts` | مكتبة | 161 | FIN | CODE-007 · سليم | صادر ميّت: `OPEN_STATUSES` · 5 صادر لا يستعمله إلّا الاختبار |
| `src/lib/permissions.ts` | مكتبة | 92 | SEC | SEC-005، SEC-010، SEC-015، SCN-018، SCN-016 · SCN-016، ٠١٨ · رسالة `AccessDenied` سليمة | 3 صادر لا يستعمله إلّا الاختبار |
| `src/lib/preview-mode.ts` | مكتبة | 36 | SEC | SEC-002، OPS-006 | 2 صادر لا يستعمله إلّا الاختبار |
| `src/lib/products.ts` | مكتبة | 146 | FIN | CODE-009 | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/provenance-facts.ts` | مكتبة | 224 | FIN | FIN-001، FIN-013، SCN-011، SCN-003 |  |
| `src/lib/provenance.ts` | مكتبة | 95 | FIN | FIN-001، FIN-013 | 2 صادر لا يستعمله إلّا الاختبار |
| `src/lib/rate-limit.ts` | مكتبة | 99 | OPS | SEC-012 | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/sales/connector.ts` | مكتبة | 120 | CODE | سليم — notConnected يرمي كما يقول CLAUDE.md؛ لا يستورده خارجه إلّا اختباره (مقصود) | 3 صادر لا يستعمله إلّا الاختبار |
| `src/lib/search.ts` | مكتبة | 174 | CODE | سليم — يُستورد من search.service | 3 صادر لا يستعمله إلّا الاختبار |
| `src/lib/session.ts` | مكتبة | 92 | CODE | سليم |  |
| `src/lib/statement-match.ts` | مكتبة | 378 | FIN | CODE-011 · سليم (هللة، ٧ أيام) | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/supplier-account.ts` | مكتبة | 137 | FIN | FIN-003، FIN-010، SCN-002 · FIN-010؛ `supplier-account.ts` سليم |  |
| `src/lib/supplier-health.ts` | مكتبة | 156 | FIN | GAP-014 — يعدّ الكشوف لا الأشهر المغطّاة | 5 صادر لا يستعمله إلّا الاختبار |
| `src/lib/supplier-match.ts` | مكتبة | 222 | CODE | سليم | 1 صادر لا يستعمله إلّا الاختبار |
| `src/lib/suppliers-seed.ts` | مكتبة | 134 | CODE | سليم — normalizeName مستعمل في 5+ مواضع |  |
| `src/lib/unit-conversion.ts` | مكتبة | 145 | FIN | CODE-007 (FIN) | **لا يستورده إلّا اختباره** |
| `src/lib/validation.ts` | مكتبة | 205 | FIN | FIN-014، FIN-015 · سليم إلّا FIN-014 و`parseRiyals` (مشتبه) | 2 صادر لا يستعمله إلّا الاختبار |
| `src/middleware.ts` | مكتبة | 42 | SEC | CODE-012 (SEC) | صادر ميّت: `middleware` `config` |

## خدمات (`src/services`)
| البند | النوع | الأسطر | المجال المسؤول | رُوجع؟ | ملاحظة الجودة (CODE، آليّة) |
|---|---|---:|---|---|---|
| `src/services/adjudicator.service.ts` | خدمة | 328 | SEC | SEC-009، OPS-002 | 1 صادر لا يستعمله إلّا الاختبار |
| `src/services/bank-account.service.ts` | خدمة | 83 | FIN | GAP-008 — أربع خانات تكفي، والبحث بلا بنك | 2 صادر لا يستعمله إلّا الاختبار |
| `src/services/counterparty.service.ts` | خدمة | 295 | FIN | SEC-007، SEC-008، OPS-001 |  |
| `src/services/document.service.ts` | خدمة | 105 | SEC | GAP-001 · GAP-017 — يحفظ مُدخَل المتصفّح على أنّه خام، والسباق يترك ملفّاً يتيماً |  |
| `src/services/drive.service.ts` | خدمة | 100 | SEC | SEC-002، SEC-014، OPS-014 · OPS-014 (المستدعي)؛ الخدمة نفسها سليمة |  |
| `src/services/expense.service.ts` | خدمة | 232 | FIN | FIN-006، OPS-009، OPS-002، CODE-007، CODE-004 | صادر ميّت: `expensesOfMonth` |
| `src/services/guard.ts` | خدمة | 39 | SEC | SCN-016 · SCN-016، ٠١٨ · رسالة `AccessDenied` سليمة |  |
| `src/services/invoice.service.ts` | خدمة | 187 | FIN | سليم |  |
| `src/services/payment.service.ts` | خدمة | 286 | FIN | FIN-002 |  |
| `src/services/product.service.ts` | خدمة | 221 | CODE | سليم هيكلياً (N+1 عند OPS) |  |
| `src/services/rate-limit.service.ts` | خدمة | 72 | SEC | CODE-007، CODE-004 · سليم: عدٌّ ذرّيّ و`sweep` بنسبة ٢٪ (S-2) | صادر ميّت: `currentCount` |
| `src/services/reconcile.service.ts` | خدمة | 428 | FIN | سليم (الاتجاه، الرسم) | طويل (428) |
| `src/services/search.service.ts` | خدمة | 236 | CODE | سليم |  |
| `src/services/statement-file.service.ts` | خدمة | 184 | CODE | سليم — يوصل detect.ts (كسر REVIEW-REPORT أ مُصلَح) |  |
| `src/services/statement-vision.service.ts` | خدمة | 238 | SEC | OPS-002 |  |
| `src/services/supplier-profile.service.ts` | خدمة | 55 | FIN | سليم — الاستعلام يعمل على القاعدة، ويستثني المردود والملغى |  |
| `src/services/supplier.service.ts` | خدمة | 155 | CODE | CODE-004 | صادر ميّت: `loadActiveSuppliers` `createSupplier` `learnAlias` |
| `src/services/types.ts` | خدمة | 19 | CODE | سليم |  |
| `src/services/validation.service.ts` | خدمة | 94 | FIN | سليم — الخادم يعيد الاشتقاق، والشهر المقفل يُرفض |  |

## القاعدة (`src/db`)
| البند | النوع | الأسطر | المجال المسؤول | رُوجع؟ | ملاحظة الجودة (CODE، آليّة) |
|---|---|---:|---|---|---|
| `src/db/index.ts` | قاعدة | 37 | OPS | SEC-001، SEC-008، OPS-001، CODE-001 |  |
| `src/db/schema.ts` | قاعدة | 1242 | CODE | سليم هيكلياً — 39 pgTable = 39 في CLAUDE.md؛ جداول بلا شيفرة في قسم الجداول | طويل (1242) |

## نصوص (`scripts/`)
| البند | النوع | الأسطر | المجال المسؤول | رُوجع؟ | ملاحظة الجودة (CODE، آليّة) |
|---|---|---:|---|---|---|
| `scripts/audit-data.ts` | نصّ | 80 | CODE | سليم — يقرأ، والرأس صادق |  |
| `scripts/backfill-content.ts` | نصّ | 544 | CODE | سليم — --dry/--commit، الرأس صادق؛ طويل 544 | طويل (544) |
| `scripts/backfill-missing-invoices.ts` | نصّ | 156 | CODE | سليم — معاينة افتراضاً و--apply |  |
| `scripts/benchmark-providers.ts` | نصّ | 307 | CODE | CODE-003 |  |
| `scripts/build-products.ts` | نصّ | 50 | CODE | CODE-009 (يكتب عبر buildSupplierProducts بلا معاينة ولا يقول «يكتب») |  |
| `scripts/certify-flow.ts` | نصّ | 568 | CODE | CODE-008 (الرأس يكذب في العدد والكتابة؛ الكتابة نفسها عند OPS/SEC) | طويل (568) |
| `scripts/certify-real-bank.ts` | نصّ | 224 | CODE | سليم — لا كتابة (0 insert/update/delete) |  |
| `scripts/check-isolation.ts` | نصّ | 69 | CODE | سليم — يقرأ |  |
| `scripts/dedupe-bank.ts` | نصّ | 379 | CODE | سليم — يعرض و`apply` يكتب؛ الرأس صادق |  |
| `scripts/derive-expenses.ts` | نصّ | 27 | CODE | CODE-009 (يكتب مباشرةً بلا معاينة؛ الرأس يقول «يقيّد» — صادق لكن بلا وضع عرض) |  |
| `scripts/diagnose-drive.ts` | نصّ | 49 | CODE | CODE-009 (رأسه «بلا رفع» ويستدعي findOrCreateFolder الذي يُنشئ مجلّداً في الأرشيف :36-37) |  |
| `scripts/diagnose-unpaid.ts` | نصّ | 70 | CODE | CODE-009 (بلا رأس؛ يقرأ فقط) |  |
| `scripts/drive-auth.ts` | نصّ | 67 | CODE | سليم — قراءة افتراضاً و--write صريح |  |
| `scripts/drive-inventory.ts` | نصّ | 197 | CODE | سليم — يقرأ الدرايف ويكتب JSON محلّياً |  |
| `scripts/find-split-suppliers.ts` | نصّ | 66 | CODE | سليم — يقرأ |  |
| `scripts/identity-report.ts` | نصّ | 138 | CODE | سليم — `apply` يكتب (update bank_transactions :129) والرأس يقوله |  |
| `scripts/learn-counterparties.ts` | نصّ | 200 | CODE | سليم — `apply` صريح |  |
| `scripts/link-counterparties.ts` | نصّ | 111 | CODE | سليم — لا كتابة، كما يقول |  |
| `scripts/measure-system.ts` | نصّ | 96 | CODE | سليم — يقرأ |  |
| `scripts/merge-suppliers.ts` | نصّ | 110 | CODE | سليم — --commit صريح |  |
| `scripts/migrate-archive.ts` | نصّ | 300 | CODE | CODE-009 (ترحيلٌ لمرّة واحدة انتهى، ما زال `drive:migrate` في package.json وARCHITECTURE) |  |
| `scripts/migrate.ts` | نصّ | 82 | CODE | CODE-002 |  |
| `scripts/missing-invoices.ts` | نصّ | 178 | CODE | سليم — يقرأ؛ غير موثَّق في CLAUDE.md (CODE-007) |  |
| `scripts/production-gate.ts` | نصّ | 439 | CODE | سليم — يقرأ؛ طويل 439 | طويل (439) |
| `scripts/reclassify-bank.ts` | نصّ | 165 | CODE | سليم — بذاكرته (الرأس يصرّح)، و`apply` صريح |  |
| `scripts/recompute-line-pricing.ts` | نصّ | 106 | CODE | سليم — --commit صريح |  |
| `scripts/rematch-bank.ts` | نصّ | 188 | CODE | سليم — `apply` صريح |  |
| `scripts/remove-duplicate-transaction.ts` | نصّ | 175 | CODE | سليم — --id و--apply ومعاملة؛ نصٌّ لحادثة واحدة (4ac3f9e) غير موثَّق في CLAUDE.md |  |
| `scripts/repair-bank-rules.ts` | نصّ | 120 | CODE | سليم — --commit صريح |  |
| `scripts/repair-import-scope.ts` | نصّ | 179 | CODE | سليم — `apply` صريح |  |
| `scripts/repair-integrity.ts` | نصّ | 488 | CODE | CODE-009 (إصلاحٌ لحادثة ٤ سبتمبر، طويل 488، باقٍ قابلاً للتشغيل بلا حارس بيئة) | طويل (488) |
| `scripts/repair-period-month.ts` | نصّ | 104 | CODE | سليم — --apply صريح |  |
| `scripts/seed-demo.ts` | نصّ | 143 | CODE | CODE-009 (يُدرج فواتير ودفعات DEMO في القاعدة الوحيدة وهي الإنتاج، بلا حارس) |  |
| `scripts/seed-suppliers.ts` | نصّ | 87 | CODE | CODE-009 (يكتب بلا معاينة؛ الرأس صادق) |  |
| `scripts/truth-audit.ts` | نصّ | 165 | CODE | سليم — يقرأ ويكتب JSON محلّياً |  |
| `scripts/try-archive.ts` | نصّ | 74 | CODE | CODE-009 (findOrCreateFolder قبل فحص --upload :49-54، واسمٌ مثبَّت لبيكوف :57) |  |
| `scripts/try-bank.ts` | نصّ | 29 | CODE | سليم — يقرأ ملفّاً؛ بلا رأس |  |
| `scripts/try-extract.ts` | نصّ | 71 | CODE | CODE-009 (بلا رأس؛ ينادي النموذج = كلفة) |  |
| `scripts/try-match.ts` | نصّ | 101 | CODE | CODE-005 (المحرّك القديم matchBankTransactions) |  |
| `scripts/try-statement.ts` | نصّ | 130 | CODE | سليم — «لا يكتب شيئاً» صادق |  |
| `scripts/verify-invariants.ts` | نصّ | 134 | CODE | CODE-001 |  |

## هجرات (`drizzle/sql`)
| البند | النوع | الأسطر | المجال المسؤول | رُوجع؟ | ملاحظة الجودة (CODE، آليّة) |
|---|---|---:|---|---|---|
| `drizzle/sql/001_audit_log_immutable.sql` | هجرة | 27 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/002_tax_status_and_idempotency.sql` | هجرة | 88 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO | UPDATE على أعمدة أُسقطت — إعادته تفشل صاخبة |
| `drizzle/sql/003_transaction_type.sql` | هجرة | 15 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/004_rate_limits.sql` | هجرة | 20 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/005_products_and_sales_domain.sql` | هجرة | 146 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/006_expenses.sql` | هجرة | 50 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/007_financial_invariants.sql` | هجرة | 106 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/008_bank_kinds.sql` | هجرة | 14 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/009_match_evidence.sql` | هجرة | 31 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/010_counterparties.sql` | هجرة | 69 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/011_branches_and_accounts.sql` | هجرة | 116 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/012_sales_domain.sql` | هجرة | 107 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/013_decision_provenance.sql` | هجرة | 97 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/014_identity_scoping.sql` | هجرة | 70 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/015_payment_lifecycle.sql` | هجرة | 97 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/016_lifecycle_and_expense_events.sql` | هجرة | 79 | CODE (+FIN للقيود المالية) | CODE-002 | UPDATE بلا WHERE (:31-39) |
| `drizzle/sql/017_sales_identity_and_units.sql` | هجرة | 75 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/018_statement_balances_nullable.sql` | هجرة | 31 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/019_pattern_identity.sql` | هجرة | 17 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/020_natural_transaction_key.sql` | هجرة | 67 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/021_amount_classification.sql` | هجرة | 16 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/022_bank_vat_category.sql` | هجرة | 17 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/023_operation_reference.sql` | هجرة | 31 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/024_identity_key.sql` | هجرة | 33 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/025_identity_supersedes_natural.sql` | هجرة | 16 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO |  |
| `drizzle/sql/026_allocation_bounds_serialize.sql` | هجرة | 68 | CODE (+FIN للقيود المالية) | سليم — مطبَّقة وبصمتها تطابق الملفّ؛ DDL بـIF NOT EXISTS أو كتلة DO | غير مسرودة في CLAUDE.md |

## جداول (`src/db/schema.ts`)
| البند | النوع | الأسطر | المجال المسؤول | رُوجع؟ | ملاحظة الجودة (CODE، آليّة) |
|---|---|---:|---|---|---|
| `users` | جدول (schema.ts:26) | — | CODE | سليم — 1 صفّاً، مستعمل (srcFiles=5، scriptFiles=5) | ملفّات src تذكره: 5 · نصوص: 5 |
| `accounts` | جدول (schema.ts:38) | — | CODE | سليم — 1 صفّاً، مستعمل (srcFiles=6، scriptFiles=7) | ملفّات src تذكره: 6 · نصوص: 7 |
| `sessions` | جدول (schema.ts:52) | — | CODE | سليم — 2 صفّاً، مستعمل (srcFiles=1، scriptFiles=0) | ملفّات src تذكره: 1 · نصوص: 0 |
| `verification_tokens` | جدول (schema.ts:58) | — | CODE | سليم — يستعمله المحوِّل وحده (0 صفوف) | ملفّات src تذكره: 1 · نصوص: 0 |
| `suppliers` | جدول (schema.ts:75) | — | CODE | سليم — 24 صفّاً، مستعمل (srcFiles=45، scriptFiles=22) | ملفّات src تذكره: 45 · نصوص: 22 |
| `supplier_aliases` | جدول (schema.ts:118) | — | CODE | سليم — 101 صفّاً، مستعمل (srcFiles=12، scriptFiles=7) | ملفّات src تذكره: 12 · نصوص: 7 |
| `documents` | جدول (schema.ts:152) | — | CODE | سليم — 166 صفّاً، مستعمل (srcFiles=25، scriptFiles=15) | ملفّات src تذكره: 25 · نصوص: 15 |
| `invoices` | جدول (schema.ts:215) | — | CODE | سليم — 134 صفّاً، مستعمل (srcFiles=44، scriptFiles=22) | ملفّات src تذكره: 44 · نصوص: 22 |
| `invoice_lines` | جدول (schema.ts:259) | — | CODE | سليم — 298 صفّاً، مستعمل (srcFiles=10، scriptFiles=4) | ملفّات src تذكره: 10 · نصوص: 4 |
| `statements` | جدول (schema.ts:293) | — | CODE | سليم — 14 صفّاً، مستعمل (srcFiles=16، scriptFiles=5) | ملفّات src تذكره: 16 · نصوص: 5 |
| `statement_lines` | جدول (schema.ts:317) | — | CODE | سليم — 201 صفّاً، مستعمل (srcFiles=9، scriptFiles=3) | ملفّات src تذكره: 9 · نصوص: 3 |
| `payments` | جدول (schema.ts:352) | — | CODE | سليم — 58 صفّاً، مستعمل (srcFiles=14، scriptFiles=10) | ملفّات src تذكره: 14 · نصوص: 10 |
| `payment_allocations` | جدول (schema.ts:388) | — | CODE | سليم — 122 صفّاً، مستعمل (srcFiles=19، scriptFiles=12) | ملفّات src تذكره: 19 · نصوص: 12 |
| `bank_imports` | جدول (schema.ts:397) | — | CODE | سليم — 2 صفّاً، مستعمل (srcFiles=3، scriptFiles=3) | ملفّات src تذكره: 3 · نصوص: 3 |
| `bank_rules` | جدول (schema.ts:449) | — | CODE | سليم — 41 صفّاً، مستعمل (srcFiles=3، scriptFiles=3) | ملفّات src تذكره: 3 · نصوص: 3 |
| `bank_transactions` | جدول (schema.ts:495) | — | CODE | سليم — 1440 صفّاً، مستعمل (srcFiles=19، scriptFiles=17) | ملفّات src تذكره: 19 · نصوص: 17 |
| `issues` | جدول (schema.ts:600) | — | CODE | سليم — 22 صفّاً، مستعمل (srcFiles=7، scriptFiles=3) | ملفّات src تذكره: 7 · نصوص: 3 |
| `month_closes` | جدول (schema.ts:623) | — | CODE | سليم هيكلياً — 0 صفوف: الإقفال لم يجرِ قطّ (بوّابة OPS) | ملفّات src تذكره: 3 · نصوص: 2 |
| `rate_limits` | جدول (schema.ts:640) | — | CODE | سليم — 22 صفّاً، مستعمل (srcFiles=1، scriptFiles=0) | ملفّات src تذكره: 1 · نصوص: 0 |
| `products` | جدول (schema.ts:668) | — | CODE | سليم — 4 صفّاً، مستعمل (srcFiles=8، scriptFiles=1) | ملفّات src تذكره: 8 · نصوص: 1 |
| `supplier_products` | جدول (schema.ts:686) | — | CODE | سليم — 109 صفّاً، مستعمل (srcFiles=4، scriptFiles=1) | ملفّات src تذكره: 4 · نصوص: 1 |
| `recurring_expenses` | جدول (schema.ts:720) | — | CODE | سليم هيكلياً — 0 صفوف: «المتوقَّع مقابل الفعليّ» بلا متوقَّع | ملفّات src تذكره: 5 · نصوص: 0 |
| `expenses` | جدول (schema.ts:746) | — | CODE | سليم — 892 صفّاً، مستعمل (srcFiles=7، scriptFiles=3) | ملفّات src تذكره: 7 · نصوص: 3 |
| `branches` | جدول (schema.ts:792) | — | CODE | CODE-003 — صفّ واحد في القاعدة ولا ملفّ في src يذكره | ملفّات src تذكره: 0 · نصوص: 0 |
| `bank_accounts` | جدول (schema.ts:811) | — | CODE | CODE-003 — صفّ واحد؛ يُكتب من bank-account.service وحده | ملفّات src تذكره: 1 · نصوص: 2 |
| `reconciliation_periods` | جدول (schema.ts:835) | — | CODE | CODE-003 — صفر صفوف؛ يُقرأ في month-close-facts وattention-facts ولا يُكتب من أيّ شيفرة | ملفّات src تذكره: 2 · نصوص: 1 |
| `counterparties` | جدول (schema.ts:861) | — | CODE | سليم — 84 صفّاً، مستعمل (srcFiles=3، scriptFiles=2) | ملفّات src تذكره: 3 · نصوص: 2 |
| `counterparty_evidence` | جدول (schema.ts:891) | — | CODE | سليم — 84 صفّاً، مستعمل (srcFiles=2، scriptFiles=1) | ملفّات src تذكره: 2 · نصوص: 1 |
| `sales_sources` | جدول (schema.ts:921) | — | CODE | سليم — فارغ عمداً (CLAUDE.md: ما ليس مبنيّاً) | ملفّات src تذكره: 0 · نصوص: 0 |
| `pos_products` | جدول (schema.ts:931) | — | CODE | سليم — فارغ عمداً | ملفّات src تذكره: 0 · نصوص: 0 |
| `sales` | جدول (schema.ts:943) | — | CODE | سليم — 0 صفّاً، مستعمل (srcFiles=3، scriptFiles=1) | ملفّات src تذكره: 3 · نصوص: 1 |
| `sale_lines` | جدول (schema.ts:970) | — | CODE | سليم — فارغ عمداً | ملفّات src تذكره: 0 · نصوص: 0 |
| `audit_logs` | جدول (schema.ts:998) | — | CODE | سليم — 254 صفّاً، مستعمل (srcFiles=3، scriptFiles=2) | ملفّات src تذكره: 3 · نصوص: 2 |
| `sale_payments` | جدول (schema.ts:1113) | — | CODE | سليم — فارغ عمداً | ملفّات src تذكره: 0 · نصوص: 0 |
| `refunds` | جدول (schema.ts:1140) | — | CODE | سليم — فارغ عمداً | ملفّات src تذكره: 0 · نصوص: 0 |
| `refund_lines` | جدول (schema.ts:1156) | — | CODE | سليم — فارغ عمداً | ملفّات src تذكره: 0 · نصوص: 0 |
| `settlement_batches` | جدول (schema.ts:1171) | — | CODE | سليم — فارغ عمداً | ملفّات src تذكره: 0 · نصوص: 0 |
| `adjudications` | جدول (schema.ts:1198) | — | CODE | CODE-007 — 0 صفوف؛ يكتبه adjudicator.service وحده، فالحَكَم لم يُستدعَ على بيانات حقيقية قطّ | ملفّات src تذكره: 1 · نصوص: 0 |
| `decision_history` | جدول (schema.ts:1231) | — | CODE | سليم — 1697 صفّاً، مستعمل (srcFiles=5، scriptFiles=5) | ملفّات src تذكره: 5 · نصوص: 5 |
